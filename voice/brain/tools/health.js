'use strict';

/**
 * health_search — READ-ONLY lookups against the health knowledge base.
 *
 * Drugs and classes come from the shared medical_data (RxNorm / RxClass, cached
 * locally, live NLM lookup on a miss). Plain-language guidance still comes from
 * general_health.db.
 *
 * This is the ONLY place medical facts may come from. If a lookup returns
 * nothing, the correct answer is "not in the knowledge base" — never a guess.
 *
 * Returns only what matched; never a table dump.
 */

const medical_data = require('../../../api/medical_data');
const { generalHealth } = require('../db');

function tokenize(text) {
  return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []));
}

function searchGuidance(tokens) {
  if (tokens.length === 0) return [];
  const rows = generalHealth().query('SELECT topic_id, advice, source FROM guidance');
  return rows.filter((g) => tokens.some((t) => g.topic_id.toLowerCase().includes(t) || g.advice.toLowerCase().includes(t)));
}

const compactClass = (c) => ({ class_id: c.classId, name: c.name, type: c.type, direct: c.direct });

async function search(query) {
  const drug = await medical_data.resolveDrug(query);
  const ingredients = [];
  if (drug.found) {
    const { classes } = await medical_data.classify(drug.rxcui);
    ingredients.push({
      rxcui: drug.rxcui,
      name: drug.name,
      matched_term: query,
      matched_kind: drug.match === 'exact' ? 'exact' : 'approximate — spelling or wording differed; confirm with the participant',
      classes: classes.map(compactClass),
    });
  }

  // A class name ("NSAIDs", "systemic corticosteroids") rather than a drug.
  const cls = drug.found ? null : await medical_data.resolveClass(query);
  const classes = cls && (cls.quality === 'exact' || cls.quality === 'partial')
    ? cls.classes.map((c) => ({ class_id: c.classId, name: c.name, type: c.type }))
    : [];

  const guidance = searchGuidance(tokenize(query));
  const total = ingredients.length + classes.length + guidance.length;
  const unavailable = drug.unavailable || cls?.unavailable;

  return {
    query,
    source: 'medical_data (RxNorm / RxClass, NLM) + general_health.db guidance — read-only',
    ingredients,
    classes,
    guidance,
    ...(drug.found ? {} : { suggestions: drug.candidates.map((c) => ({ rxcui: c.rxcui, name: c.name })) }),
    found_anything: total > 0,
    ...(total === 0
      ? {
          note: unavailable
            ? 'The drug database could not be reached. Say you cannot check that right now; do not infer a drug or class from memory.'
            : drug.candidates.length > 0
              ? 'No confident match. "suggestions" are possibilities to confirm with the participant, not an identification.'
              : 'Nothing matched in the knowledge base. Do not infer a drug or class from memory.',
        }
      : {}),
  };
}

module.exports = { search };
