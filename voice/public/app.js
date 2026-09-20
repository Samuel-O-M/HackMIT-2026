'use strict';

/**
 * Clinical Call — patient-facing client.
 *
 * One screen: a greeting, one big call button, and a conversation written out
 * as it happens. Developer mode (wrench in the top bar) opens a drawer with
 * the grounding, brain & planner state, and the offline session log.
 *
 * The backend contract is unchanged: /api/patients, /api/brain/*, /api/tts,
 * /ws/listen.
 */

(function () {
  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------- state
  let sessionId = null;
  let subjectId = null;
  let call = null; // { ws, ctx, stream, source, processor, analyser }
  let muted = false;
  let agentSpeaking = false;
  let currentAudio = null;
  let queue = [];
  let turnBusy = false;
  let pendingFinals = [];
  let interim = '';
  let flushInterval = null;
  let pollTimer = null;
  let lastVoiceAt = 0;
  let conversation = [];
  let levelTimer = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------------------- errors
  function showError(msg) {
    const el = $('#error');
    el.textContent = msg;
    el.hidden = false;
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
      const msg = data?.error?.message || data?.error?.err_msg || data?.error || `HTTP ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
  }

  // ------------------------------------------------------------- theme
  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('voice.theme', theme); } catch {}
  }
  $('#themeToggle').addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });

  // ------------------------------------------------------------- dev mode
  const devPanel = $('#devPanel');
  const devToggle = $('#devToggle');

  function setDevMode(on) {
    devToggle.setAttribute('aria-pressed', String(on));
    devPanel.hidden = !on;
    try { localStorage.setItem('voice.devmode', on ? '1' : '0'); } catch {}
    if (on) {
      loadHealth();
      refresh();
    }
  }
  devToggle.addEventListener('click', () => setDevMode(devPanel.hidden));
  $('#devClose').addEventListener('click', () => setDevMode(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !devPanel.hidden) setDevMode(false);
  });
  try {
    if (localStorage.getItem('voice.devmode') === '1') setDevMode(true);
  } catch {}

  // Dev tabs
  for (const tab of document.querySelectorAll('.dev-tab')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('.dev-tab')) {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      }
      for (const page of document.querySelectorAll('.dev-page')) {
        page.hidden = page.dataset.page !== tab.dataset.tab;
      }
    });
  }

  // ------------------------------------------------------------- status
  const STATUS_TEXT = {
    idle: 'Not on a call',
    connecting: 'Connecting…',
    listening: 'Listening — go ahead',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
    muted: 'Muted — the agent cannot hear you',
  };
  function setState(state) {
    $('#callView').dataset.state = state;
    $('#statusText').textContent = STATUS_TEXT[state] || state;
    if (sessionId) {
      fetch('/api/brain/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, state }),
      }).catch(() => {});
    }
  }

  // ------------------------------------------------------------- conversation
  let convSig = null;
  function renderConversation() {
    const sig = JSON.stringify(conversation) + '||' + interim;
    if (sig === convSig) return;
    convSig = sig;

    const box = $('#conversation');
    box.textContent = '';

    if (!conversation.length && !interim) {
      const p = document.createElement('div');
      p.className = 'msg system';
      p.textContent = 'The call has started. Say hello whenever you are ready.';
      box.appendChild(p);
      return;
    }

    for (const turn of conversation) {
      const div = document.createElement('div');
      div.className = 'msg ' + (turn.speaker === 'patient' ? 'patient' : 'agent');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = turn.speaker === 'patient' ? 'You' : 'Study team';
      div.appendChild(who);
      div.appendChild(document.createTextNode(turn.transcript));
      box.appendChild(div);
    }
    if (interim) {
      const div = document.createElement('div');
      div.className = 'msg patient interim';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = 'You';
      div.appendChild(who);
      div.appendChild(document.createTextNode(interim));
      box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
  }

  // ------------------------------------------------------------- session log (dev)
  let logCount = 0;
  function log(event, data) {
    logCount++;
    $('#logCount').textContent = `${logCount} event${logCount === 1 ? '' : 's'}`;
    if (devPanel.hidden) return;
    const item = document.createElement('div');
    item.className = 'log-item';
    const time = new Date().toLocaleTimeString();
    const b = document.createElement('b');
    b.textContent = event;
    item.appendChild(document.createTextNode(`${time}  `));
    item.appendChild(b);
    if (data && Object.keys(data).length) {
      item.appendChild(document.createTextNode('\n' + JSON.stringify(data, null, 1).slice(0, 600)));
    }
    const list = $('#logList');
    list.prepend(item);
  }

  async function downloadLog() {
    if (!sessionId) return showError('No session yet — start a call first.');
    try {
      const res = await fetch(`/api/brain/log?sessionId=${encodeURIComponent(sessionId)}`);
      const text = await res.text();
      const blob = new Blob([text], { type: 'application/jsonl' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${sessionId}.jsonl`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      showError('Log: ' + err.message);
    }
  }
  $('#downloadLog').addEventListener('click', downloadLog);
  $('#clearLog').addEventListener('click', () => { $('#logList').textContent = ''; });

  // ------------------------------------------------------------- dev panels
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pre(obj) {
    return el('pre', 'raw', typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  }
  function det(summary, nodes, open = false) {
    const d = el('details', 'acc');
    if (open) d.open = true;
    d.appendChild(el('summary', null, summary));
    for (const n of nodes) if (n) d.appendChild(n);
    return d;
  }
  function ul(items, render) {
    const u = el('ul', 'tight');
    for (const it of items) u.appendChild(el('li', null, render ? render(it) : String(it)));
    return u;
  }

  function renderGrounding(patient, toolCalls) {
    const box = $('#grounding');
    box.textContent = '';
    if (patient) {
      const meds = patient.medications || [];
      box.appendChild(det(`current medications (${meds.length})`, meds.length
        ? [ul(meds, (m) => `${m.canonical_name || m.reported_text}${m.dose ? ` · ${m.dose}` : ''}${m.frequency ? ` · ${m.frequency}` : ''}`)]
        : [el('p', 'muted small', '—')], true));
      box.appendChild(det('profile & study', [pre({ profile: patient.profile, enrollment: patient.enrollment })]));
      const rules = patient.protocol_rules || [];
      if (rules.length) box.appendChild(det(`protocol rules (${rules.length})`, [pre(rules)]));
    }
    const tools = toolCalls || [];
    box.appendChild(tools.length
      ? det(`lookups this turn (${tools.length})`, [pre(tools.map((c) => ({ tool: c.name, args: c.args, result: c.result })))])
      : el('p', 'muted small', 'No lookups on the last turn.'));
  }

  function renderBrain(data) {
    const box = $('#brain');
    box.textContent = '';
    const st = data.state || {};
    const planner = data.planner || {};

    const pills = el('div', 'pillrow');
    for (const [txt, cls] of [
      [planner.running ? 'planning…' : 'planner idle', planner.running ? 'pill warn' : 'pill ok'],
      [planner.lastPlanModel || 'model —', 'pill'],
      [data.channel ? `channel: ${data.channel.state}` : 'channel —', 'pill'],
    ]) pills.appendChild(el('span', cls, txt));
    box.appendChild(pills);

    if (planner.errors?.length) box.appendChild(det('planner errors', [pre(planner.errors)], true));

    const kv = (k, v) => {
      const d = el('div', 'kv');
      d.appendChild(el('span', null, k));
      d.appendChild(el('div', null, v == null || v === '' ? '—' : String(v)));
      return d;
    };
    box.appendChild(kv('goal', st.goal));
    box.appendChild(kv('summary', st.summary));
    const known = st.known || [];
    box.appendChild(det(`known (${known.length})`, [known.length ? ul(known, (k) => `${k.fact}${k.source ? `  [${k.source}]` : ''}`) : el('p', 'muted small', '—')]));
    const missing = st.missing || [];
    box.appendChild(det(`missing (${missing.length})`, [missing.length ? ul(missing) : el('p', 'muted small', '—')], missing.length > 0));
    const nq = st.next_questions || [];
    box.appendChild(det(`next questions (${nq.length})`, [nq.length ? ul(nq) : el('p', 'muted small', '—')], nq.length > 0));
    const flags = st.flags || [];
    box.appendChild(det(`flags (${flags.length})`, [flags.length ? ul(flags, (f) => `${f.type}: ${f.detail}${f.protocol_section ? ` (§${f.protocol_section})` : ''}`) : el('p', 'muted small', '—')], flags.length > 0));
    box.appendChild(det('planner state JSON', [pre(st)]));
    const lp = data.lastPlan;
    if (lp) {
      box.appendChild(det(`last planner run — ${lp.model || ''}`, [pre({ retrieval: lp.toolCalls || [], applied: lp.applied || [] })]));
    }
  }

  let brainSig = null;
  async function refresh() {
    if (!sessionId || devPanel.hidden) return;
    try {
      const data = await fetchJson(`/api/brain/debug?sessionId=${encodeURIComponent(sessionId)}`);
      if (Array.isArray(data.conversation)) {
        conversation = data.conversation;
        renderConversation();
      }
      const sig = JSON.stringify({
        p: data.patient ?? null, t: data.lastTurn?.talker?.toolCalls ?? null,
        s: data.state ?? null, pl: data.planner ?? null, lp: data.lastPlan ?? null, ch: data.channel ?? null,
      });
      if (sig !== brainSig) {
        brainSig = sig;
        renderGrounding(data.patient, data.lastTurn?.talker?.toolCalls);
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

  // ------------------------------------------------------------- TTS
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
      currentAudio = null;
    }
    return new Promise((resolve) => {
      const audio = new Audio(URL.createObjectURL(blob));
      currentAudio = audio;
      agentSpeaking = true;
      setState('speaking');
      const done = () => {
        agentSpeaking = false;
        currentAudio = null;
        if (call) setState(muted ? 'muted' : 'listening');
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
      log('tts.played', { chars: text.length });
    });
  }

  // ------------------------------------------------------------- turns
  async function doTurn(text) {
    while (agentSpeaking) await sleep(100);
    setState('thinking');
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
      setState(call ? (muted ? 'muted' : 'listening') : 'idle');
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

  // Reply only after a sustained silence that WE measure — not on Deepgram's
  // speech_final, which fires at short pauses.
  const SILENCE_MS = 1500;
  const noteVoice = () => { lastVoiceAt = Date.now(); };

  function maybeFlush() {
    if (!call || agentSpeaking || muted || !pendingFinals.length) return;
    if (Date.now() - lastVoiceAt >= SILENCE_MS) flushFinals();
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
        if (call && !agentSpeaking && !muted) setState('listening');
      }
      renderConversation();
    } else if (msg.type === 'SpeechStarted') {
      noteVoice();
      log('stt.speech_started', {});
    }
  }

  // ------------------------------------------------------------- views
  function showView(name) {
    $('#welcomeView').classList.toggle('hidden', name !== 'welcome');
    $('#callView').classList.toggle('hidden', name !== 'call');
  }

  // ------------------------------------------------------------- call
  async function startCall() {
    if (call) return;
    clearError();
    try {
      subjectId = $('#patient').value;
      if (!subjectId) return showError('Pick who is on the call first.');

      const s = await fetchJson('/api/brain/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId }),
      });
      sessionId = s.sessionId;
      $('#sessionPill').textContent = `session ${sessionId.slice(0, 8)}… · ${subjectId}`;
      $('#sessionPill').className = 'pill ok';
      log('session.start', { sessionId, subjectId });

      conversation = [];
      interim = '';
      pendingFinals = [];
      queue = [];
      convSig = brainSig = null;
      logCount = 0;
      $('#logList').textContent = '';
      $('#logCount').textContent = '0 events';
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
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        handleStt(m);
      };
      ws.onerror = () => showError('Live STT socket error');
      ws.onclose = () => { if (call) endCall(); };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = ctx.createMediaStreamSource(stream);

      // Level meter for the orb.
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

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

      call = { ws, ctx, stream, source, processor, analyser };
      flushInterval = setInterval(maybeFlush, 200);

      // Drive the orb's mic level ~10×/s.
      const levelData = new Uint8Array(analyser.frequencyBinCount);
      const core = $('#orbCore');
      levelTimer = setInterval(() => {
        if (!call || muted) { core.style.setProperty('--level', 0); return; }
        analyser.getByteTimeDomainData(levelData);
        let peak = 0;
        for (const v of levelData) peak = Math.max(peak, Math.abs(v - 128));
        core.style.setProperty('--level', Math.min(1, peak / 60).toFixed(2));
      }, 100);

      showView('call');
      $('#backToStart').classList.add('hidden');
      $('#mute').disabled = false;
      $('#end').disabled = false;
      setState('listening');
      log('mic.start', { sampleRate: ctx.sampleRate });

      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(refresh, 1600);
      await refresh();
    } catch (err) {
      showError(err.message?.includes('Permission') || /denied|notallowed/i.test(String(err))
        ? 'The microphone was not allowed. Check the browser permission and try again.'
        : 'Could not start the call: ' + err.message);
      endCall();
    }
  }

  function toggleMute() {
    if (!call) return;
    muted = !muted;
    for (const t of call.stream.getAudioTracks()) t.enabled = !muted;
    $('#muteLabel').textContent = muted ? 'Unmute' : 'Mute';
    $('#mute').classList.toggle('on', muted);
    log(muted ? 'mute.on' : 'mute.off', {});
    if (muted) {
      interim = '';
      pendingFinals = [];
      renderConversation();
      setState('muted');
    } else {
      setState('listening');
    }
  }

  async function endCall() {
    if (!call) { setState('idle'); return; }
    const { ws, ctx, stream, source, processor } = call;
    call = null;
    muted = false;
    if (flushInterval) { clearInterval(flushInterval); flushInterval = null; }
    if (levelTimer) { clearInterval(levelTimer); levelTimer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    try { processor.disconnect(); } catch {}
    try { source.disconnect(); } catch {}
    try { stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { if (ws.readyState === WebSocket.OPEN) ws.close(); } catch {}
    try { ctx.close(); } catch {}
    flushFinals();
    $('#mute').disabled = true;
    $('#end').disabled = true;
    $('#muteLabel').textContent = 'Mute';
    $('#mute').classList.remove('on');
    $('#backToStart').classList.remove('hidden');
    setState('idle');
    log('mic.stop', {});

    const sys = document.createElement('div');
    sys.className = 'msg system';
    sys.textContent = 'The call has ended. Start a new call any time from the first screen.';
    $('#conversation').appendChild(sys);
    $('#conversation').scrollTop = $('#conversation').scrollHeight;

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

  // ------------------------------------------------------------- wiring
  $('#start').addEventListener('click', startCall);
  $('#mute').addEventListener('click', toggleMute);
  $('#end').addEventListener('click', endCall);
  $('#backToStart').addEventListener('click', () => {
    if (call) return;
    showView('welcome');
  });

  $('#typeToggle').addEventListener('click', () => {
    const row = $('#typeRow');
    const open = row.classList.toggle('hidden');
    $('#typeToggle').setAttribute('aria-expanded', String(!open));
    if (!open) $('#typeInput').focus();
  });

  function sendTyped() {
    const v = $('#typeInput').value.trim();
    if (v && sessionId) {
      enqueueTurn(v);
      log('turn.sent.typed', { text: v });
    }
    $('#typeInput').value = '';
  }
  $('#typeSend').addEventListener('click', sendTyped);
  $('#typeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendTyped();
  });

  $('#patient').addEventListener('change', () => {
    if (call) endCall();
    sessionId = null;
    $('#sessionPill').textContent = 'no session';
    $('#sessionPill').className = 'pill';
  });

  async function loadPatients() {
    try {
      const { patients } = await fetchJson('/api/patients');
      const sel = $('#patient');
      sel.textContent = '';
      for (const p of patients) {
        const opt = document.createElement('option');
        opt.value = p.subject_id;
        opt.textContent = `${p.given_name} ${p.family_name}`;
        sel.appendChild(opt);
      }
    } catch (err) {
      showError('Could not load participants: ' + err.message);
    }
  }

  async function loadHealth() {
    try {
      const h = await fetchJson('/api/health');
      for (const key of ['deepgram', 'openai']) {
        const pill = $(`#healthPills [data-key="${key}"]`);
        if (!pill) continue;
        pill.textContent = `${key === 'deepgram' ? 'Deepgram' : 'OpenAI'}: ${h[key] ? 'set' : 'missing'}`;
        pill.className = `pill ${h[key] ? 'ok' : 'bad'}`;
      }
    } catch {
      showError('Cannot reach the server. Is `node server.js` running?');
    }
  }

  loadPatients();
  setState('idle');
})();
