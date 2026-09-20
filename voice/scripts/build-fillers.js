#!/usr/bin/env node
'use strict';

/**
 * Pre-generate the agent's conversational fillers — "Mm-hm.", "Hmm...", "Give
 * me a second." — as static audio, so they play with zero latency instead of
 * waiting on text-to-speech.
 *
 *   node scripts/build-fillers.js                 # writes public/fillers/*.mp3 + manifest.json
 *   node scripts/build-fillers.js --experimental  # bare hmm/um/uh clips to audition
 *
 * Each clip is then sent back through Deepgram speech-to-text (with filler words
 * kept, or it would silently drop the very sounds being checked) and the transcript
 * printed, as a check that "Hmm." was voiced as "hmm" and not a mispronounced
 * word. Listen to the files and delete or reword any that sound off; re-running
 * regenerates everything, and the client reads whatever the manifest lists.
 *
 * What survives is what the voice can actually say. Aura-2 cannot voice bare
 * "um" / "uh" / "hmm" from text (every spelling came back as silence or a
 * breath; checked with the transcript round-trip below), so the bank sticks to
 * clips that come back audible: "Mm-hm", "Uh-huh", "Ah", "Oh", and real words.
 * A leading "Hmm," or "Um," comes out as roughly a second of silence before the
 * words, so phrases are written without them. For true hesitation sounds, see
 * --experimental.
 *
 * Played only as a quick backchannel right after the participant stops talking.
 * Deliberately nothing longer: phrases like "let me check" made it sound scripted.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('../brain/config'); // loads the repo-root .env

const VOICE = 'aura-asteria-en'; // keep in sync with VOICE_MODEL in public/app.js
const OUT = path.join(__dirname, '..', 'public', 'fillers');

// Only the small noises a listener makes — nothing that sounds like a phrase
// ("let me check", "let's see" read as robotic). Each is generated TAKES times:
// the voice reads it slightly differently every time, which is the variety.
const TAKES = 3;
const FILLERS = {
  ack: ['Mm-hm.', 'Mm-hmm.', 'Uh-huh.', 'Okay.'],
};

// Bare hesitation sounds, voiced by OpenAI instead (Aura-2 can't). Written to
// public/fillers/experimental/ and NOT added to the manifest: it is a different
// voice from the rest, so listen first and only move a clip into the bank if it
// blends in. Slow (0.5-2 s) so only ever usable pre-generated, never live.
const EXPERIMENTAL = ['Hmm.', 'Hmm...', 'Um...', 'Uh...', 'Uh, let me see.', 'Hmm, okay.', 'Mmm.', 'Ahh.'];

const key = process.env.DEEPGRAM_API_KEY;
if (!key) {
  console.error('DEEPGRAM_API_KEY is not set (repo-root .env).');
  process.exit(1);
}

async function speak(text) {
  const res = await fetch(`https://api.deepgram.com/v1/speak?model=${VOICE}`, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/**
 * Cut dead air off both ends of a clip. TTS pads "..." with a long trailing
 * silence, and a clip that cannot be interrupted must not hold the floor for
 * longer than it is actually talking. Keeps a short natural tail. No-op
 * (with a warning) when ffmpeg is not installed.
 */
function trim(file) {
  if (!hasFfmpeg) return;
  const tmp = `${file}.trim.mp3`;
  const cut = 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.04';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-af', `${cut},areverse,${cut.replace('0.04', '0.14')},areverse`, '-q:a', '4', tmp]);
  fs.renameSync(tmp, file);
}

function durationMs(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString();
    return Math.round(parseFloat(out) * 1000);
  } catch {
    return null;
  }
}

async function heardAs(audio) {
  const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=false&punctuate=false&filler_words=true', {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/mpeg' },
    body: audio,
  });
  if (!res.ok) return '(stt failed)';
  const data = await res.json();
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '(nothing heard)';
}

async function experimental() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set (repo-root .env).');
  const dir = path.join(OUT, 'experimental');
  fs.mkdirSync(dir, { recursive: true });
  for (const [i, text] of EXPERIMENTAL.entries()) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: 'coral',
        input: text,
        response_format: 'mp3',
        instructions: 'Warm, calm, natural phone voice. Voice the hesitation sounds exactly as written, like a real person thinking.',
      }),
    });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
    const audio = Buffer.from(await res.arrayBuffer());
    const file = `exp-${String(i + 1).padStart(2, '0')}.mp3`;
    fs.writeFileSync(path.join(dir, file), audio);
    console.log(`${file}  ${String(Math.round(audio.length / 1024)).padStart(3)} KB  ${JSON.stringify(text)}`);
  }
  console.log(`\nListen in ${dir}. They are not in the manifest; the app ignores them.`);
}

(async () => {
  if (process.argv.includes('--experimental')) return experimental();
  // Rebuild the bank, but keep anything listened to in experimental/.
  for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
    if (f !== 'experimental') fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
  }
  fs.mkdirSync(OUT, { recursive: true });
  if (!hasFfmpeg) console.warn('ffmpeg not found: clips are left untrimmed (install ffmpeg for tighter timing).');
  const manifest = { voice: VOICE, fillers: [] };

  for (const [kind, phrases] of Object.entries(FILLERS)) {
    let n = 0;
    for (const text of phrases.flatMap((t) => Array(TAKES).fill(t))) {
      const id = `${kind}-${String(++n).padStart(2, '0')}`;
      const audio = await speak(text);
      const file = path.join(OUT, `${id}.mp3`);
      fs.writeFileSync(file, audio);
      trim(file);
      const ms = durationMs(file);
      manifest.fillers.push({ id, kind, text, file: `${id}.mp3`, ms });
      const heard = await heardAs(fs.readFileSync(file));
      console.log(`${id.padEnd(9)} ${String(ms ?? '?').padStart(5)} ms  said ${JSON.stringify(text).padEnd(28)} heard ${JSON.stringify(heard)}`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n${manifest.fillers.length} clips -> ${OUT}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
