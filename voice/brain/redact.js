'use strict';

/**
 * Strips direct identifiers from a transcript.
 *
 * A call transcript legitimately contains a name and a date of birth — you
 * cannot verify identity without them. But the recording is source data living
 * in an access-controlled system; what crosses into the clinical record is
 * de-identified, subject id only. Name and date of birth are two of the
 * eighteen HIPAA identifiers.
 *
 * So the identity exchange is kept — a coordinator has to see that
 * verification happened — and the identifiers inside it are replaced. The
 * structured outcome (verified / failed / attempts) is carried separately.
 *
 * This runs at the boundary — in bridge.js when a call publishes, and in the
 * recorder when a transcript is written — so nothing reaches disk or the
 * clinical store unredacted by forgetting a step. It is deliberately free of
 * database imports so the ESM scripts can load it too.
 */
const { findDateSpans } = require('./dates');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function redactText(text, whoRaw) {
  const who = normalise(whoRaw);
  if (!text || !who) return text;
  let out = String(text);
  // Parsed, not pattern-listed. An enumerated list of spellings let a
  // mis-said ordinal through once; anything that parses to the date of birth
  // on file is the date of birth, however it was said.
  for (const span of findDateSpans(out, who.dob)) out = out.split(span).join('[date of birth]');
  const given = who.given_name || '';
  const family = who.family_name || '';
  if (given && family) out = out.split(`${given} ${family}`).join('[name]');
  if (family) {
    out = out.replace(new RegExp(`\\b(Mr|Mrs|Ms|Dr)\\.?\\s+${escape(family)}\\b`, 'gi'), '$1. [name]');
    out = out.replace(new RegExp(`\\b${escape(family)}\\b`, 'g'), '[name]');
  }
  if (given) out = out.replace(new RegExp(`\\b${escape(given)}\\b`, 'g'), '[name]');
  return out.replace(/\[name\](,?\s*\[name\])+/g, '[name]');
}

/**
 * `who` may come from the call database (given_name/family_name) or from the
 * contacts file (given/family). Accept both rather than making callers reshape.
 */
function normalise(who) {
  if (!who) return null;
  return {
    given_name: who.given_name || who.given || '',
    family_name: who.family_name || who.family || '',
    dob: who.dob || '',
  };
}

/**
 * `people` is one person or several. A caregiver on the call is named aloud as
 * often as the participant is, and their name is no more publishable — they
 * did not consent to appear in a clinical record either.
 */
function redactTurns(turns, people) {
  const list = (Array.isArray(people) ? people : [people]).map(normalise).filter(Boolean);
  if (!list.length) return turns;
  return turns.map((t) => ({
    ...t,
    text: list.reduce((text, person) => redactText(text, person), t.text),
  }));
}

module.exports = { redactText, redactTurns, normalise };
