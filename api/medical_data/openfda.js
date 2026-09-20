'use strict';

/**
 * openFDA drug labelling — the source for side effects.
 *
 * https://api.fda.gov/drug/label.json — the FDA's Structured Product Labelling
 * corpus. Free, no key required (40 requests/minute anonymously), and it is the
 * actual approved label rather than anybody's summary of one.
 *
 * Why a real API rather than asking the model: the agent's grounding rule says
 * a medical claim must be traceable to a lookup. "What are the side effects of
 * levothyroxine" is exactly the kind of question a language model answers
 * fluently and occasionally wrongly, and a wrong symptom prompt on a live call
 * puts words in a participant's mouth — they will agree with a symptom you
 * suggest. Every term this module returns appears verbatim in a specific
 * label, and the label is cited alongside it.
 *
 * Two label shapes matter:
 *   - Prescription labels carry `adverse_reactions`, often as body-system
 *     lists ("General: fatigue, increased appetite, weight loss").
 *   - OTC labels have no `adverse_reactions` at all. They carry `when_using`,
 *     `stop_use` and `ask_doctor`, which are written in patient language and
 *     are frankly better for reading down a phone line.
 * Both are used, prescription first.
 *
 * Results are cached to disk. The demo runs on conference wifi, and a call
 * must not stall because api.fda.gov is slow.
 */

const fs = require('node:fs');
const path = require('node:path');

const BASE = 'https://api.fda.gov/drug/label.json';
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'openfda-labels.json');
const TIMEOUT_MS = 4000;

/**
 * A matcher, not a knowledge source.
 *
 * Nothing here is asserted about any drug. These are the strings we look FOR
 * in a label; a term is only ever returned if that label actually contains it.
 * The list exists because label prose is not machine-readable — it is headings,
 * percentages and citations — and a regex for "any symptom" does not exist.
 */
const SYMPTOM_TERMS = [
  'abdominal pain', 'anxiety', 'arrhythmia', 'back pain', 'bleeding', 'bloating',
  'blurred vision', 'bruising', 'chest pain', 'chills', 'confusion', 'constipation',
  'cough', 'cramps', 'diarrhea', 'diarrhoea', 'dizziness', 'drowsiness', 'dry mouth',
  'dyspepsia', 'fatigue', 'fever', 'flushing', 'headache', 'heartburn', 'heat intolerance',
  'hair loss', 'hives', 'increased appetite', 'indigestion', 'insomnia', 'irritability',
  'itching', 'joint pain', 'muscle pain', 'muscle weakness', 'nausea', 'nervousness',
  'night sweats', 'palpitations', 'rash', 'shortness of breath', 'sleep disturbance',
  'stomach pain', 'stomach upset', 'sweating', 'swelling', 'tremor', 'vomiting',
  'weight gain', 'weight loss', 'blood pressure', 'fainting', 'numbness', 'tingling',
];

/**
 * Terms that are never offered as a prompt on a call.
 *
 * Two reasons, and the second is the important one. Reading "have you had any
 * bleeding?" to someone is alarming, and we are not calling to frighten them.
 * More subtly, people agree with symptoms that are suggested to them — so a
 * suggested serious symptom manufactures a serious finding. These stay in the
 * data for the coordinator; they are never put in the participant's mouth.
 *
 * An open question catches them anyway: someone who is bleeding says so.
 */
const NEVER_SUGGEST = new Set([
  'bleeding', 'chest pain', 'shortness of breath', 'arrhythmia', 'palpitations',
  'an irregular heartbeat', 'a racing heartbeat', 'fainting', 'confusion',
  'blurred vision', 'numbness', 'swelling', 'hives', 'blood pressure',
]);

// Plain-language substitutions. The label says "dyspepsia"; nobody on a phone
// call does. The mapping only renames a term the label actually contained.
const PLAIN = {
  dyspepsia: 'indigestion',
  diarrhoea: 'diarrhea',
  'sleep disturbance': 'trouble sleeping',
  arrhythmia: 'an irregular heartbeat',
  palpitations: 'a racing heartbeat',
  'heat intolerance': 'feeling too hot',
};

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    // A cache that cannot be written is a performance problem, not a failure.
  }
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // offline, rate-limited, or slow — the caller degrades
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Terms that genuinely appear in this label, in the order the label mentions
 * them.
 *
 * Position is the closest thing to a prominence signal the prose gives us:
 * label sections lead with what is common. Alphabetical order put "abdominal
 * pain" first for every drug, which is an artefact of the alphabet, not of
 * the medicine.
 */
function extractSymptoms(text) {
  const haystack = String(text || '').toLowerCase();
  const found = [];
  for (const term of SYMPTOM_TERMS) {
    const at = haystack.indexOf(term);
    if (at >= 0) found.push({ term: PLAIN[term] || term, at });
  }
  found.sort((a, b) => a.at - b.at);
  const seen = new Set();
  return found.filter((f) => !seen.has(f.term) && seen.add(f.term)).map((f) => f.term);
}

function firstSentences(text, count = 2) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^\d+(\.\d+)?\s*/, '')
    .replace(/^ADVERSE REACTIONS\s*/i, '')
    .trim();
  const parts = clean.split(/(?<=[.!?])\s+/).slice(0, count);
  return parts.join(' ').trim();
}

