'use strict';

/**
 * health_search — READ-ONLY lookups against the health knowledge base
 * (RxNorm ingredients/synonyms, RxClass classes/members, general guidance).
 *
 * This is the ONLY place medical facts may come from. If a lookup returns
 * nothing, the correct answer is "not in the knowledge base" — never a guess.
 *
 * Returns only what matched; never a table dump.
 */

const { generalHealth } = require('../db');

function tokenize(text) {
  return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []));
}

function search(query) {
  const db = generalHealth();
  const tokens = tokenize(query);

  const ingredients = db.query('SELECT rxcui, name FROM rxnorm_ingredients');
  const synonyms = db.query('SELECT term, rxcui FROM rxnorm_synonyms');
  const classes = db.query('SELECT class_id, name, description FROM rxclass_classes');
  const members = db.query('SELECT rxcui, class_id FROM rxclass_members');
  const guidance = db.query('SELECT topic_id, advice, source FROM guidance');

  const byRxcui = new Map(ingredients.map((i) => [i.rxcui, i.name]));
  const classesOf = (rxcui) => members.filter((m) => m.rxcui === rxcui).map((m) => m.class_id);

  const matchIngredient = (rxcui, name, matchedTerm, kind) => ({
    rxcui,
    name,
    matched_term: matchedTerm,
    matched_kind: kind,
    classes: classesOf(rxcui).map((id) => {
      const c = classes.find((x) => x.class_id === id);
      return { class_id: id, name: c?.name, description: c?.description };
    }),
  });

  const found = [];
  const seen = new Set();
  const add = (entry) => {
    if (!seen.has(entry.rxcui + ':' + entry.matched_term)) {
      seen.add(entry.rxcui + ':' + entry.matched_term);
      found.push(entry);
    }
  };

  for (const t of tokens) {
    for (const ing of ingredients) {
      if (ing.name.toLowerCase() === t || ing.name.toLowerCase().includes(t)) {
        add(matchIngredient(ing.rxcui, ing.name, t, 'ingredient'));
      }
    }
    for (const syn of synonyms) {
      if (syn.term.toLowerCase() === t || syn.term.toLowerCase().includes(t)) {
        add(matchIngredient(syn.rxcui, byRxcui.get(syn.rxcui), t, syn.kind || 'synonym'));
      }
    }
  }

  const matchedClasses = classes
    .filter((c) => tokens.some((t) => c.name.toLowerCase().includes(t) || c.class_id.toLowerCase().includes(t)))
    .map((c) => ({
      class_id: c.class_id,
      name: c.name,
      description: c.description,
      members: members
        .filter((m) => m.class_id === c.class_id)
        .map((m) => ({ rxcui: m.rxcui, name: byRxcui.get(m.rxcui) })),
    }));

  const matchedGuidance = guidance.filter((g) =>
    tokens.some((t) => g.topic_id.toLowerCase().includes(t) || g.advice.toLowerCase().includes(t))
  );

  return {
    query,
    source: 'general_health.db (RxNorm / RxClass / guidance) — read-only',
    ingredients: found,
    classes: matchedClasses,
    guidance: matchedGuidance,
    found_anything: found.length + matchedClasses.length + matchedGuidance.length > 0,
    ...(found.length + matchedClasses.length + matchedGuidance.length === 0
      ? { note: 'Nothing matched in the knowledge base. Do not infer a drug or class from memory.' }
      : {}),
  };
}

module.exports = { search };
