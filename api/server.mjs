/**
 * Protocol extraction service.
 *
 * The frontend cannot run the parser: it needs Node, the OpenAI key, and
 * medical_data's SQLite cache. So the upload posts the file here, this runs
 * recognize/extract.ts, and returns a ProtocolExtraction — the exact shape
 * `registerProtocolExtractor` expects.
 *
 *   node api/server.mjs          # listens on 5174
 *
 * POST /agent/extract-protocol   multipart file  -> ProtocolExtraction
 * GET  /agent/trials             -> { trials, protocols } as they are on disk
 * POST /agent/trials             { trial, protocol } -> persists to patient_data/
 * POST /agent/sessions           { session, identity, transcript } -> review queue
 * GET  /agent/sessions           -> { sessions, transcripts, audit } as published so far
 * GET  /agent/identity           -> identity check per session
 * GET  /agent/participants       -> Participant[]
 * POST /agent/participants       Participant -> upsert by subject id
 *
 * There is no DELETE for a participant. Leaving a study is a disposition
 * event carried on the record itself; the row is never removed.
 */
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* may already be set */ }

const { extractProtocol } = await import(join(ROOT, 'recognize', 'extract.ts'));

const PORT = 5174;
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Minimal multipart reader — one file field, which is all this endpoint takes. */
function fileFromMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? '');
  if (!m) throw new Error('missing multipart boundary');
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const headEnd = buf.indexOf('\r\n\r\n', start);
    if (headEnd === -1) break;
    const head = buf.subarray(start, headEnd).toString();
    const next = buf.indexOf(boundary, headEnd);
    if (next === -1) break;
    const name = /filename="([^"]*)"/i.exec(head)?.[1];
    if (name) return { filename: name, data: buf.subarray(headEnd + 4, next - 2) };
    start = next;
  }
  throw new Error('no file part found');
}

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    return res.end();
  }

  try {
    if (req.method === 'POST' && req.url === '/agent/extract-protocol') {
      const { filename, data } = fileFromMultipart(await body(req), req.headers['content-type']);
      const dir = mkdtempSync(join(tmpdir(), 'protocol-'));
      const path = join(dir, filename || 'protocol.pdf');
      writeFileSync(path, data);
      console.log(`extracting ${filename} (${(data.length / 1e6).toFixed(1)} MB)…`);
      const extraction = await extractProtocol(path);
      console.log(`  -> ${extraction.studyId.value ?? '?'} · ${extraction.rules.length} rules`);
      return json(res, 200, { ...extraction, source: 'agent', filename, sizeBytes: data.length, tmpPath: path });
    }

    if (req.method === 'GET' && req.url === '/agent/trials') {
      return json(res, 200, {
        trials: JSON.parse(readFileSync(join(ROOT, 'patient_data', 'trials', 'trials.json'), 'utf8')),
        protocols: JSON.parse(readFileSync(join(ROOT, 'patient_data', 'trials', 'protocols.json'), 'utf8')),
      });
    }

    const rosterPath = join(ROOT, 'patient_data', 'participants', 'participants.json');
    const partDir = join(ROOT, 'patient_data', 'participants');
    const loadJson = (f, fallback) => {
      try { return JSON.parse(readFileSync(join(partDir, f), 'utf8')); } catch { return fallback; }
    };
    const saveJson = (f, v) => writeFileSync(join(partDir, f), `${JSON.stringify(v, null, 2)}\n`);

    if (req.method === 'GET' && req.url === '/agent/identity') {
      return json(res, 200, loadJson('identity.json', {}));
    }

    if (req.method === 'GET' && req.url === '/agent/sessions') {
      return json(res, 200, {
        sessions: loadJson('sessions.json', []),
        transcripts: loadJson('transcripts.json', {}),
        audit: loadJson('audit.json', {}),
      });
    }

    if (req.method === 'POST' && req.url === '/agent/sessions') {
      const { session, identity, transcript } = JSON.parse((await body(req)).toString());

      const sessions = loadJson('sessions.json', []);
      const i = sessions.findIndex((s) => s.sessionId === session.sessionId);
      if (i === -1) sessions.push(session); else sessions[i] = session;
      saveJson('sessions.json', sessions);

      if (transcript?.length) {
        const all = loadJson('transcripts.json', {});
        all[session.sessionId] = transcript;
        saveJson('transcripts.json', all);
      }

      if (identity) {
        const checks = loadJson('identity.json', {});
        checks[session.sessionId] = identity;
        saveJson('identity.json', checks);
      }

      // The call itself is a fact worth keeping whatever the identity outcome.
      const audit = loadJson('audit.json', {});
      audit[session.sessionId] = [
        ...(audit[session.sessionId] ?? []),
        {
          eventId: `EV-${session.sessionId.slice(0, 6)}-ID`,
          at: session.endedAt,
          actor: 'Voice agent',
          action: 'call_ended',
          changeId: null,
          detail: identity?.outcome === 'verified'
            ? `${session.changes.length} proposed change(s) staged · identity verified`
            : `Identity ${identity?.outcome ?? 'not checked'} after ${identity?.attempts ?? 0} attempt(s) — nothing staged for review`,
          reason: null,
        },
      ];
      saveJson('audit.json', audit);

      console.log(`published ${session.sessionId} · ${session.changes.length} change(s) · identity ${identity?.outcome}`);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && req.url === '/agent/participants') {
      return json(res, 200, JSON.parse(readFileSync(rosterPath, 'utf8')));
    }

    if (req.method === 'POST' && req.url === '/agent/participants') {
      const participant = JSON.parse((await body(req)).toString());
      const roster = JSON.parse(readFileSync(rosterPath, 'utf8'));
      const i = roster.findIndex((p) => p.subjectId === participant.subjectId);
      if (i === -1) roster.push(participant); else roster[i] = participant;
      writeFileSync(rosterPath, `${JSON.stringify(roster, null, 2)}\n`);
      console.log(
        `${i === -1 ? 'enrolled' : 'updated'} ${participant.subjectId}` +
        `${participant.discontinuation ? ` · ${participant.discontinuation.reason}` : ''}`,
      );
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/agent/trials') {
      const { trial, protocol, file } = JSON.parse((await body(req)).toString());
      const trialsPath = join(ROOT, 'patient_data', 'trials', 'trials.json');
      const protosPath = join(ROOT, 'patient_data', 'trials', 'protocols.json');
      const trials = JSON.parse(readFileSync(trialsPath, 'utf8'));
      const protos = JSON.parse(readFileSync(protosPath, 'utf8'));

      const i = trials.findIndex((t) => t.studyId === trial.studyId);
      if (i === -1) trials.push(trial); else trials[i] = { ...trials[i], ...trial };
      if (protocol) {
        // Match the file's convention: scheduling times are an offset from today.
        const d = new Date(protocol.uploadedAt ?? Date.now());
        const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        protos[trial.studyId] = {
          ...protocol,
          uploadedAt: {
            dayOffset: Math.round((day - midnight) / 86400000),
            time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          },
        };
      }

      // Keep the document beside the trial, where the app serves it from.
      if (file?.tmpPath) {
        console.log(`  filing ${file.filename}`);
        const dir = join(ROOT, 'patient_data', 'trials', trial.studyId);
        mkdirSync(dir, { recursive: true });
        copyFileSync(file.tmpPath, join(dir, file.filename));
      }
      writeFileSync(trialsPath, `${JSON.stringify(trials, null, 2)}\n`);
      writeFileSync(protosPath, `${JSON.stringify(protos, null, 2)}\n`);
      console.log(`${i === -1 ? 'created' : 'updated'} ${trial.studyId}${file?.tmpPath ? '' : ' (no document)'}`);
      return json(res, 200, { ok: true, created: i === -1 });
    }

    json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}).listen(PORT, () => console.log(`protocol extraction service on http://localhost:${PORT}`));