/**
 * The label for one drug.
 *
 * `name` should be a generic/substance name — the RxNorm ingredient name the
 * pipeline already resolves. Ingredient-level RxCUIs are NOT usable here:
 * openFDA indexes product-level RxCUIs (the specific tablet and strength), so
 * searching `openfda.rxcui` with an ingredient code returns nothing. That is a
 * real dead end, not an oversight — the name is the working join.
 */
async function labelFor(name, { refresh = false } = {}) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;

  const cache = loadCache();
  if (!refresh && cache[key]) return cache[key];

  const quoted = key.replace(/"/g, '');
  // Prescription labels first: they carry a real adverse-reactions section.
  const queries = [
    `openfda.generic_name:"${quoted}" AND _exists_:adverse_reactions`,
    `openfda.substance_name:"${quoted}" AND _exists_:adverse_reactions`,
    `openfda.generic_name:"${quoted}" AND _exists_:stop_use`,
    `openfda.generic_name:"${quoted}"`,
  ];

  // Ask for several and prefer a label whose generic name IS this drug.
  // Searching "metformin" otherwise returns "SITAGLIPTIN AND METFORMIN
  // HYDROCHLORIDE" — a real label, for a different medicine, whose adverse
  // reactions include the other ingredient's. Attributing those to metformin
  // would be precisely the fabrication the lookup exists to prevent.
  const isExact = (r) =>
    (r.openfda?.generic_name || []).some((g) => String(g).toLowerCase().trim() === key);

  let result = null;
  for (const q of queries) {
    const data = await fetchJson(`${BASE}?search=${encodeURIComponent(q)}&limit=5`);
    if (!data?.results?.length) continue;
    result = data.results.find(isExact) || null;
    if (result) break;
    // Nothing exact in this batch: remember a candidate, keep looking.
    if (!result && !queries.indexOf(q)) result = null;
  }
  if (!result) {
    for (const q of queries) {
      const data = await fetchJson(`${BASE}?search=${encodeURIComponent(q)}&limit=1`);
      if (data?.results?.length) { result = data.results[0]; break; }
    }
  }
  if (!result) {
    // Cache the miss too — a drug with no US label will not acquire one
    // mid-demo, and re-asking costs a four-second timeout each call.
    cache[key] = { name: key, found: false, checkedAt: new Date().toISOString() };
    saveCache(cache);
    return cache[key];
  }

  const rx = (result.adverse_reactions || []).join(' ');
  const otc = [
    ...(result.when_using || []),
    ...(result.stop_use || []),
    ...(result.ask_doctor || []),
  ].join(' ');

  const entry = {
    name: key,
    found: true,
    genericName: result.openfda?.generic_name?.[0] || null,
    brandNames: (result.openfda?.brand_name || []).slice(0, 3),
    setId: result.set_id || null,
    effectiveTime: result.effective_time || null,
    labelType: rx ? 'prescription' : otc ? 'otc' : 'unknown',
    // Every symptom below is a string that occurs in the text above it.
    symptoms: extractSymptoms(`${rx} ${otc}`),
    adverseReactionsExcerpt: rx ? firstSentences(rx, 2) : null,
    stopUseExcerpt: (result.stop_use || [])[0] ? firstSentences(result.stop_use[0], 2) : null,
    source: 'openFDA drug/label',
    checkedAt: new Date().toISOString(),
  };
  cache[key] = entry;
  saveCache(cache);
  return entry;
}

/**
 * Follow-up questions to ask about a medication, grounded in its label.
 *
 * Deliberately capped and deliberately open. Reading a participant a list of
 * twelve symptoms produces agreement, not information — people say yes to
 * symptoms that are suggested to them. So: one open question first, and at
 * most two specific prompts, drawn from the label's most commonly listed
 * effects.
 */
function followUpQuestions(label, drugLabelName) {
  // Labels are stored in capitals. Text-to-speech reads capitals as shouting,
  // or spells them out letter by letter.
  const raw = drugLabelName || label?.genericName || label?.name || 'this medication';
  const drug = String(raw).toLowerCase();
  const questions = [
    `How have you been getting on with the ${drug}? Any problems with it?`,
  ];
  const suggestable = (label?.symptoms || []).filter((sx) => !NEVER_SUGGEST.has(sx));
  if (label?.found && suggestable.length) {
    const picks = suggestable.slice(0, 2);
    questions.push(
      `Some people notice ${picks.join(' or ')} on ${drug}. Have you had anything like that?`
    );
  }
  questions.push(`And is it doing what it is meant to for you?`);
  return questions;
}

/** One compact object for a tool result. */
async function drugSafety(name, opts) {
  const label = await labelFor(name, opts);
  if (!label || !label.found) {
    return {
      found: false,
      name: String(name || '').toLowerCase(),
      note: 'No US drug label found. Ask openly rather than naming symptoms.',
      questions: followUpQuestions(null, name),
    };
  }
  return {
    found: true,
    name: label.name,
    genericName: label.genericName,
    brandNames: label.brandNames,
    labelType: label.labelType,
    symptoms: label.symptoms,
    excerpt: label.adverseReactionsExcerpt || label.stopUseExcerpt,
    questions: followUpQuestions(label),
    source: `openFDA drug label${label.setId ? ` (set ${label.setId})` : ''}`,
    effectiveTime: label.effectiveTime,
  };
}

module.exports = { labelFor, drugSafety, followUpQuestions, extractSymptoms, CACHE_FILE };
