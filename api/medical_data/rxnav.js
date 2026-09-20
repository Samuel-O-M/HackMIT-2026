'use strict';

/**
 * Thin client for NLM's RxNav / RxClass REST API (free, no key).
 * https://lhncbc.nlm.nih.gov/RxNav/APIs/
 *
 * Point RXNAV_BASE at a local RxNav-in-a-Box (e.g. http://localhost:4000/REST)
 * to take the network out of the loop entirely.
 */

const BASE = () => process.env.RXNAV_BASE || 'https://rxnav.nlm.nih.gov/REST';
const TIMEOUT_MS = Number(process.env.RXNAV_TIMEOUT_MS || 8000);

async function get(path, params = {}) {
  const url = new URL(BASE() + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`RxNav ${res.status} for ${url.pathname}`);
  return res.json();
}

/** RxCUIs whose name matches the string after RxNorm normalisation. */
async function findByName(name) {
  const data = await get('/rxcui.json', { name, search: 2 });
  return data?.idGroup?.rxnormId ?? [];
}

/** Fuzzy match. Returns [{ rxcui, score }] best-first, one row per RxCUI. */
async function approximate(term, maxEntries = 8) {
  const data = await get('/approximateTerm.json', { term, maxEntries });
  const best = new Map();
  for (const c of data?.approximateGroup?.candidate ?? []) {
    const score = Number(c.score);
    if (!best.has(c.rxcui) || score > best.get(c.rxcui)) best.set(c.rxcui, score);
  }
  return [...best].map(([rxcui, score]) => ({ rxcui, score })).sort((a, b) => b.score - a.score);
}

/** { rxcui, name, tty } or null for an RxCUI that does not exist. */
async function properties(rxcui) {
  const p = (await get(`/rxcui/${rxcui}/properties.json`))?.properties;
  return p?.rxcui ? { rxcui: p.rxcui, name: p.name, tty: p.tty } : null;
}

/** The ingredient concepts (tty IN) behind a brand or clinical drug. */
async function ingredientsOf(rxcui) {
  const data = await get(`/rxcui/${rxcui}/related.json`, { tty: 'IN' });
  const groups = data?.relatedGroup?.conceptGroup ?? [];
  return groups.flatMap((g) => g.conceptProperties ?? []).map((c) => ({ rxcui: c.rxcui, name: c.name, tty: c.tty }));
}

/** ATC classes for an ingredient. Levels 1-4 as RxClass models them. */
async function atcClassesOf(rxcui) {
  const data = await get('/rxclass/class/byRxcui.json', { rxcui, relaSource: 'ATC' });
  return classItems(data);
}

/** FDA Established Pharmacologic Classes (from DailyMed labelling). */
async function epcClassesOf(rxcui) {
  const data = await get('/rxclass/class/byRxcui.json', { rxcui, relaSource: 'DAILYMED', relas: 'has_EPC' });
  return classItems(data);
}

function classItems(data) {
  const seen = new Map();
  for (const d of data?.rxclassDrugInfoList?.rxclassDrugInfo ?? []) {
    const c = d.rxclassMinConceptItem;
    seen.set(c.classId, { classId: c.classId, name: c.className, type: c.classType === 'EPC' ? 'EPC' : 'ATC' });
  }
  return [...seen.values()];
}

/** Every class of a type, for local class-name search. type: 'ATC1-4' | 'EPC'. */
async function allClasses(classType) {
  const data = await get('/rxclass/allClasses.json', { classTypes: classType });
  return (data?.rxclassMinConceptList?.rxclassMinConcept ?? []).map((c) => ({
    classId: c.classId,
    name: c.className,
    type: c.classType === 'EPC' ? 'EPC' : 'ATC',
  }));
}

module.exports = { findByName, approximate, properties, ingredientsOf, atcClassesOf, epcClassesOf, allClasses };
