'use strict';

/**
 * drugdb — one place to ask "what is this drug, and what is it part of?".
 *
 *   resolveDrug(text)            spoken/typed name -> RxNorm concept (+ ingredients)
 *   classify(rxcui)              -> ATC + FDA EPC classes, with ATC ancestors
 *   inClass(rxcui, classIds)     -> is this drug in any of these classes?
 *   resolveClass(text)           free-text class name ("systemic corticosteroid")
 *                                -> RxClass class ids, ranked
 *   checkProhibited(rxcui, rules)-> which protocol rules this drug trips
 *
 * Lookups hit the local SQLite cache first and fall through to NLM RxNav /
 * RxClass. Set DRUGDB_OFFLINE=1 to never touch the network. Nothing here
 * guesses: an unknown drug is `found: false`, and a network failure is
 * `unavailable: true`, never a made-up answer.
 */

const rxnav = require('./rxnav');
const store = require('./store');

const offline = (opts) => opts?.offline ?? process.env.DRUGDB_OFFLINE === '1';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* ------------------------------------------------------------------ drugs */

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * RxNav's fuzzy score cannot tell a good match from a bad one — it rewards
 * shared words, so "influenza vaccine, live attenuated" scores *higher* against
 * a chikungunya vaccine than "ibuprofin" does against ibuprofen. So a fuzzy
 * hit is only accepted if most of what was said turns up in the candidate's
 * name, allowing for a typo or two.
 */
function plausible(term, candidateNames) {
  const said = term.split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  if (said.length === 0) return false;
  const have = candidateNames.flatMap((n) => norm(n).split(' '));
  const near = (w) => have.some((h) => h === w || (w.length >= 5 && editDistance(w, h) <= 2) || (w.length === 4 && editDistance(w, h) <= 1));
  return said.filter(near).length / said.length >= 0.6;
}

function conceptWithIngredients(rxcui) {
  const concept = store.getConcept(rxcui);
  if (!concept) return null;
  const ingredients = concept.tty === 'IN' ? [concept] : store.getIngredients(rxcui);
  return { ...concept, ingredients };
}

/** Fetch a concept and, if it is a product rather than an ingredient, the ingredients behind it. */
async function fetchConcept(rxcui) {
  const props = await rxnav.properties(rxcui);
  if (!props) return null;
  store.putConcept(props);
  if (props.tty !== 'IN') store.putIngredients(rxcui, await rxnav.ingredientsOf(rxcui));
  return conceptWithIngredients(rxcui);
}

function shape(query, concept, match, score, source, candidates = []) {
  const single = concept.ingredients.length === 1 ? concept.ingredients[0] : null;
  return {
    query,
    found: true,
    // The ingredient when there is exactly one; otherwise the concept itself
    // (a combination product), with every ingredient listed.
    rxcui: single ? single.rxcui : concept.rxcui,
    name: single ? single.name : concept.name,
    tty: single ? single.tty : concept.tty,
    matchedConcept: { rxcui: concept.rxcui, name: concept.name, tty: concept.tty },
    ingredients: concept.ingredients,
    match, // 'exact' | 'approximate'
    score: score ?? null,
    source, // 'cache' | 'rxnav'
    candidates,
  };
}

const miss = (query, extra = {}) => ({
  query, found: false, rxcui: null, name: null, tty: null, matchedConcept: null, ingredients: [],
  match: null, score: null, source: null, candidates: [], ...extra,
});

/**
 * Resolve a drug name to RxNorm. `match: 'exact'` means RxNorm normalised the
 * string to a concept; `'approximate'` is a fuzzy hit — treat it as a
 * suggestion to confirm with the participant, not as an identification.
 */
async function resolveDrug(text, opts = {}) {
  const term = norm(text);
  if (!term) return miss(text);

  const cached = store.getTerm(term);
  if (cached) {
    const concept = conceptWithIngredients(cached.rxcui);
    if (concept) return shape(text, concept, cached.match, cached.score, 'cache');
  }
  if (offline(opts)) return miss(text, { unavailable: true, error: 'offline and not cached' });

  try {
    const [exact] = await rxnav.findByName(text);
    if (exact) {
      const concept = await fetchConcept(exact);
      if (concept) {
        store.putTerm(term, exact, 'exact', null);
        return shape(text, concept, 'exact', null, 'rxnav');
      }
    }

    const ranked = (await rxnav.approximate(text)).slice(0, 5);
    const candidates = [];
    for (const c of ranked) {
      const concept = await fetchConcept(c.rxcui);
      if (concept) candidates.push({ rxcui: concept.ingredients.length === 1 ? concept.ingredients[0].rxcui : concept.rxcui,
        name: concept.ingredients.length === 1 ? concept.ingredients[0].name : concept.name, score: c.score, concept });
    }
    // Several products of one ingredient are one candidate.
    const dedup = [];
    for (const c of candidates) if (!dedup.some((d) => d.rxcui === c.rxcui)) dedup.push(c);
    const suggestions = dedup.map(({ rxcui, name, score }) => ({ rxcui, name, score }));

    const top = dedup.find((c) => plausible(term, [c.name, c.concept.name]));
    if (!top) return miss(text, { candidates: suggestions });

    store.putTerm(term, top.concept.rxcui, 'approximate', top.score);
    return shape(text, top.concept, 'approximate', top.score, 'rxnav', suggestions);
  } catch (err) {
    return miss(text, { unavailable: true, error: String(err.message || err) });
  }
}

