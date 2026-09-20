'use strict';

/**
 * Tool registry shared by both agents.
 *
 *   health_search   — read-only medical knowledge (RxNorm/RxClass/guidance)
 *   check_prohibited — does a resolved drug trip this participant's protocol rules?
 *   patient_read    — scoped reads of patient data
 *   patient_update  — controlled writes (named operations only)
 *
 * The Talker gets all three (it may need to write immediately); the Thinker
 * gets the read tools and expresses writes as structured `to_save` items that
 * the orchestrator applies.
 */

const health = require('./health');
const patientData = require('./patient');
const drugdb = require('../../../api/medical_data');

const healthSearchSchema = {
  type: 'function',
  function: {
    name: 'health_search',
    description:
      'Look up a drug, brand name, or drug class in the medical knowledge base ' +
      '(RxNorm names/brands + RxClass/ATC classes). This is the ONLY source ' +
      'of medical facts; if it returns nothing, say you do not know.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Drug name, brand, or class to look up.' },
      },
      required: ['query'],
    },
  },
};

const checkProhibitedSchema = {
  type: 'function',
  function: {
    name: 'check_prohibited',
    description:
      'Check a resolved drug (by rxcui, from health_search) against the current participant\'s ' +
      'protocol rules. Membership only: a rule\'s dose or timing limit still has to be checked ' +
      'against what the participant reported.',
    parameters: {
      type: 'object',
      properties: {
        rxcui: { type: 'string', description: 'RxCUI returned by health_search.' },
      },
      required: ['rxcui'],
    },
  },
};

async function checkProhibited(args, ctx) {
  const rows = patientData.read({ scope: 'protocol_rules', subjectId: ctx.subjectId, sessionId: ctx.sessionId });
  // One protocol rule may span several class ids (one row each); group them back.
  const rules = new Map();
  for (const r of rows) {
    const key = `${r.rule_type}|${r.protocol_section}|${r.rationale}`;
    const rule = rules.get(key) ?? { ruleId: key, ...r, classIds: [], rxcuis: [] };
    if (r.class_id) rule.classIds.push(r.class_id);
    if (r.rxcui) rule.rxcuis.push(r.rxcui);
    rules.set(key, rule);
  }
  const { hits, unavailable } = await drugdb.checkProhibited(String(args.rxcui), [...rules.values()]);
  if (unavailable) return { rxcui: args.rxcui, error: 'Drug database unreachable; cannot check. Do not guess.' };
  return {
    rxcui: args.rxcui,
    prohibited: hits.some((h) => rules.get(h.ruleId).rule_type === 'prohibited'),
    hits: hits.map((h) => {
      const r = rules.get(h.ruleId);
      return { rule_type: r.rule_type, protocol_section: r.protocol_section, rationale: r.rationale, via: h.via, matched: h.matched, class_name: h.className };
    }),
    ...(hits.length === 0 ? { note: 'No protocol rule matched this drug.' } : {}),
  };
}

const patientReadSchema = {
  type: 'function',
  function: {
    name: 'patient_read',
    description:
      'Read a specific slice of the current participant\'s record. Use small, ' +
      'targeted scopes — never request the whole record.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['profile', 'enrollment', 'medications', 'protocol_rules', 'planner_state', 'transcript', 'advice'],
          description: 'Which slice to read.',
        },
        limit: { type: 'integer', description: 'Max rows for transcript/advice (default 20).' },
      },
      required: ['scope'],
    },
  },
};

const patientUpdateSchema = {
  type: 'function',
  function: {
    name: 'patient_update',
    description: 'Apply a controlled write to the participant record.',
    parameters: {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          enum: ['set_planner_state', 'add_medication_change', 'add_advice'],
        },
        payload: {
          type: 'object',
          description:
            'For add_medication_change: {reported_text, canonical_name, rxcui, status, start_date, stop_date, precision}. ' +
            'For add_advice: {topic_id, text}. For set_planner_state: {state}.',
        },
      },
      required: ['op', 'payload'],
    },
  },
};

const verifyIdentitySchema = {
  type: 'function',
  function: {
    name: 'verify_identity',
    description:
      "Check the participant's stated name + date of birth against the record. Call this " +
      'instead of comparing the date yourself. Returns only verified/not-verified and ' +
      'attempts left — never the record value. On mismatch, do not reveal or hint at it.',
    parameters: {
      type: 'object',
      properties: {
        given_name: { type: 'string' },
        family_name: { type: 'string' },
        name: { type: 'string', description: 'full name as stated, if given' },
        dob: { type: 'string', description: 'date of birth exactly as the participant said it' },
      },
      required: ['dob'],
    },
  },
};

const ALL = {
  check_prohibited: { schema: checkProhibitedSchema, run: checkProhibited },
  health_search: { schema: healthSearchSchema, run: (args) => health.search(args.query) },
  patient_read: {
    schema: patientReadSchema,
    run: (args, ctx) => patientData.read({ ...args, subjectId: ctx.subjectId, sessionId: ctx.sessionId }),
  },
  patient_update: {
    schema: patientUpdateSchema,
    run: (args, ctx) => patientData.update({ ...args, subjectId: ctx.subjectId, sessionId: ctx.sessionId }),
  },
  verify_identity: {
    schema: verifyIdentitySchema,
    run: (args, ctx) => patientData.verifyIdentity({ ...args, subjectId: ctx.subjectId, sessionId: ctx.sessionId }),
  },
};

function schemasFor(which) {
  if (which === 'thinker') {
    return [ALL.health_search.schema, ALL.check_prohibited.schema, ALL.patient_read.schema, ALL.verify_identity.schema];
  }
  return [
    ALL.health_search.schema,
    ALL.check_prohibited.schema,
    ALL.patient_read.schema,
    ALL.patient_update.schema,
    ALL.verify_identity.schema,
  ];
}

async function dispatch(name, args, ctx) {
  const tool = ALL[name];
  if (!tool) return { error: `Unknown tool "${name}".` };
  try {
    return await tool.run(args || {}, ctx || {});
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

module.exports = { dispatch, schemasFor, NAMES: Object.keys(ALL) };
