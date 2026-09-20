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
const endSignal = require('../endSignal');

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
      'protocol rules. Returns only rules that apply DURING treatment — rules that governed ' +
      'the period before the first dose are already satisfied by an enrolled participant and ' +
      'are reported separately under screening_only, which you must not raise. Membership ' +
      'only: a rule\'s dose_limit still has to be checked against what they reported.',
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
    const key = `${r.rule_type}|${r.protocol_section}|${r.rationale}|${r.applies_when}`;
    const rule = rules.get(key) ?? { ruleId: key, ...r, classIds: [], rxcuis: [] };
    if (r.class_id) rule.classIds.push(r.class_id);
    if (r.rxcui) rule.rxcuis.push(r.rxcui);
    rules.set(key, rule);
  }
  const { hits, unavailable } = await drugdb.checkProhibited(String(args.rxcui), [...rules.values()]);
  if (unavailable) return { rxcui: args.rxcui, error: 'Drug database unreachable; cannot check. Do not guess.' };

  // A participant on this call has been dosed, so a rule that only governed
  // the run-up to the first dose is already satisfied and cannot be breached
  // now. Matching it and reporting it as prohibited would manufacture a
  // deviation out of a screening requirement they met months ago.
  const live = hits.filter((h) => rules.get(h.ruleId).applies_when !== 'before_first_dose');
  const screeningOnly = hits.filter((h) => rules.get(h.ruleId).applies_when === 'before_first_dose');

  const describe = (h) => {
    const r = rules.get(h.ruleId);
    return {
      rule_type: r.rule_type,
      protocol_section: r.protocol_section,
      rationale: r.rationale,
      applies_when: r.applies_when,
      // Surfaced so the agent can see a ban is conditional. Membership alone
      // was being reported as prohibited, with no way to tell that the rule
      // only bites above a dose.
      dose_limit: r.threshold || null,
      washout_window: r.washout_window || null,
      via: h.via,
      matched: h.matched,
      class_name: h.className,
    };
  };

  return {
    rxcui: args.rxcui,
    // rule_type is 'prohibited_drug' or 'prohibited_class' in the database;
    // only the bare string 'prohibited' was being compared, so a matched class
    // rule reported prohibited:false and the agent moved on. 'monitored' rules
    // deliberately do not set this.
    prohibited: live.some((h) => String(rules.get(h.ruleId).rule_type || '').startsWith('prohibited')),
    hits: live.map(describe),
    ...(screeningOnly.length
      ? {
          screening_only: screeningOnly.map(describe),
          note:
            'One or more rules matched but apply only before the first dose. This ' +
            'participant is already enrolled, so they are not breached. Do not raise them.',
        }
      : {}),
    ...(live.length === 0 && screeningOnly.length === 0
      ? { note: 'No protocol rule matched this drug.' }
      : {}),
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
          enum: [
            'set_planner_state', 'add_medication_change', 'add_advice',
            'add_adherence_report', 'add_behaviour_report', 'add_symptom_report',
          ],
        },
        payload: {
          type: 'object',
          description:
            'For add_medication_change: {reported_text, canonical_name, rxcui, status, start_date, stop_date, precision}. ' +
            'For add_advice: {topic_id, text}. For set_planner_state: {state}. ' +
            'For add_adherence_report: {canonical_name, is_study_drug, extent, days_missed, recall_days, reasons[], reported_text} ' +
            'where extent is as_prescribed|missed_some|stopped|never_started|unknown. ' +
            'For add_behaviour_report: {behaviour_code, status, frequency, quantity, period, instrument, instrument_score, reported_text} ' +
            'where status is reported|denied|declined_to_answer|unknown. ' +
            'For add_symptom_report: {canonical_name, is_study_drug, symptom, severity, since, ' +
            'since_precision, on_label, label_source, reported_text} — record what they said, ' +
            'never a causality or severity judgement of your own.',
        },
      },
      required: ['op', 'payload'],
    },
  },
};

const checkBehaviourSchema = {
  type: 'function',
  function: {
    name: 'check_behaviour',
    description:
      'Check a non-drug behaviour (alcohol, nicotine, grapefruit, contraception, blood ' +
      'donation, sun exposure, strenuous exercise) against this participant\'s protocol. ' +
      'Returns the rule, including whether it is prohibited, restricted to a threshold, ' +
      'monitored, or REQUIRED — a required rule is breached by absence, not by presence.',
    parameters: {
      type: 'object',
      properties: {
        behaviour_code: {
          type: 'string',
          description:
            'alcohol | nicotine | grapefruit | contraception | blood_donation | ' +
            'sun_exposure | strenuous_exercise | recreational_drugs | caffeine',
        },
      },
      required: ['behaviour_code'],
    },
  },
};

