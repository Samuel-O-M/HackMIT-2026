'use strict';

/**
 * Terminal harness for the brain.
 *
 *   node cli.js                 # list participants
 *   node cli.js 0412            # interactive chat (talker) + planner state
 *   node cli.js 0412 "hello"    # single turn
 *
 * The talker answers immediately; the planner runs after and its state is shown.
 */

const brain = require('./brain');

const subjectId = process.argv[2];
const oneShot = process.argv[3];

function showState(state) {
  if (!state) return console.log('  (planner: no state yet)');
  console.log('  goal     :', state.goal || '—');
  console.log('  known    :', (state.known || []).map((k) => k.fact).join(' | ') || '—');
  console.log('  missing  :', (state.missing || []).join(' | ') || '—');
  console.log('  next Q   :', (state.next_questions || []).join(' | ') || '—');
  if (state.flags?.length) console.log('  flags    :', JSON.stringify(state.flags));
}

async function runTurn(session, text) {
  const { say } = await brain.handleTurn({ sessionId: session.session_id, subjectId, userText: text });
  console.log(`PATIENT : ${text}`);
  console.log(`TALKER  : ${say}`);
  // In a real call this happens in the background while the conversation continues.
  await brain.waitForIdle(session.session_id);
  const status = brain.plannerStatus(session.session_id);
  console.log(`  [planner ${status.lastPlanModel || ''}${status.running ? ' running' : ''}]`);
  showState(brain.getState(session.session_id));
  if (status.errors.length) console.log('  planner errors:', status.errors);
  console.log('');
}

async function main() {
  brain.init();

  if (!subjectId) {
    console.log('Participants:');
    for (const p of brain.listPatients()) {
      console.log(`  ${p.subject_id}  ${p.given_name} ${p.family_name}  (${p.study_id}: ${p.study_title})`);
    }
    console.log('\nUsage: node cli.js <subject_id> ["single message"]');
    return;
  }

  const session = brain.startSession(subjectId);
  console.log(`Session ${session.session_id} with ${subjectId}\n`);

  if (oneShot) {
    await runTurn(session, oneShot);
    brain.endSession(session.session_id);
    brain.close();
    return;
  }

  const readline = require('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('Type what the patient says. /state to print planner state, Ctrl+C to exit.\n');
  try {
    for (;;) {
      const text = (await rl.question('you> ')).trim();
      if (!text) continue;
      if (text === '/quit') break;
      if (text === '/state') {
        showState(brain.getState(session.session_id));
        continue;
      }
      await runTurn(session, text);
    }
  } finally {
    rl.close();
    brain.endSession(session.session_id);
    brain.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.stack || err.message);
  process.exit(1);
});
