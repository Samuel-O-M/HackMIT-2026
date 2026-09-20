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
  let currentState = 'idle';
  let callStartedAt = 0;
  let durationTimer = null;

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

  // ------------------------------------------------------------- phone mode
  // Layout only: toggling this never touches the call logic. The pre-paint
  // script in index.html has already set data-mode when it could.
  const PHONE_MODE_KEY = 'voice.phoneMode';
  const phoneToggle = $('#phoneToggle');

  function autoPhoneMode() {
    return (
      matchMedia('(max-width: 700px)').matches ||
      (matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 900px)').matches)
    );
  }

  function setPhoneMode(on, persist) {
    document.documentElement.dataset.mode = on ? 'phone' : 'desktop';
    if (phoneToggle) {
      phoneToggle.setAttribute('aria-pressed', String(on));
      phoneToggle.title = on ? 'Switch to desktop layout' : 'Switch to phone layout';
    }
    if (persist) {
      try { localStorage.setItem(PHONE_MODE_KEY, on ? '1' : '0'); } catch {}
    }
  }

  {
    const preset = document.documentElement.dataset.mode;
    setPhoneMode(preset ? preset === 'phone' : autoPhoneMode(), false);
  }
  if (phoneToggle) {
    phoneToggle.addEventListener('click', () => {
      setPhoneMode(document.documentElement.dataset.mode !== 'phone', true);
    });
  }

  // ------------------------------------------------------------- dev mode
  const devPanel = $('#devPanel');
  const devToggle = $('#devToggle');

  function setDevMode(on) {
    devToggle.setAttribute('aria-pressed', String(on));
    devPanel.hidden = !on;
    $('#devScrim').hidden = !on;
    try { localStorage.setItem('voice.devmode', on ? '1' : '0'); } catch {}
    if (on) {
      loadHealth();
      refresh();
    }
  }
  devToggle.addEventListener('click', () => setDevMode(devPanel.hidden));
  $('#devClose').addEventListener('click', () => setDevMode(false));
  $('#devScrim').addEventListener('click', () => setDevMode(false));
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
    currentState = state;
    $('#callView').dataset.state = state;
    $('#statusText').textContent = STATUS_TEXT[state] || state;
    updatePhoneHeader();
    updateTyping();
    if (sessionId) {
      fetch('/api/brain/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, state }),
      }).catch(() => {});
    }
  }

  // Shorter, phone-appropriate wording for the iOS-style header.
  const PHONE_STATUS_TEXT = {
    idle: 'Call ended',
    connecting: 'Connecting…',
    listening: 'On call',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
    muted: 'Muted',
  };
  function updatePhoneHeader() {
    const el = $('#phoneStatus');
    if (el) el.textContent = PHONE_STATUS_TEXT[currentState] || currentState;
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${m}:${s}`;
  }
  function startDurationTimer() {
    callStartedAt = Date.now();
    const el = $('#phoneTimer');
    if (el) el.textContent = '00:00';
    if (durationTimer) clearInterval(durationTimer);
    durationTimer = setInterval(() => {
      const t = $('#phoneTimer');
      if (t) t.textContent = formatDuration(Date.now() - callStartedAt);
    }, 1000);
  }
  function stopDurationTimer() {
    if (durationTimer) clearInterval(durationTimer);
    durationTimer = null;
    callStartedAt = 0;
    const t = $('#phoneTimer');
    if (t) t.textContent = '00:00';
  }

  // ------------------------------------------------------------- conversation
  let convSig = null;

  /** Three bouncing dots while the agent is composing a reply. */
  function updateTyping() {
    const box = $('#conversation');
    const existing = box.querySelector('.typing');
    if (currentState === 'thinking' && !existing) {
      const t = document.createElement('div');
      t.className = 'typing';
      t.setAttribute('aria-label', 'The study team is thinking');
      for (let i = 0; i < 3; i++) t.appendChild(document.createElement('i'));
      box.appendChild(t);
      box.scrollTop = box.scrollHeight;
    } else if (currentState !== 'thinking' && existing) {
      existing.remove();
    }
  }

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
    } else {
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
    }
    updateTyping();
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
    if (!sessionId) return;
    try {
      const data = await fetchJson(`/api/brain/debug?sessionId=${encodeURIComponent(sessionId)}`);
      if (Array.isArray(data.conversation)) {
        conversation = data.conversation;
        renderConversation();
      }
      // The grounding/brain/log panes are developer-only. The conversation
      // above must refresh in patient mode too, otherwise the agent's reply is
      // never shown (and the transcript looks silent).
      if (devPanel.hidden) return;
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
  const VOICE_MODEL = 'aura-2-helena-en';

  // The "one moment" fillers are three fixed phrases, so they are synthesised
  // once when the call starts and replayed instantly. Keep in sync with FILLERS
  // in brain/lib/speech.js.
  const FILLERS = ['One moment.', 'Let me check that.', 'Just a second.'];
  const fillerUrls = new Map(); // phrase -> Promise<object URL>

  async function fetchSpeechUrl(text) {
    const res = await fetch(`/api/tts?model=${VOICE_MODEL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`TTS failed (${res.status})`);
    return URL.createObjectURL(await res.blob());
  }

  function prefetchFillers() {
    for (const phrase of FILLERS) {
      if (!fillerUrls.has(phrase)) {
        fillerUrls.set(phrase, fetchSpeechUrl(phrase).catch((err) => {
          fillerUrls.delete(phrase); // try again next time it is needed
          throw err;
        }));
      }
    }
  }

  /** Start synthesising one chunk now. Resolves to a ready Audio, or null if TTS failed. */
  async function synthesize(text) {
    try {
      const cached = FILLERS.includes(text);
      if (cached) prefetchFillers();
      const url = await (cached ? fillerUrls.get(text) : fetchSpeechUrl(text));
      const audio = new Audio(url);
      audio.preload = 'auto';
      if (cached) audio.dataset.cached = '1';
      return audio;
    } catch (err) {
      log('tts.error', { error: String(err.message || err) });
      return null;
    }
  }

  function playAudio(audio) {
    return new Promise((resolve) => {
      currentAudio = audio;
      const done = () => {
        if (!audio.dataset.cached) URL.revokeObjectURL(audio.src); // cached fillers are reused
        if (currentAudio === audio) currentAudio = null;
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    });
  }

  /**
   * The agent's speech for one turn. Every chunk is synthesised the moment it
   * is added — in parallel, not one after another — and played back to back in
   * order. The mic stays muted from the first sound to finish(), including the
   * gaps between chunks, so the agent never hears itself.
   */
  function createSpeech(onFirstAudio) {
    let chain = Promise.resolve();
    let started = false;
    return {
      add(text) {
        const audio = synthesize(text);
        chain = chain.then(async () => {
          const ready = await audio;
          if (!ready) return;
          if (!started) {
            started = true;
            agentSpeaking = true;
            setState('speaking');
            onFirstAudio?.();
          }
          await playAudio(ready);
        });
      },
      async finish() {
        await chain;
        agentSpeaking = false;
      },
    };
  }

  // ------------------------------------------------------------- turns
  /** Read a newline-delimited JSON stream, calling onEvent for each object. */
  async function readNdjson(res, onEvent) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const handle = (line) => {
      if (line.trim()) onEvent(JSON.parse(line));
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop();
      lines.forEach(handle);
    }
    if (pending) handle(pending);
  }

  async function doTurn(text) {
    while (agentSpeaking) await sleep(100);
    setState('thinking');
    const sentAt = Date.now();
    // When they actually stopped talking (typed messages have no such moment).
    const speechEndAt = sentAt - lastVoiceAt < 10000 ? lastVoiceAt : sentAt;
    log('turn.sent', { text });

    const speech = createSpeech(() => {
      log('turn.timing', {
        speechEndToFirstAudioMs: Date.now() - speechEndAt,
        sendToFirstAudioMs: Date.now() - sentAt,
      });
    });

    try {
      const res = await fetch('/api/brain/turn/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, subjectId, text }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await readNdjson(res, (e) => {
        if (e.type === 'say') {
          speech.add(e.text); // speak it now; the rest is still being written
          log('turn.say', { text: e.text, filler: Boolean(e.filler) });
        } else if (e.type === 'done') {
          log('turn.replied', { say: e.say, tools: e.toolCalls, firstChunkMs: e.firstChunkMs, latencyMs: e.latencyMs });
          refresh(); // the full reply is saved now; show it while it is still being spoken
        } else if (e.type === 'error') {
          throw new Error(e.error);
        }
      });
    } catch (err) {
      showError('Brain: ' + err.message);
    } finally {
      await speech.finish();
      setState(call ? (muted ? 'muted' : 'listening') : 'idle');
    }
    refreshUntilIdle(4, 1300);
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
  // speech_final, which fires at short pauses. Short after a finished sentence,
  // longer when the words just trail off (the speaker is probably still
  // thinking: "I take... um...").
  const SILENCE_MS = 700;
  const SILENCE_TRAILING_MS = 1200;
  const FINISHED = /[.?!]["')\]]?\s*$/;
  const noteVoice = () => { lastVoiceAt = Date.now(); };

  function maybeFlush() {
    if (!call || agentSpeaking || muted || !pendingFinals.length) return;
    const last = pendingFinals[pendingFinals.length - 1];
    const needed = FINISHED.test(last) ? SILENCE_MS : SILENCE_TRAILING_MS;
    if (Date.now() - lastVoiceAt >= needed) flushFinals();
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
        // Not noteVoice(): a final only arrives after the endpointing pause, so
        // the speaker has already been quiet that long. Restarting the clock
        // here made the wait endpointing + silence instead of just silence.
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
  /** Cross-fade between the greeting and the call, with a short exit. */
  function showView(name) {
    const welcome = $('#welcomeView');
    const callView = $('#callView');

    if (name === 'call') {
      if (callView.classList.contains('hidden') === false) return;
      welcome.classList.add('leaving');
      window.setTimeout(() => {
        welcome.classList.add('hidden');
        welcome.classList.remove('leaving');
      }, 320);
      callView.classList.remove('hidden');
      callView.classList.add('entering');
      window.setTimeout(() => callView.classList.remove('entering'), 700);
      return;
    }

    if (!callView.classList.contains('hidden')) {
      callView.classList.add('leaving');
      window.setTimeout(() => {
        callView.classList.add('hidden');
        callView.classList.remove('leaving');
      }, 280);
    }
    welcome.classList.remove('hidden');
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
      prefetchFillers();

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
      // endpointing only decides when a final transcript is emitted; when we
      // reply is decided by SILENCE_MS above. Deepgram's minimum
      // utterance_end_ms is 1000.
      params.set('endpointing', '400');
      params.set('utterance_end_ms', '1000');

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
      startDurationTimer();
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
    if (!call) { stopDurationTimer(); setState('idle'); return; }
    const { ws, ctx, stream, source, processor } = call;
    call = null;
    stopDurationTimer();
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
