'use strict';

/**
 * Tool registry shared by both agents.
 *
 *   health_search   — read-only medical knowledge (RxNorm/RxClass/guidance)
 *   patient_read    — scoped reads of patient data
 *   patient_update  — controlled writes (named operations only)
 *
 * The Talker gets all three (it may need to write immediately); the Thinker
 * gets the read tools and expresses writes as structured `to_save` items that
 * the orchestrator applies.
 */

const health = require('./health');
const patientData = require('./patient');

const healthSearchSchema = {
  type: 'function',
  function: {
    name: 'health_search',
    description:
      'Look up a drug, brand name, or drug class in the medical knowledge base ' +
      '(RxNorm ingredients/synonyms + RxClass classes). This is the ONLY source ' +
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
    return [ALL.health_search.schema, ALL.patient_read.schema, ALL.verify_identity.schema];
  }
  return [
    ALL.health_search.schema,
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
