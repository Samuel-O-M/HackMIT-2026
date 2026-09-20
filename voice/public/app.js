'use strict';

/**
 * Clinical Call — one clean screen.
 *
 * Left: the call (transcript of what you say / what the agent says, with
 * start · mute · end). Right: what the brain is doing (grounding, planner
 * state, tool calls) and the offline session log.
 *
 * Audio path: mic → linear16 PCM over /ws/listen (Deepgram STT, key stays
 * server-side) → /api/brain/turn (Talker + background Planner) → /api/tts.
 */

(function () {
  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------------ state
  let sessionId = null;
  let subjectId = null;
  let call = null; // { ws, ctx, stream, source, processor }
  let muted = false;
  let pollTimer = null;
  let flushInterval = null;

  let interim = '';
  let pendingFinals = [];
  let queue = [];
  let turnBusy = false;
  let agentSpeaking = false;
  let currentAudio = null;
  let lastVoiceAt = 0;

  const conversation = []; // { speaker: 'patient'|'agent', transcript }
  const clientLog = []; // every event this page saw
  let brainSig = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------- logging
  function log(type, data = {}) {
    const ev = { ts: new Date().toISOString(), type, data };
    clientLog.push(ev);
    if (clientLog.length > 2000) clientLog.shift();
    const list = $('#logList');
    const row = document.createElement('div');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = ev.ts.slice(11, 23) + ' ';
    row.appendChild(t);
    row.appendChild(
      document.createTextNode(type + (Object.keys(data).length ? ' ' + safe(data) : ''))
    );
    list.appendChild(row);
    while (list.childNodes.length > 250) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
    $('#logCount').textContent = `${clientLog.length} events`;
  }

  const safe = (d) => {
    try {
      const s = JSON.stringify(data);
      return s.length > 160 ? s.slice(0, 157) + '…' : s;
    } catch {
      return '';
    }
  };

  async function downloadLog() {
    let serverLog = '';
    try {
      if (sessionId) serverLog = await (await fetch(`/api/brain/log?sessionId=${sessionId}`)).text();
    } catch { /* offline log may not exist yet */ }
    const blob = new Blob(
      [
        JSON.stringify(
          {
            sessionId,
            subjectId,
            savedAt: new Date().toISOString(),
            serverLogLines: serverLog ? serverLog.trim().split('\n').map((l) => {
              try { return JSON.parse(l); } catch { return l; }
            }) : [],
            clientEvents: clientLog,
          },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `call-log-${(subjectId || 'x')}-${sessionId ? sessionId.slice(0, 8) : 'nosession'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    log('log.downloaded', { clientEvents: clientLog.length, serverLogBytes: serverLog.length });
  }

  function showError(msg) {
    const el = $('#error');
    el.textContent = msg;
    el.hidden = false;
    log('error', { message: msg });
  }
  function clearError() {
    const el = $('#error');
    el.hidden = true;
    el.textContent = '';
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const m = data?.error?.message || data?.error?.err_msg || data?.error || `HTTP ${res.status}`;
      throw new Error(typeof m === 'string' ? m : JSON.stringify(m));
    }
    return data;
  }

  // ------------------------------------------------------------- status UI
  function setCallStatus(s) {
    const pill = $('#callStatus');
    pill.textContent = s;
    const kind = s.startsWith('listening') ? 'listening' : s.startsWith('thinking') ? 'thinking' : s.startsWith('speaking') ? 'speaking' : 'idle';
    pill.className = 'pill' + (kind === 'listening' ? ' ok' : kind === 'idle' ? '' : ' warn');
    if (sessionId) {
      fetch('/api/brain/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, state: kind }),
      }).catch(() => {});
      if (kind !== 'idle') log('channel', { state: kind });
    }
  }

  function setStt(state) {
    const pill = $('#sttPill');
    pill.classList.remove('hidden');
    pill.textContent = `STT ${state}`;
    pill.className = 'pill ' + (state === 'live' ? 'ok' : state === 'error' ? 'bad' : 'warn');
    log('stt.state', { state });
  }

  // ---------------------------------------------------------- conversation
  function renderConversation() {
    const box = $('#conversation');
    box.textContent = '';
    if (!conversation.length && !interim) {
      const p = document.createElement('p');
      p.className = 'muted small';
      p.textContent = 'Press “Start call”, then speak. Everything said appears here.';
      box.appendChild(p);
    }
    for (const turn of conversation) {
      const isUser = turn.speaker === 'patient';
      const d = document.createElement('div');
      d.className = 'msg ' + (isUser ? 'user' : 'agent');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = isUser ? 'You' : 'Agent';
      d.appendChild(who);
      d.appendChild(document.createTextNode(turn.transcript));
      box.appendChild(d);
    }
    if (interim) {
      const d = document.createElement('div');
      d.className = 'msg user interim';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = 'You · live';
      d.appendChild(who);
      d.appendChild(document.createTextNode(interim));
      box.appendChild(d);
    }
    box.scrollTop = box.scrollHeight;
  }

  // ------------------------------------------------------- side panels
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const pre = (obj) => {
    const p = document.createElement('pre');
    p.className = 'raw';
    p.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    return p;
  };
  const det = (summary, node, open = false) => {
    const d = document.createElement('details');
    d.className = 'acc';
    if (open) d.open = true;
    const s = document.createElement('summary');
    s.textContent = summary;
    d.appendChild(s);
    if (node) d.appendChild(node);
    return d;
  };
  const ul = (items, render) => {
    const u = document.createElement('ul');
    u.className = 'tight';
    for (const it of items) {
      const li = document.createElement('li');
      li.textContent = render ? render(it) : String(it);
      u.appendChild(li);
    }
    return u;
  };

  /** What the agent knows before speaking: the preloaded patient record. */
  function renderGrounding(patient, toolCalls) {
    const box = $('#grounding');
    box.textContent = '';
    if (patient) {
      const meds = patient.medications || [];
      box.appendChild(det(`current medications (${meds.length})`, meds.length
        ? ul(meds, (m) => `${m.canonical_name || m.reported_text}${m.dose ? ` · ${m.dose}` : ''}${m.frequency ? ` · ${m.frequency}` : ''}`)
        : pre([]), true));
      box.appendChild(det('profile & study', pre({ profile: patient.profile, enrollment: patient.enrollment })));
      const rules = patient.protocol_rules || [];
      if (rules.length) box.appendChild(det(`protocol rules (${rules.length})`, pre(rules)));
    }
    const tools = toolCalls || [];
    box.appendChild(tools.length
      ? det(`lookups this turn (${tools.length})`, pre(tools.map((c) => ({ tool: c.name, args: c.args, result: c.result }))))
      : Object.assign(document.createElement('p'), { className: 'muted small', textContent: 'No lookups on the last turn.' }));
  }

  function renderBrain(data) {
    const box = $('#brain');
    box.textContent = '';
    const st = data.state || {};
    const planner = data.planner || {};

    const pills = document.createElement('div');
    pills.className = 'row';
    for (const [txt, cls] of [
      [planner.running ? '⏳ planning' : '✓ planner idle', planner.running ? 'pill warn' : 'pill ok'],
      [planner.lastPlanModel || 'model —', 'pill'],
      [data.channel ? `channel: ${data.channel.state}` : 'channel —', 'pill'],
    ]) {
      const p = document.createElement('span');
      p.className = cls;
      p.textContent = txt;
      pills.appendChild(p);
    }
    box.appendChild(pills);

    if (planner.errors?.length) box.appendChild(det('planner errors', pre(planner.errors), true));
    const kv = (k, v) => {
      const d = document.createElement('div');
      d.className = 'kv';
      const a = document.createElement('span');
      a.textContent = k;
      const b = document.createElement('div');
      b.textContent = v == null || v === '' ? '—' : String(v);
      d.appendChild(a);
      d.appendChild(b);
      return d;
    };
    box.appendChild(kv('goal', st.goal));
    box.appendChild(kv('summary', st.summary));
    const known = st.known || [];
    box.appendChild(det(`known (${known.length})`, known.length ? ul(known, (k) => `${k.fact}${k.source ? `  [${k.source}]` : ''}`) : null));
    const missing = st.missing || [];
    box.appendChild(det(`missing (${missing.length})`, missing.length ? ul(missing) : null, missing.length > 0));
    const nq = st.next_questions || [];
    box.appendChild(det(`next questions (${nq.length})`, nq.length ? ul(nq) : null, nq.length > 0));
    const flags = st.flags || [];
    box.appendChild(det(`flags (${flags.length})`, flags.length ? ul(flags, (f) => `${f.type}: ${f.detail}${f.protocol_section ? ` (§${f.protocol_section})` : ''}`) : null, flags.length > 0));
    box.appendChild(det('planner state JSON', pre(st)));
    const lp = data.lastPlan;
    if (lp) {
      box.appendChild(det(`last planner run — ${lp.model || ''}`, pre({
        retrieval: lp.toolCalls || [],
        applied: lp.applied || [],
      })));
    }
  }

  // ------------------------------------------------------------- polling
  async function refresh() {
    if (!sessionId) return;
    try {
      const data = await fetchJson(`/api/brain/debug?sessionId=${encodeURIComponent(sessionId)}`);
      if (Array.isArray(data.conversation)) {
        conversation.length = 0;
        for (const t of data.conversation) conversation.push(t);
      }
      renderConversation();
      const sig = JSON.stringify({ p: data.patient ?? null, t: data.lastTurn?.talker?.toolCalls ?? null });
      if (sig !== brainSig?._g) {
        brainSig = brainSig || {};
        brainSig._g = sig;
        renderGrounding(data.patient, data.lastTurn?.talker?.toolCalls);
      }
      const bsig = JSON.stringify({ s: data.state ?? null, pl: data.planner ?? null, lp: data.lastPlan ?? null, ch: data.channel ?? null });
      if (bsig !== brainSig?._b) {
        brainSig = brainSig || {};
        brainSig._b = bsig;
        renderBrain(data);
        log('brain.update', {
          goal: data.state?.goal || null,
          missing: (data.state?.missing || []).length,
          flags: (data.state?.flags || []).length,
          plannerRunning: Boolean(data.planner?.running),
        });
      }
    } catch { /* transient */ }
  }

  async function refreshUntilIdle(attempts = 5, delay = 1300) {
    for (let i = 0; i < attempts; i++) {
      await refresh();
      await sleep(delay);
      if (!sessionId) return;
    }
  }

  // ---------------------------------------------------------------- audio
  async function agentSpeak(text) {
    const res = await fetch('/api/tts?model=aura-2-helena-en', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('TTS failed');
    const blob = await res.blob();
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
      currentAudio = null;
    }
    return new Promise((resolve) => {
      const audio = new Audio(URL.createObjectURL(blob));
      currentAudio = audio;
      agentSpeaking = true;
      setCallStatus('speaking…');
      const done = () => {
        agentSpeaking = false;
        currentAudio = null;
        if (call) setCallStatus('listening…');
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
      log('tts.played', { chars: text.length });
    });
  }

  async function doTurn(text) {
    while (agentSpeaking) await sleep(100);
    setCallStatus('thinking…');
    log('turn.sent', { text });
    try {
      const r = await fetchJson('/api/brain/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, subjectId, text }),
      });
      log('turn.replied', { say: r.say, tools: r.toolCalls, latencyMs: r.latencyMs });
      await refresh();
      const lastAgent = [...conversation].reverse().find((t) => t.speaker === 'agent');
      if (lastAgent?.transcript) await agentSpeak(lastAgent.transcript);
      refreshUntilIdle(4, 1300);
    } catch (err) {
      showError('Brain: ' + err.message);
    } finally {
      setCallStatus(call ? 'listening…' : 'idle');
    }
  }

  function enqueueTurn(text) {
    const t = (text || '').trim();
    if (!t) return;
    queue.push(t);
    pump();
  }

  async function pump() {
    if (turnBusy) return;
    turnBusy = true;
    try {
      while (queue.length) await doTurn(queue.shift());
    } finally {
      turnBusy = false;
    }
  }

  // ---- live STT: reply after a sustained silence that WE measure ----
  const silenceToReplyMs = () => 1500;
  const noteVoice = () => {
    lastVoiceAt = Date.now();
  };

  function maybeFlush() {
    if (!call || agentSpeaking || muted || !pendingFinals.length) return;
    if (Date.now() - lastVoiceAt >= silenceToReplyMs()) flushFinals();
  }

  function flushFinals() {
    if (!pendingFinals.length) return;
    const text = pendingFinals.join(' ').trim();
    pendingFinals = [];
    interim = '';
    if (text) enqueueTurn(text);
  }

  function handleStt(msg) {
    if (msg.type === 'Results') {
      const t = msg.channel?.alternatives?.[0]?.transcript || '';
      if (!t) return;
      if (msg.is_final) {
        pendingFinals.push(t);
        interim = '';
        noteVoice();
        log('stt.final', { text: t });
      } else {
        interim = t;
        noteVoice();
        if (call && !agentSpeaking && !muted) setCallStatus('listening…');
      }
      renderConversation();
    } else if (msg.type === 'SpeechStarted') {
      noteVoice();
      log('stt.speech_started', {});
    }
  }

  async function startCall() {
    if (call) return;
    clearError();
    try {
      subjectId = $('#patient').value;
      if (!subjectId) {
        showError('No participant selected.');
        return;
      }
      const s = await fetchJson('/api/brain/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId }),
      });
      sessionId = s.sessionId;
      const sp = $('#sessionPill');
      sp.textContent = `session ${sessionId.slice(0, 8)}… · ${subjectId}`;
      sp.classList.add('ok');
      log('session.start', { sessionId, subjectId });

      conversation.length = 0;
      interim = '';
      pendingFinals = [];
      queue = [];
      brainSig = null;
      renderConversation();

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const params = new URLSearchParams();
      params.set('model', 'nova-3');
      params.set('encoding', 'linear16');
      params.set('sample_rate', String(ctx.sampleRate));
      // Keep speech as words — smart_format rewrites spoken dates into digits,
      // which loses fidelity for identity checks.
      params.set('smart_format', 'false');
      params.set('numerals', 'false');
      params.set('punctuate', 'true');
      params.set('interim_results', 'true');
      params.set('vad_events', 'true');
      params.set('endpointing', '800');
      params.set('utterance_end_ms', '1500');

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/listen?${params}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => setStt('live');
      ws.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        handleStt(m);
      };
      ws.onerror = () => {
        setStt('error');
        showError('Live STT socket error');
      };
      ws.onclose = () => {
        if (call) endCall();
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (agentSpeaking || muted) return; // half-duplex + mute
        const f32 = e.inputBuffer.getChannelData(0);
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]));
          i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(i16.buffer);
      };
      source.connect(processor);
      processor.connect(ctx.destination);

      call = { ws, ctx, stream, source, processor };
      flushInterval = setInterval(maybeFlush, 200);
      $('#start').disabled = true;
      $('#mute').disabled = false;
      $('#end').disabled = false;
      setStt('live');
      setCallStatus('listening…');
      log('mic.start', { sampleRate: ctx.sampleRate });

      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(refresh, 1600);
      await refresh();
    } catch (err) {
      showError('Mic: ' + err.message);
      endCall();
    }
  }

  function toggleMute() {
    if (!call) return;
    muted = !muted;
    for (const t of call.stream.getAudioTracks()) t.enabled = !muted;
    const btn = $('#mute');
    btn.textContent = muted ? '🎙️ Unmute' : '🎙️ Mute';
    btn.classList.toggle('muted-on', muted);
    btn.classList.toggle('muted', muted);
    log(muted ? 'mute.on' : 'mute.off', {});
    if (muted) {
      interim = '';
      pendingFinals = [];
      renderConversation();
      if (!agentSpeaking) setCallStatus('muted — mic off');
    } else if (call) {
      setCallStatus('listening…');
    }
  }

  async function endCall() {
    const wasCall = call;
    if (!call) {
      setCallStatus('idle');
      return;
    }
    const { ws, ctx, stream, source, processor } = call;
    call = null;
    muted = false;
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    try { processor.disconnect(); } catch {}
    try { source.disconnect(); } catch {}
    try { stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { if (ws.readyState === WebSocket.OPEN) ws.close(); } catch {}
    try { ctx.close(); } catch {}
    flushFinals();
    $('#start').disabled = false;
    $('#mute').disabled = true;
    $('#mute').textContent = '🎙️ Mute';
    $('#mute').classList.remove('muted-on');
    $('#end').disabled = true;
    setCallStatus('idle');
    log('mic.stop', {});
    if (sessionId) {
      try {
        await fetchJson('/api/brain/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        log('session.end', { sessionId });
      } catch {}
    }
  }

  // ---------------------------------------------------------------- wiring
  $('#start').addEventListener('click', startCall);
  $('#mute').addEventListener('click', toggleMute);
  $('#end').addEventListener('click', endCall);
  $('#downloadLog').addEventListener('click', downloadLog);
  $('#clearLog').addEventListener('click', () => {
    $('#logList').textContent = '';
  });
  $('#typeInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = $('#typeInput').value.trim();
    if (v && sessionId) {
      enqueueTurn(v);
      log('turn.sent.typed', { text: v });
    }
    $('#typeInput').value = '';
  });
  $('#patient').addEventListener('change', () => {
    if (call) endCall();
    sessionId = null;
    $('#sessionPill').textContent = 'no session';
    $('#sessionPill').classList.remove('ok');
  });

  async function loadPatients() {
    try {
      const { patients } = await fetchJson('/api/patients');
      const sel = $('#patient');
      sel.textContent = '';
      for (const p of patients) {
        const opt = document.createElement('option');
        opt.value = p.subject_id;
        opt.textContent = `${p.subject_id} — ${p.given_name} ${p.family_name}`;
        sel.appendChild(opt);
      }
    } catch (err) {
      showError('Patients: ' + err.message);
    }
  }

  async function loadHealth() {
    try {
      const h = await fetchJson('/api/health');
      for (const key of ['deepgram', 'openai']) {
        const pill = $(`#status [data-key="${key}"]`);
        pill.textContent = `${key === 'deepgram' ? 'Deepgram' : 'OpenAI'}: ${h[key] ? 'set' : 'missing'}`;
        pill.classList.add(h[key] ? 'ok' : 'bad');
      }
    } catch {
      showError('Cannot reach the server. Is `node server.js` running?');
    }
  }

  loadPatients();
  loadHealth();
  setCallStatus('idle');
})();
