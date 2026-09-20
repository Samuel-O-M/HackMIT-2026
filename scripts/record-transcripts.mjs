/**
 * Replaces the written-out transcripts with real calls.
 *
 * Both sides are live. The agent is the voice brain on localhost:8787. The
 * participant is a second model told only what this participant actually
 * knows — their medication log and the changes this session has to surface —
 * and asked to answer whatever the agent just said, one thing at a time.
 *
 * It reports which change it disclosed on each turn, which is what fills in
 * `yields` and keeps the capture panel in step with the words that caused it.
 *
 *   node scripts/record-transcripts.mjs [sessionId ...]
 *
 * Needs the voice server running and seeded (scripts/seed-voice-db.mjs).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* may already be set */ }

const BASE = 'http://localhost:8787';
const tPath = join(ROOT, 'patient_data', 'participants', 'transcripts.json');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const sessions = read('patient_data/participants/sessions.json');
const transcripts = read('patient_data/participants/transcripts.json');
const contacts = read('databases/call_sessions/contacts.json');

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

/** The participant. Knows their own medications and nothing else. */
async function participantSays(brief, history) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5.6-luna',
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: brief },
        { role: 'user', content: `The call so far:\n\n${history}\n\nReply as the participant.` },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'participant_turn', strict: true,
          schema: {
            type: 'object', additionalProperties: false,
            required: ['say', 'disclosedChangeId', 'nothingLeftToSay'],
            properties: {
              say: { type: 'string' },
              disclosedChangeId: { type: ['string', 'null'] },
              nothingLeftToSay: { type: 'boolean' },
            },
          },
        },
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `openai ${res.status}`);
  return JSON.parse(data.choices[0].message.content);
}

function briefFor(session, who) {
  const facts = session.changes.map((c) => {
    const e = c.proposed;
    const name = e.canonicalName ?? 'something you cannot name';
    const how = {
      add: `you have STARTED ${name}${e.dose ? ` ${e.dose}` : ''}${e.frequency ? `, ${e.frequency.toLowerCase()}` : ''}`,
      stop: `you have STOPPED ${name}`,
      modify: `your ${name} CHANGED from ${c.current?.dose ?? '?'} to ${e.dose ?? '?'}`,
      confirm_unchanged: `your ${name} is UNCHANGED`,
    }[c.changeType];
    return `- [${c.changeId}] ${how}. In your own words you would say it like: "${e.reportedText}"`;
  }).join('\n');

  return `You are ${who.given} ${who.family}, date of birth ${who.dob}, a participant in a clinical trial.
You are on the phone with the study team before your next visit. You are cooperative but ordinary —
you do not know medical terms, you use everyday words, and you often cannot remember exact dates or
strengths. Keep every reply to one or two short sentences, like real speech.

Things that are true about your medications right now:
${facts}

Rules:
- Answer whatever the agent just asked. Do not volunteer a new medication unless they ask
  something that invites it (for example "has anything new started", "anything over the counter",
  "any vaccinations", "any supplements") or you have run out of things they asked about.
- Disclose ONE item per turn at most. Set disclosedChangeId to that item's id in brackets, or null.
- If asked for a date or strength you would not know, say so plainly — do not invent one.
- Never mention the bracketed ids out loud.
- Set nothingLeftToSay true only once every item above has been disclosed and the agent is wrapping up.`;
}

const speakMs = (t) => Math.max(1600, Math.round((t.split(/\s+/).length / 2.7) * 1000));

const only = process.argv.slice(2);
const targets = sessions.filter((s) => (only.length ? only.includes(s.sessionId) : true));
console.log(`recording ${targets.length} call(s)\n`);

for (const session of targets) {
  const who = contacts[session.subjectId];
  if (!who) { console.log(`  ${session.sessionId}: no contact, skipped`); continue; }

  const { sessionId: brainId } = await post('/api/brain/session', { subjectId: session.subjectId });
  const brief = briefFor(session, who);
  const turns = [];
  let at = 0;
  const push = (speaker, text, yields) => {
    turns.push({ atMs: at, speaker, text, ...(yields?.length ? { yields } : {}) });
    at += speakMs(text) + 600;
  };

  // The participant picks up; every agent line after this is a real reply.
  let said = 'Hello?';
  let yields = null;
  const remaining = new Set(session.changes.map((c) => c.changeId));

  for (let turn = 0; turn < 26; turn++) {
    push('participant', said, yields ? [yields] : null);
    const reply = await post('/api/brain/turn', { sessionId: brainId, subjectId: session.subjectId, text: said });
    const agent = (reply.say || '').trim();
    if (!agent) break;
    const previous = [...turns].reverse().find((t) => t.speaker === 'agent')?.text ?? '';
    // Two near-identical replies means it has nothing left; do not record the echo.
    if (previous && agent.slice(0, 40).toLowerCase() === previous.slice(0, 40).toLowerCase()) break;
    push('agent', agent);
    if (/thank you for your time|goodbye|take care|have a good/i.test(agent) && remaining.size === 0) break;

    const history = turns.slice(-10).map((t) => `${t.speaker === 'agent' ? 'Agent' : 'You'}: ${t.text}`).join('\n');
    const next = turn === 0
      ? { say: `This is ${who.given} ${who.family}, date of birth ${who.dob}.`, disclosedChangeId: null, nothingLeftToSay: false }
      : await participantSays(brief, history);

    said = next.say.trim();
    yields = next.disclosedChangeId && remaining.has(next.disclosedChangeId) ? next.disclosedChangeId : null;
    if (yields) remaining.delete(yields);
    if (next.nothingLeftToSay && remaining.size === 0) {
      push('participant', said, yields ? [yields] : null);
      const bye = await post('/api/brain/turn', { sessionId: brainId, subjectId: session.subjectId, text: said });
      if (bye.say) push('agent', bye.say.trim());
      break;
    }
  }

  // The participant model does not always label a turn, especially when it is
  // simply agreeing that something is unchanged. Anything left unclaimed is
  // matched to the turn where its drug is actually named.
  for (const changeId of [...remaining]) {
    const change = session.changes.find((c) => c.changeId === changeId);
    const STOP = new Set(['the','one','and','for','you','that','with','your','this','same','from','have','take']);
    const terms = [
      (change.proposed.canonicalName ?? '').split(/[ ,(]/)[0],
      ...(change.proposed.indication ?? '').split(/[ ,]/),
      ...(change.proposed.reportedText ?? '').split(/[ ,.]/),
    ].map((w) => w.toLowerCase()).filter((w) => w.length >= 4 && !STOP.has(w));
    if (!terms.length) continue;
    const hit = turns.find((t) =>
      t.speaker === 'participant' && !t.yields &&
      terms.some((w) => t.text.toLowerCase().includes(w)));
    if (hit) { hit.yields = [changeId]; remaining.delete(changeId); }
  }

  await post('/api/brain/end', { sessionId: brainId, subjectId: session.subjectId }).catch(() => {});
  transcripts[session.sessionId] = turns;
  writeFileSync(tPath, `${JSON.stringify(transcripts, null, 2)}\n`);
  const got = session.changes.length - remaining.size;
  console.log(`  ${session.sessionId}  ${session.subjectId}  ${turns.length} turns · ${got}/${session.changes.length} changes surfaced${remaining.size ? ` · missed ${[...remaining].join(',')}` : ''}`);
}
console.log('\nwritten to patient_data/participants/transcripts.json');