/* ---------------------------------------------------------------- classes */

/** ATC codes nest by prefix: H02AB -> H02A -> H02 -> H. */
function atcAncestors(classId) {
  if (!/^[A-Z]\d{2}([A-Z]([A-Z]\d{0,2})?)?$/.test(classId)) return [];
  return [1, 3, 4, 5].filter((n) => n < classId.length).map((n) => classId.slice(0, n));
}

/** Load the full class catalogue once; it is what class-name search runs over. */
async function ensureClassCatalogue(opts) {
  if (store.getMeta('classes_loaded') || offline(opts)) return;
  const [atc, epc] = await Promise.all([rxnav.allClasses('ATC1-4'), rxnav.allClasses('EPC')]);
  store.putClasses([...atc, ...epc]);
  store.putMeta('classes_loaded', new Date().toISOString());
}

/**
 * Classes a drug belongs to. `direct` classes come from RxClass; ATC ancestors
 * are added so a rule written at "H02" (corticosteroids for systemic use)
 * catches a drug filed under "H02AB".
 */
async function classify(rxcui, opts = {}) {
  const concept = conceptWithIngredients(rxcui) ?? (offline(opts) ? null : await fetchConceptSafe(rxcui));
  const ingredientIds = concept ? (concept.ingredients.length ? concept.ingredients.map((i) => i.rxcui) : [rxcui]) : [rxcui];

  try {
    for (const id of ingredientIds) {
      if (store.isClassified(id) || offline(opts)) continue;
      const [atc, epc] = await Promise.all([rxnav.atcClassesOf(id), rxnav.epcClassesOf(id)]);
      store.putDirectClasses(id, [...atc, ...epc]);
    }
    await ensureClassCatalogue(opts);
  } catch (err) {
    return { rxcui, classes: [], unavailable: true, error: String(err.message || err) };
  }

  const direct = new Set(ingredientIds.flatMap((id) => store.getDirectClassIds(id)));
  const closure = new Map();
  for (const id of direct) {
    for (const cid of [id, ...atcAncestors(id)]) {
      if (!closure.has(cid)) closure.set(cid, { classId: cid, direct: direct.has(cid) });
    }
  }
  const classes = [...closure.values()]
    .map((c) => ({ ...c, ...(store.getClass(c.classId) ?? { name: null, type: 'ATC' }) }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.classId.length - b.classId.length || a.classId.localeCompare(b.classId));
  return { rxcui, classes };
}

async function fetchConceptSafe(rxcui) {
  try {
    return await fetchConcept(rxcui);
  } catch {
    return null;
  }
}

/** Does this drug fall in any of these classes (matching direct classes or ATC ancestors)? */
async function inClass(rxcui, classIds, opts = {}) {
  const { classes, unavailable } = await classify(rxcui, opts);
  const wanted = new Set(classIds);
  const matched = classes.filter((c) => wanted.has(c.classId));
  return { inClass: matched.length > 0, matched, unavailable: Boolean(unavailable) };
}

/* ----------------------------------------------------------- class search */

// Function words, plus nouns so generic they say nothing about *which* class
// ("anticancer therapies" is not "antineoplastic cell therapy").
const STOP = new Set([
  'a', 'an', 'and', 'or', 'of', 'the', 'for', 'in', 'to', 'other', 'use',
  'product', 'products', 'therapy', 'therapies', 'treatment', 'treatments', 'drug', 'drugs', 'agent', 'agents', 'medication', 'medications',
]);

const stem = (w) => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Words protocols use where the class catalogues use another. */
const WORD_SYNONYMS = { anticancer: 'antineoplastic', immunosuppressive: 'immunosuppressant' };

const tokens = (s) => [
  ...new Set(
    norm(s)
      .split(' ')
      .filter((w) => w && !STOP.has(w))
      .map((w) => stem(WORD_SYNONYMS[w] ?? w)),
  ),
];

/** Abbreviations protocols use that the class catalogues spell out. */
const ALIASES = {
  nsaid: ['nonsteroidal anti-inflammatory drug', 'antiinflammatory antirheumatic products non-steroids'],
  ssri: ['selective serotonin reuptake inhibitor'],
  ppi: ['proton pump inhibitor'],
  'ace inhibitor': ['angiotensin converting enzyme inhibitor'],
};

function scoreClasses(text, catalogue, idf) {
  const q = tokens(text);
  if (q.length === 0) return { q, scored: [] };
  const total = q.reduce((sum, w) => sum + idf(w), 0);
  const scored = catalogue.map((c) => {
    const n = tokens(c.name);
    const shared = q.filter((w) => n.includes(w));
    return {
      ...c,
      coverage: shared.length / q.length,
      // Rare words carry the meaning: "therapy" is in dozens of class names,
      // "antineoplastic" in a handful.
      weight: shared.reduce((sum, w) => sum + idf(w), 0) / total,
      extra: n.length - shared.length,
    };
  });
  return { q, scored };
}

/** Below this share of the query's (rarity-weighted) meaning, a partial match is noise. */
const PARTIAL_MIN_WEIGHT = 0.35;

/**
 * Find RxClass classes matching a class name written in prose, e.g. a
 * protocol's "Systemic corticosteroid".
 *
 * quality:
 *   'exact'   every word of the query is in each returned class name, and the
 *             names are not padded with unrelated words. Safe to apply.
 *   'partial' no class has every word, but these carry the distinctive ones
 *             ("chronic immunosuppressant" -> IMMUNOSUPPRESSANTS). Apply, and
 *             show a human what was left out.
 *   'weak'    every word appears, but only inside longer, unrelated names
 *             ("radiation therapy" -> "sensitizers used in photodynamic/
 *             radiation therapy"). Suggestions only — do not apply.
 *   'none'    nothing plausible.
 *
 * ATC anatomical groups (one letter, e.g. "L: antineoplastic and
 * immunomodulating agents") are never returned: far too broad to be a rule.
 * Where an ATC class and its own sub-classes both match, only the broadest is
 * kept — `classify` already reports a drug under every ATC ancestor.
 */
async function resolveClass(text, opts = {}) {
  const key = tokens(text).join(' '); // stemmed, so "NSAIDs" finds "nsaid"
  const queries = [text, ...(ALIASES[key] ?? [])];
  try {
    await ensureClassCatalogue(opts);
  } catch (err) {
    return { query: text, tokens: tokens(text), quality: 'none', exact: false, classes: [], unavailable: true, error: String(err.message || err) };
  }

  const catalogue = store.allClasses().filter((c) => !(c.type === 'ATC' && c.classId.length === 1));
  const df = new Map();
  for (const c of catalogue) for (const w of new Set(tokens(c.name))) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w) => Math.log(1 + catalogue.length / (1 + (df.get(w) ?? 0)));

  const runs = queries.map((qs) => scoreClasses(qs, catalogue, idf));
  const qLen = runs[0].q.length;
  const byId = new Map();
  for (const { scored } of runs) {
    for (const c of scored) {
      const prev = byId.get(c.classId);
      if (!prev || c.coverage > prev.coverage || (c.coverage === prev.coverage && c.weight > prev.weight)) byId.set(c.classId, c);
    }
  }
  const all = [...byId.values()];
  const full = all.filter((c) => c.coverage === 1);
  const bestExtra = full.length ? Math.min(...full.map((c) => c.extra)) : null;

  let quality;
  let pool;
  if (full.length > 0) {
    pool = full;
    quality = bestExtra <= Math.max(qLen, 1) ? 'exact' : 'weak';
  } else {
    pool = all.filter((c) => c.coverage > 0 && c.weight >= PARTIAL_MIN_WEIGHT);
    quality = pool.length > 0 ? 'partial' : 'none';
  }

  const ids = new Set(pool.map((c) => c.classId));
  const kept = pool.filter((c) => !(c.type === 'ATC' && atcAncestors(c.classId).some((a) => ids.has(a))));
  const classes = kept
    .sort((a, b) => b.weight - a.weight || a.extra - b.extra || a.classId.length - b.classId.length)
    .slice(0, opts.limit ?? 25)
    .map(({ classId, name, type, coverage, extra }) => ({ classId, name, type, coverage, extra }));
  return { query: text, tokens: runs[0].q, quality, exact: quality === 'exact', classes };
}

/* ------------------------------------------------------- protocol matching */

/**
 * Which of these protocol rules does the drug trip? A rule is
 * `{ ruleId, classIds?: string[], rxcuis?: string[] }`. Membership only: a
 * rule's dose or timing threshold is the caller's to evaluate.
 */
async function checkProhibited(rxcui, rules, opts = {}) {
  const { classes, unavailable } = await classify(rxcui, opts);
  const hits = [];
  for (const rule of rules) {
    if (rule.rxcuis?.includes(rxcui)) hits.push({ ruleId: rule.ruleId, via: 'rxcui', matched: rxcui });
    const viaClass = classes.find((c) => rule.classIds?.includes(c.classId));
    if (viaClass) hits.push({ ruleId: rule.ruleId, via: 'class', matched: viaClass.classId, className: viaClass.name });
  }
  return { rxcui, hits, unavailable: Boolean(unavailable) };
}

module.exports = {
  resolveDrug,
  classify,
  inClass,
  resolveClass,
  checkProhibited,
  atcAncestors,
  close: store.close,
  DB_PATH: store.DB_PATH,
};
