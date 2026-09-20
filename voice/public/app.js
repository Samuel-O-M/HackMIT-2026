'use strict';

/**
 * ReconMed call screen — patient-facing client.
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
  let activeCallId = null;   // the telephony call this session belongs to
  let queue = [];
  let turnBusy = false;
  let pendingFinals = [];
  let interim = '';
  let flushInterval = null;
  let pollTimer = null;
  let lastVoiceAt = 0;
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
  // The screen owns the conversation. It used to mirror the server's copy by
  // polling, and that was the choppiness: a phrase vanished the instant the
  // speech engine finalised it and came back a second or two later when the poll
  // caught up; overlapping polls could put an older snapshot over a newer one;
  // and every change wiped and rebuilt all the bubbles, replaying each one's
  // entrance animation. Now each bubble is created once and updated in place.
  const bubbles = new Map(); // id -> { el, body }
  let bubbleSeq = 0;
  let typingEl = null;

  const thread = () => $('#conversation');

  /** Run a DOM change, then keep the newest message in view — unless they scrolled up to read. */
  function keepPinned(change) {
    const box = thread();
    const pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    change();
    if (pinned) box.scrollTop = box.scrollHeight;
  }

  /** Insert above the thinking dots, which always stay last. */
  const beforeTyping = () => (typingEl && typingEl.parentNode ? typingEl : null);

  function resetConversation() {
    thread().textContent = '';
    bubbles.clear();
    typingEl = null;
    bubbleSeq = 0;
    updateTyping();
  }

  function addBubble(id, speaker) {
    const el = document.createElement('div');
    el.className = 'msg ' + (speaker === 'patient' ? 'patient' : 'agent');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = speaker === 'patient' ? 'You' : 'Study team';
    const body = document.createElement('span');
    body.className = 'body';
    el.append(who, body);
    keepPinned(() => thread().insertBefore(el, beforeTyping()));
    const bubble = { el, body };
    bubbles.set(id, bubble);
    return bubble;
  }

  /** Create the bubble if it is new; otherwise change its text in place. */
  function setBubble(id, speaker, text, { draft = false } = {}) {
    const bubble = bubbles.get(id) || addBubble(id, speaker);
    keepPinned(() => {
      if (bubble.body.textContent !== text) bubble.body.textContent = text;
      bubble.el.classList.toggle('interim', draft);
    });
    return bubble;
  }

  function removeBubble(id) {
    const bubble = bubbles.get(id);
    if (!bubble) return;
    bubble.el.remove();
    bubbles.delete(id);
  }

  /** What they are saying right now: phrases already finalised plus the one in progress. */
  function renderDraft() {
    const text = [...pendingFinals, interim].filter(Boolean).join(' ').trim();
    if (text) setBubble('draft', 'patient', text, { draft: true });
    else removeBubble('draft');
  }

  /** Their words are final: the live draft becomes a real message, in place. Typed messages have no draft. */
  function commitPatient(text) {
    const id = `p${++bubbleSeq}`;
    const draft = bubbles.get('draft');
    if (draft) {
      bubbles.delete('draft');
      bubbles.set(id, draft);
    }
    setBubble(id, 'patient', text);
  }

  function addNote(text) {
    keepPinned(() => {
      const note = document.createElement('div');
      note.className = 'msg system';
      note.textContent = text;
      thread().insertBefore(note, beforeTyping());
    });
  }

  /** Three bouncing dots while the agent is composing a reply. */
  function updateTyping() {
    const on = currentState === 'thinking' || currentState === 'connecting';
    if (on && !(typingEl && typingEl.parentNode)) {
      typingEl = document.createElement('div');
      typingEl.className = 'typing';
      typingEl.setAttribute('aria-label', 'The study team is thinking');
      for (let i = 0; i < 3; i++) typingEl.appendChild(document.createElement('i'));
      keepPinned(() => thread().appendChild(typingEl));
    } else if (!on && typingEl && typingEl.parentNode) {
      typingEl.remove();
    }
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
    // Follow-ups: what the agent has asked about how medicines are going, out of
    // the per-call cap, and the question the planner would offer next.
    const fu = st.followups;
    if (fu) {
      box.appendChild(kv('follow-ups', `${fu.used} of ${data.maxFollowups ?? 3} optional asked · closing question ${fu.group_check}${fu.covered?.length ? ` · covered: ${fu.covered.join(', ')}` : ''}`));
    }
    box.appendChild(kv('next follow-up', st.followup ? `${st.followup.kind}${st.followup.medication ? ` · ${st.followup.medication}` : ''}: ${st.followup.question}` : null));
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
    // Developer panes only. The conversation on screen is not read back from the
    // server: that round trip was the lag (see "conversation" above).
    if (!sessionId || devPanel.hidden) return;
    try {
      const data = await fetchJson(`/api/brain/debug?sessionId=${encodeURIComponent(sessionId)}`);
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
  // Aura-2 (natural). Speech is synthesised sentence by sentence the moment each
  // one is written, and each sentence is streamed onto the call's AudioContext as
  // raw PCM arrives (see synthesize / playStream) — so the next sentence is already
  // being generated while the current one is still playing, and the reply sounds
  // continuous even though a single Aura-2 sentence takes a moment to generate.
  const VOICE_MODEL = 'aura-2-helena-en'; // keep in sync with scripts/build-fillers.js

  // A little human texture, and no more: the agent sometimes says "Mm-hm" or
  // "Okay" the instant the participant stops (a pre-recorded clip, so no delay).
  // Clips come from scripts/build-fillers.js.
  const OPENER_CHANCE = 0;          // blind backchannels are off: "mm-hm" then a gap of silence sounds worse than the gap
  const OPENER_CHANCE_AFTER = 0;
  // No artificial pause between sentences: the queue plays each sentence back to
  // back as soon as its audio is ready, so the reply sounds continuous.
  const BREATH_MS = [0, 0];
  const SENTENCE_END = /[.!?…]["')\]]?\s*$/;
  const RECENT_FILLERS = 4;         // never repeat a clip heard in the last few
  const WAIT_SOUNDS = ['Okay.', 'Uh-huh.']; // covers a lookup: "okay..." is a person about to go and check

  const bank = { ack: [] }; // { id, text, url }
  const recentFillers = [];
  let bankLoading = null;

  /** Fetch every clip into memory once, so playing one is instant. */
  function loadFillerBank() {
    if (bankLoading) return bankLoading;
    bankLoading = (async () => {
      try {
        const res = await fetch('/fillers/manifest.json');
        if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
        const { fillers } = await res.json();
        await Promise.all(fillers.map(async (f) => {
          const clip = await fetch(`/fillers/${f.file}`);
          if (!clip.ok) return;
          (bank[f.kind] ??= []).push({ id: f.id, text: f.text, kind: f.kind, url: URL.createObjectURL(await clip.blob()) });
        }));
        log('fillers.loaded', { ack: bank.ack.length });
      } catch (err) {
        log('fillers.error', { error: String(err.message || err) });
        bankLoading = null; // try again next call
      }
    })();
    return bankLoading;
  }

  /**
   * A random clip of this kind that we have not just used, as a fresh Audio.
   * `only` limits it to those phrases; `avoid` skips a phrase (so a wait never
   * repeats the opener's sound). Null if none.
   */
  function pickFiller(kind, { only, avoid } = {}) {
    let all = bank[kind] || [];
    if (only) all = all.filter((f) => only.includes(f.text));
    if (avoid) all = all.filter((f) => f.text !== avoid);
    const fresh = all.filter((f) => !recentFillers.includes(f.id));
    const pool = fresh.length ? fresh : all;
    if (!pool.length) return null;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    recentFillers.push(pick.id);
    if (recentFillers.length > RECENT_FILLERS) recentFillers.shift();
    const audio = new Audio(pick.url);
    audio.preload = 'auto';
    audio.dataset.cached = '1'; // shared blob URL: never revoke
    audio.dataset.fillerId = pick.id;
    audio.dataset.fillerKind = pick.kind;
    return audio;
  }

  // Reply audio is streamed as raw PCM and scheduled on the call's AudioContext
  // as it arrives, so playback starts on the first bytes instead of after the
  // whole clip has downloaded (~1 s for a sentence).
  const TTS_RATE = 24000;
  const TTS_PREBUFFER_S = 0.1;

  /** Start synthesising one chunk of the real reply. Resolves once audio starts arriving, or null if TTS failed. */
  async function synthesize(text) {
    const ctx = call?.ctx;
    if (!ctx) return null;
    try {
      const res = await fetch(`/api/tts?model=${VOICE_MODEL}&encoding=linear16&container=none&sample_rate=${TTS_RATE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok || !res.body) throw new Error(`TTS failed (${res.status})`);
      return { ctx, reader: res.body.getReader(), dataset: {}, stop() {} };
    } catch (err) {
      log('tts.error', { error: String(err.message || err) });
      return null;
    }
  }

  async function playStream(clip) {
    const { ctx, reader } = clip;
    const sources = [];
    let stopped = false;
    let nextTime = 0;
    let carry = new Uint8Array(0);
    clip.stop = () => {
      stopped = true;
      for (const src of sources) { try { src.stop(); } catch {} }
      reader.cancel().catch(() => {});
    };
    currentAudio = clip;
    try { await ctx.resume(); } catch {}

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        // A network chunk can end mid-sample; keep the odd byte for the next one.
        const bytes = new Uint8Array(carry.length + value.length);
        bytes.set(carry);
        bytes.set(value, carry.length);
        const usable = bytes.length - (bytes.length % 2);
        carry = bytes.slice(usable);
        if (!usable) continue;

        const view = new DataView(bytes.buffer, 0, usable);
        const buffer = ctx.createBuffer(1, usable / 2, TTS_RATE);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        // First chunk: a hair of headroom. Later chunks: butt up against the last,
        // or start now if the network fell behind.
        if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + (sources.length ? 0.02 : TTS_PREBUFFER_S);
        src.start(nextTime);
        nextTime += buffer.duration;
        sources.push(src);
      }
    } catch (err) {
      log('tts.stream_error', { error: String(err.message || err) });
    }
    // Resolve when the last scheduled sample has actually been played.
    const last = sources[sources.length - 1];
    if (last && !stopped) await new Promise((resolve) => { last.onended = resolve; });
    if (currentAudio === clip) currentAudio = null;
  }

  function playAudio(audio) {
    if (audio.reader) return playStream(audio);
    return new Promise((resolve) => {
      currentAudio = audio;
      const done = () => {
        if (!audio.dataset.cached) URL.revokeObjectURL(audio.src);
        if (currentAudio === audio) currentAudio = null;
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    });
  }

  /**
   * The agent's speech for one turn: an ordered queue of reply chunks (and,
   * at the front, an optional backchannel clip).
   *
   *  - Reply chunks are synthesised the moment they are added, in parallel, and
   *    played back to back with a small breath between sentences.
   *  - The mic stays muted from the first sound to finish(), gaps included.
   */
  function createSpeech(onSound) {
    const items = [];
    let closed = false;
    let wake = () => {};
    let started = false;
    let lastEndAt = 0;
    let lastText = '';

    const waitForItem = () => new Promise((resolve) => { wake = resolve; });
    const push = (item) => {
      items.push(item);
      wake();
    };

    async function play(audio, kind, text) {
      if (!started) {
        started = true;
        agentSpeaking = true;
        setState('speaking');
      }
      onSound?.(kind, audio.dataset.fillerId, text);
      await playAudio(audio);
      lastEndAt = Date.now();
    }

    const loop = (async () => {
      for (;;) {
        const item = items.shift();
        if (!item) {
          if (closed) return;
          await waitForItem();
          continue;
        }
        const audio = await item.audio;
        if (!audio) continue;
        // A pause belongs between sentences. A chunk split mid-sentence to get
        // speech started must run straight on, or the gap lands inside a phrase.
        if (item.kind === 'say' && lastEndAt && SENTENCE_END.test(lastText)) {
          const breath = BREATH_MS[0] + Math.random() * (BREATH_MS[1] - BREATH_MS[0]);
          const remaining = lastEndAt + breath - Date.now();
          if (remaining > 0) await sleep(remaining);
        }
        if (item.kind === 'say') lastText = item.text || '';
        await play(audio, item.kind, item.text);
      }
    })();

    return {
      /** A chunk of the real reply: synthesise now, play in order. */
      say(text) {
        push({ kind: 'say', text, audio: synthesize(text) });
      },
      /** A pre-recorded backchannel clip, played in order with no synthesis wait. Returns its text, or null. */
      filler(kind, opts) {
        const audio = pickFiller(kind, opts);
        if (!audio) return null;
        push({ kind: 'filler', audio: Promise.resolve(audio) });
        return bank[kind].find((f) => f.id === audio.dataset.fillerId)?.text ?? null;
      },
      async finish() {
        closed = true;
        wake();
        await loop;
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

  let turnsDone = 0;
  let lastHadOpener = false;

  // True from the moment the call connects until the agent has finished its
  // opening line, so a quick "hello?" from the participant is not queued as an
  // answer to a greeting that has not happened yet.
  let greeting = false;

  /** `opening`: the agent speaks first — there is no participant utterance. */
  async function doTurn(text, { opening = false, stt = false } = {}) {
    while (agentSpeaking) await sleep(100);
    setState(opening ? 'connecting' : 'thinking');
    if (opening) greeting = true;
    const sentAt = Date.now();
    // When they actually stopped talking (typed messages have no such moment).
    const speechEndAt = sentAt - lastVoiceAt < 10000 ? lastVoiceAt : sentAt;
    log(opening ? 'turn.opening' : 'turn.sent', opening ? {} : { text });

    let fullSay = '';
    let endRequested = false;
    let firstSound = false;
    let firstWords = false;
    // The reply appears sentence by sentence as each one starts to be spoken, so
    // the words follow the voice instead of arriving whole, early or late.
    const agentId = `a${++bubbleSeq}`;
    let shown = '';
    const speech = createSpeech((kind, id, text) => {
      if (kind === 'say' && text) {
        shown = shown ? `${shown} ${text}` : text;
        setBubble(agentId, 'agent', shown);
      }
      const sinceEnd = Date.now() - speechEndAt;
      if (!firstSound) {
        firstSound = true;
        log('turn.timing', { firstSound: kind, clip: id || null, speechEndToFirstSoundMs: sinceEnd });
      }
      if (kind === 'say' && !firstWords) {
        firstWords = true;
        log('turn.timing', { firstWords: true, speechEndToFirstWordsMs: sinceEnd, sendToFirstWordsMs: Date.now() - sentAt });
      }
    });


    try {
      const res = await fetch('/api/brain/turn/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, subjectId, text, opening, source: stt ? 'stt' : 'text' }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await readNdjson(res, (e) => {
        if (e.type === 'say') {
          speech.say(e.text); // speak it now; the rest is still being written
          log('turn.say', { text: e.text });
        } else if (e.type === 'done') {
          log('turn.replied', { say: e.say, tools: e.toolCalls, firstChunkMs: e.firstChunkMs, latencyMs: e.latencyMs });
          fullSay = e.say;
          endRequested = Boolean(e.end);
        } else if (e.type === 'error') {
          throw new Error(e.error);
        }
      });
    } catch (err) {
      showError('Brain: ' + err.message);
    } finally {
      await speech.finish();
      // If a sentence's audio failed it was never shown; make sure the whole
      // reply is on screen once the turn is over.
      if (fullSay && fullSay !== shown) setBubble(agentId, 'agent', fullSay);
      if (opening) {
        greeting = false;
        pendingFinals = [];
        interim = '';
        renderDraft();
      }
      setState(call ? (muted ? 'muted' : 'listening') : 'idle');
    }
    // The agent asked to hang up (it called end_call): let the last words land,
    // then end the call.
    if (endRequested) {
      setTimeout(() => { if (call) endCall(); }, 1000);
    }
    refreshUntilIdle(4, 1300);
  }

  function enqueueTurn(text, { stt = false } = {}) {
    const t = (text || '').trim();
    if (!t) return;
    commitPatient(t);
    queue.push({ text: t, stt });
    pump();
  }

  async function pump() {
    if (turnBusy) return;
    turnBusy = true;
    try {
      while (queue.length) {
        const next = queue.shift();
        if (typeof next === 'string') await doTurn(next);
        else await doTurn(next.text || '', next); // { opening } or { text, stt }
      }
    } finally {
      turnBusy = false;
    }
  }

  // Reply only after a sustained silence that WE measure — not on Deepgram's
  // speech_final, which fires at short pauses. Short after a finished sentence,
  // longer when the words just trail off (the speaker is probably still
  // thinking: "I take... um...").
  // How long to wait after speech before replying. Generous on purpose: a short
  // pause is treated as a space inside a turn, not the end of one.
  const SILENCE_MS = 1000;
  const SILENCE_TRAILING_MS = 1600;
  const FINISHED = /[.?!]["')\]]?\s*$/;
  const noteVoice = () => { lastVoiceAt = Date.now(); };

  function maybeFlush() {
    // Flux releases turns itself (EndOfTurn -> releaseHeldTurn). Running the
    // silence timer as well enqueued the same turn twice, which duplicated what
    // the participant said. The timer is only for the nova-3 path.
    if (USE_FLUX) return;
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
    if (text) enqueueTurn(text, { stt: true });
  }

  // nova-3 is the default: real-time interims, punctuation, and silence-based
  // endpointing (tuned below to tolerate natural pauses). `?stt=flux` opts into
  // Flux, which instead reports whole turns (Update ... EndOfTurn).
  const USE_FLUX = new URLSearchParams(location.search).get('stt') === 'flux';
  const FLUX_EOT_THRESHOLD = 0.6; // when Flux calls the turn over; the grace below is the real safety net
  const SILENCE = new Int16Array(4096);

  // Flux decides a turn has ended from the words, so a complete-sounding phrase
  // mid-thought ("I think it is..." before the dose) ends it at ANY threshold —
  // raising the threshold does not fix it, it only makes some turns never fire.
  // So every ended turn is held briefly: if they carry on, the two halves are
  // merged into one turn instead of the agent replying over them. Costs this
  // much on every reply, and is the difference between a fluid call and one
  // that talks across people. Raise it if anyone is still being cut off.
  // Measured on a real call: 500 ms still split "My name is Samuel Mateo, and my
  // date of birth is January first..." into two turns — the agent answered the
  // name half while the date was still being said, and the mic gate then ate it.
  // 1200 ms merges the halves. It is spent only after someone stops talking, and
  // is the cheapest place to buy the guarantee that nobody is cut off.
  const EOT_GRACE_MS = 1200;
  let heldTurn = '';
  let holdTimer = null;

  function releaseHeldTurn() {
    holdTimer = null;
    const text = heldTurn.trim();
    heldTurn = '';
    pendingFinals = [];
    if (text) enqueueTurn(text, { stt: true });
  }

  function cancelHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  }

  function handleFlux(msg) {
    const text = (msg.transcript || '').trim();
    if (msg.event === 'EndOfTurn') {
      if (text) heldTurn = heldTurn ? `${heldTurn} ${text}` : text;
      interim = '';
      // Mirrored so the on-screen draft and endCall's flush both see it.
      pendingFinals = heldTurn ? [heldTurn] : [];
      cancelHold();
      holdTimer = window.setTimeout(releaseHeldTurn, EOT_GRACE_MS);
      log('stt.end_of_turn', { text, confidence: msg.end_of_turn_confidence, held: heldTurn });
      renderDraft();
    } else if (msg.event === 'Update' || msg.event === 'StartOfTurn' || msg.event === 'TurnResumed') {
      if (!text) return;
      // They carried on: what we were holding was a pause, not the end of a turn.
      if (holdTimer) {
        cancelHold();
        log('stt.resumed', { held: heldTurn });
      }
      interim = text;
      noteVoice();
      if (call && !agentSpeaking && !muted) setState('listening');
      renderDraft();
    }
  }

  function handleStt(msg) {
    if (greeting) return; // the agent is about to speak first; nothing said yet counts
    if (msg.type === 'TurnInfo') return handleFlux(msg);
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
      renderDraft();
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
  async function startCall(calledSubjectId) {
    if (call) return;
    clearError();
    try {
      subjectId = calledSubjectId || null;
      if (!subjectId) return showError('No participant on this call.');

      const s = await fetchJson('/api/brain/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId }),
      });
      sessionId = s.sessionId;
      $('#sessionPill').textContent = `session ${sessionId.slice(0, 8)}… · ${subjectId}`;
      $('#sessionPill').className = 'pill ok';
      log('session.start', { sessionId, subjectId });
      turnsDone = 0;
      lastHadOpener = false;

      interim = '';
      pendingFinals = [];
      queue = [];
      brainSig = null;
      logCount = 0;
      $('#logList').textContent = '';
      $('#logCount').textContent = '0 events';
      resetConversation();

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const params = new URLSearchParams();
      params.set('encoding', 'linear16');
      params.set('sample_rate', String(ctx.sampleRate));
      if (USE_FLUX) {
        // Flux decides when the turn is over (it reads the words, not just the
        // silence) and reports it as EndOfTurn. No timers of ours involved.
        params.set('model', 'flux-general-en');
        params.set('eot_threshold', String(FLUX_EOT_THRESHOLD));
      } else {
        params.set('model', 'nova-3');
        // Keep speech as words — smart_format rewrites spoken dates into digits,
        // which loses fidelity for identity checks.
        params.set('smart_format', 'false');
        params.set('numerals', 'false');
        params.set('punctuate', 'true');
        params.set('interim_results', 'true');
        params.set('vad_events', 'true');
        // endpointing only decides when a final transcript is emitted; when we
        // reply is decided by SILENCE_MS above. Deliberately generous so a
        // natural pause mid-sentence is not read as the end of a turn.
        params.set('endpointing', '800');
        params.set('utterance_end_ms', '1500');
      }

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/listen?${params}`);
      ws.binaryType = 'arraybuffer';
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        handleStt(m);
      };
      ws.onerror = () => showError('Live STT socket error');
      ws.onclose = (ev) => {
        // A dropped STT socket ends the call, so say why in the session log.
        if (call) log('stt.closed', { code: ev.code, reason: ev.reason });
        if (call) endCall();
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = ctx.createMediaStreamSource(stream);

      // Level meter for the orb.
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (agentSpeaking || muted) {
          // Half-duplex + mute. Flux gets silence rather than nothing, so the
          // stream is continuous and never times out while the agent talks.
          if (USE_FLUX) ws.send(SILENCE.buffer);
          return;
        }
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

      // The agent places the call, so it speaks first.
      queue.push({ opening: true });
      pump();
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
      renderDraft();
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
    cancelHold();
    if (heldTurn) { pendingFinals = [heldTurn]; heldTurn = ''; }
    try { currentAudio?.stop?.(); currentAudio?.pause?.(); } catch {}
    try { ctx.close(); } catch {}
    flushFinals();
    $('#mute').disabled = true;
    $('#end').disabled = true;
    $('#muteLabel').textContent = 'Mute';
    $('#mute').classList.remove('on');
    $('#backToStart').classList.remove('hidden');
    setState('idle');
    log('mic.stop', {});

    addNote('The call has ended. Start a new call any time from the first screen.');

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
    // Close the call record too, so the dashboard stops showing it as live.
    if (activeCallId) {
      const callId = activeCallId;
      activeCallId = null;
      fetchJson(`/api/calls/${encodeURIComponent(callId)}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {});
    }
  }

  // --------------------------------------------------------- incoming calls
  //
  // This handset waits to be rung. The dashboard places the call; the server
  // pushes a "ringing" event down the stream below; we show the incoming
  // screen. Answering runs the same startCall() the call flow uses — the
  // agent still opens, because it is still an outbound call from the site.

  let incoming = null;       // the call we are currently ringing for
  let ringTone = null;       // WebAudio, so no asset to ship or fail to load
  let callStream = null;

  /**
   * A ring tone without an audio file.
   *
   * Two tones at 440 and 480 Hz for two seconds, four off — the North
   * American ringback cadence. Synthesised because a missing mp3 on a phone
   * over a tunnel is a silent failure, and silence is the one thing a ringing
   * phone must not be.
   */
  function startRinging() {
    stopRinging();
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const oscs = [440, 480].map((hz) => {
        const o = ctx.createOscillator();
        o.frequency.value = hz;
        o.connect(gain);
        o.start();
        return o;
      });
      let on = false;
      const tick = () => {
        on = !on;
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.linearRampToValueAtTime(on ? 0.08 : 0, now + 0.04);
        ringTone.timer = window.setTimeout(tick, on ? 2000 : 4000);
      };
      ringTone = { ctx, gain, oscs, timer: null };
      tick();
    } catch {
      ringTone = null;   // autoplay blocked until a gesture — the screen still shows
    }
  }

  function stopRinging() {
    if (!ringTone) return;
    window.clearTimeout(ringTone.timer);
    try {
      ringTone.oscs.forEach((o) => o.stop());
      ringTone.ctx.close();
    } catch {}
    ringTone = null;
  }

  function showIncoming(event) {
    if (call || incoming) return;        // already busy; the caller gets no answer
    incoming = event;
    $('#incomingParty').textContent = 'Study team';
    $('#incomingSub').textContent = event.subjectId
      ? `Pre-visit medication review · ${event.subjectId}`
      : 'Pre-visit medication review';
    $('#incomingView').classList.remove('hidden');
    startRinging();
  }

  function hideIncoming() {
    incoming = null;
    stopRinging();
    $('#incomingView').classList.add('hidden');
  }

  async function answerIncoming() {
    if (!incoming) return;
    const event = incoming;
    hideIncoming();
    try {
      await fetchJson(`/api/calls/${encodeURIComponent(event.callId)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch {}

    // Ringing named the participant, so the handset does not have to.
    activeCallId = event.callId;
    await startCall(event.subjectId);
    if (sessionId) {
      // Tie the call to the session so the two records can be read together.
      fetchJson(`/api/calls/${encodeURIComponent(event.callId)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {});
    }
  }

  async function declineIncoming() {
    if (!incoming) return;
    const { callId } = incoming;
    hideIncoming();
    fetchJson(`/api/calls/${encodeURIComponent(callId)}/decline`, { method: 'POST' }).catch(() => {});
  }


  function listenForCalls() {
    if (callStream) return;
    try {
      callStream = new EventSource('/api/calls/stream');
    } catch {
      return;   // no SSE support: the Start button still works
    }
    callStream.onmessage = (ev) => {
      let event;
      try { event = JSON.parse(ev.data); } catch { return; }
      if (event.type === 'ringing') showIncoming(event);
      if (event.type === 'hangup' && incoming?.callId === event.callId) hideIncoming();
    };
    // EventSource reconnects on its own; nothing to do but not crash.
    callStream.onerror = () => {};
  }

  // ------------------------------------------------------------- wiring
  $('#answerCall').addEventListener('click', answerIncoming);
  $('#declineCall').addEventListener('click', declineIncoming);
  listenForCalls();

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

  // ------------------------------------------------------------- idle clock
  //
  // The idle screen is a clock and nothing else — the handset does not offer to
  // place a call, it waits to be rung. Ticking locally keeps the screen honest
  // without a network round-trip.
  function tickClock() {
    const now = new Date();
    const time = $('#idleTime');
    const date = $('#idleDate');
    if (time) {
      time.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      time.dateTime = now.toISOString();
    }
    if (date) {
      date.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    }
  }
  tickClock();
  window.setInterval(tickClock, 15000);

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

  setState('idle');
})();