const verifyCaregiverSchema = {
  type: 'function',
  function: {
    name: 'verify_caregiver',
    description:
      'Check whether someone other than the participant may be spoken to. Call this the ' +
      'moment a second person joins or answers. Returns authorised true/false only — it ' +
      'never reveals who is on the list. Someone stating a relationship is NOT ' +
      'authorisation; only this tool is.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'full name as stated, if given' },
        given_name: { type: 'string' },
        family_name: { type: 'string' },
        relationship: { type: 'string', description: 'as stated, e.g. daughter, husband, carer' },
      },
      required: [],
    },
  },
};

const drugSafetySchema = {
  type: 'function',
  function: {
    name: 'drug_safety',
    description:
      "Look up a drug's FDA label (openFDA) for its documented side effects and get " +
      'grounded follow-up questions to ask about it. Call this before asking a participant ' +
      'how they are getting on with a medication. Never name a side effect the label did ' +
      'not list — returns {symptoms, questions, source}. Ask the open question first; the ' +
      'suggested symptoms are a prompt of last resort, never a checklist to read out.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Generic/ingredient name, e.g. "metformin hydrochloride", "ibuprofen".',
        },
      },
      required: ['name'],
    },
  },
};

const setCallOutcomeSchema = {
  type: 'function',
  function: {
    name: 'set_call_outcome',
    description:
      'Record how the call ended. Call this before the call finishes, ALWAYS — including ' +
      'when everything went fine. Without it an empty call is read as "nothing has ' +
      'changed", which is a clinical finding, when it may mean the questions were never ' +
      'asked. If the participant asks to be called back, use reschedule_requested and put ' +
      'their own words in callback_text.',
    parameters: {
      type: 'object',
      properties: {
        outcome: {
          type: 'string',
          enum: [
            'completed', 'partial', 'reschedule_requested', 'no_answer', 'declined',
            'unable_to_verify', 'participant_unavailable', 'abandoned', 'agent_error',
          ],
          description:
            'completed = the whole sweep was walked. partial = it started but ended ' +
            'early. reschedule_requested = they asked to be called back. declined = they ' +
            'did not want to take part. participant_unavailable = they could not do it ' +
            'and offered no other time.',
        },
        detail: { type: 'string', description: 'One line, in their words where possible.' },
        callback_text: {
          type: 'string',
          description: 'When they asked to be called back, exactly as they said it.',
        },
        callback_after: {
          type: 'string',
          description:
            'ISO timestamp ONLY if they gave a real one. Never convert "tomorrow ' +
            'morning" into a time — leave this out and keep their words.',
        },
      },
      required: ['outcome'],
    },
  },
};

const endCallSchema = {
  type: 'function',
  function: {
    name: 'end_call',
    description:
      'Hang up. Call this once the conversation is genuinely over — after you have said ' +
      'your final line. The call ends about a second after the last words are spoken. Say ' +
      'your goodbye in the same turn, then call this; never ask anything after it. Do not ' +
      'call it while there is still a question to ask or an answer to wait for.',
    parameters: { type: 'object', properties: {}, required: [] },
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
  drug_safety: {
    schema: drugSafetySchema,
    run: (args) => require('../../../api/medical_data/openfda').drugSafety(args.name),
  },
  set_call_outcome: {
    schema: setCallOutcomeSchema,
    run: (args, ctx) => patientData.setCallOutcome({ ...args, sessionId: ctx.sessionId }),
  },
  end_call: {
    schema: endCallSchema,
    run: (args, ctx) => {
      endSignal.request(ctx.sessionId);
      return { ok: true, ending: true };
    },
  },
  check_behaviour: {
    schema: checkBehaviourSchema,
    run: (args, ctx) => patientData.checkBehaviour({ ...args, subjectId: ctx.subjectId }),
  },
  verify_caregiver: {
    schema: verifyCaregiverSchema,
    run: (args, ctx) => patientData.verifyCaregiver({ ...args, subjectId: ctx.subjectId, sessionId: ctx.sessionId }),
  },
};

function schemasFor(which) {
  if (which === 'thinker') {
    return [
      ALL.health_search.schema, ALL.check_prohibited.schema, ALL.patient_read.schema,
      ALL.verify_identity.schema, ALL.check_behaviour.schema, ALL.drug_safety.schema,
      ALL.set_call_outcome.schema, ALL.end_call.schema,
    ];
  }
  return [
    ALL.health_search.schema,
    ALL.check_prohibited.schema,
    ALL.patient_read.schema,
    ALL.patient_update.schema,
    ALL.verify_identity.schema,
    ALL.check_behaviour.schema,
    ALL.verify_caregiver.schema,
    ALL.drug_safety.schema,
    ALL.set_call_outcome.schema,
    ALL.end_call.schema,
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
