'use strict';

/* ===== LIVE BRAIN — a realtime call with 3 views (conversation · talker · brain) ===== */

(function () {
  const { $, showError, clearError, fetchJson, speak } = window.App;

  let sessionId = null;
  let subjectId = null;
  let pollTimer = null;

  // call state
  let call = null; // { ws, ctx, stream, source, processor }
  let currentConversation = [];
  let interim = '';
  let pendingFinals = [];
  let flushTimer = null;
  let queue = [];
  let turnBusy = false;

  const verbose = () => $('#liveVerbose').checked;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- DOM utils
  function el(tag, props = {}, children = []) {
    const n = document.createElement(tag);
    if (props.class) n.className = props.class;
    if (props.text != null) n.textContent = props.text;
    for (const c of children) if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return n;
  }
  function pre(obj) {
    return el('pre', { class: 'raw', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) });
  }
  const openKeys = new Set();
  function det(summary, nodes, open = false) {
    const d = el('details', { class: 'acc' });
    // Stable key so expanded state survives re-renders (ignore "(3)" counters).
    const key = String(summary).replace(/\(.*?\)/g, '').trim();
    if (open || verbose() || openKeys.has(key)) d.open = true;
    d.addEventListener('toggle', () => {
      if (d.open) openKeys.add(key);
      else openKeys.delete(key);
    });
    d.appendChild(el('summary', { text: summary }));
    for (const n of nodes) if (n != null) d.appendChild(n);
    return d;
  }
  function list(items, render) {
    const ul = el('ul', { class: 'tight' });
    for (const it of items) ul.appendChild(el('li', {}, [render ? render(it) : String(it)]));
    return ul;
  }
  function stack(nodes) {
    const box = el('div', { class: 'stack' });
    for (const n of nodes) if (n != null) box.appendChild(n);
    return box;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setCallStatus(s) {
    const pill = $('#liveCallStatus');
    pill.textContent = s;
    pill.className = 'pill' + (s.startsWith('listening') ? ' ok' : s.startsWith('thinking') ? ' warn' : '');
  }

  // ---------------------------------------------------------------- rendering
  let convSig = null;
  function renderConversation(conversation) {
    if (conversation) currentConversation = conversation;
    const sig = JSON.stringify(currentConversation) + '||' + interim;
    if (sig === convSig) return; // nothing changed — don't touch the DOM (keeps scroll)
    convSig = sig;
    const box = $('#liveConversation');
    clear(box);

    if (!currentConversation.length && !interim) {
      box.appendChild(el('p', { class: 'muted small', text: 'No turns yet. Click “Start call” and speak.' }));
      return;
    }
    for (const turn of currentConversation) {
      const isUser = turn.speaker === 'patient';
      box.appendChild(
        el('div', { class: 'msg ' + (isUser ? 'user' : 'assistant') }, [
          el('span', { class: 'who', text: isUser ? 'Participant' : 'Agent' }),
          document.createTextNode(turn.transcript),
        ])
      );
    }
    if (interim) {
      box.appendChild(
        el('div', { class: 'msg user interim' }, [
          el('span', { class: 'who', text: 'Participant · live' }),
          document.createTextNode(interim),
        ])
      );
    }
    box.scrollTop = box.scrollHeight;
  }

  function renderTalker(lastTurn) {
    const box = $('#liveTalker');
    clear(box);
    if (!lastTurn) {
      box.appendChild(el('p', { class: 'muted small', text: 'No turn yet.' }));
      return;
    }
    const t = lastTurn.talker || {};
    const tools = t.toolCalls || [];
    box.appendChild(
      stack([
        el('div', { class: 'pillrow' }, [
          el('span', { class: 'pill', text: t.model || 'model?' }),
          el('span', { class: 'pill ok', text: `${t.latencyMs ?? '?'} ms` }),
          el('span', { class: 'pill', text: (lastTurn.at || '').replace('T', ' ').slice(0, 19) }),
        ]),
        el('div', { class: 'kv' }, [el('span', { text: 'participant said' }), el('div', { class: 'muted', text: lastTurn.userText || '—' })]),
        el('div', { class: 'kv' }, [el('span', { text: 'agent said (spoken)' }), el('div', {}, [document.createTextNode(lastTurn.say || '—')])]),
        tools.length
          ? det(`tool calls (${tools.length})`, tools.map((c, i) => det(`${i + 1}. ${c.name}`, [pre({ args: c.args, result: c.result })], verbose())), verbose())
          : el('p', { class: 'muted small', text: 'No tools called this turn.' }),
        det('planner state the Talker used', [pre(t.stateUsed ?? null)], verbose()),
      ])
    );
  }

  function renderBrain(data) {
    const box = $('#liveBrain');
    clear(box);
    if (!data) return;
    const st = data.state || null;
    const planner = data.planner || {};
    const nodes = [];

    nodes.push(
      el('div', { class: 'pillrow' }, [
        el('span', { class: 'pill ' + (planner.running ? 'warn' : 'ok'), text: planner.running ? '⏳ planning' : '✓ idle' }),
        el('span', { class: 'pill', text: planner.lastPlanModel || '—' }),
        planner.lastPlanAt ? el('span', { class: 'pill', text: planner.lastPlanAt.replace('T', ' ').slice(11, 19) }) : null,
      ])
    );
    if (planner.errors?.length) nodes.push(det('planner errors', [pre(planner.errors)], true));

    nodes.push(el('div', { class: 'kv' }, [el('span', { text: 'goal' }), el('div', { class: 'muted', text: st?.goal || '—' })]));
    nodes.push(el('div', { class: 'kv' }, [el('span', { text: 'summary' }), el('div', { class: 'muted small', text: st?.summary || '—' })]));

    const known = st?.known || [];
    nodes.push(det(`known (${known.length})`, [known.length ? list(known, (k) => `${k.fact}${k.source ? `  [${k.source}]` : ''}`) : el('p', { class: 'muted small', text: '—' })]));
    const missing = st?.missing || [];
    nodes.push(det(`missing (${missing.length})`, [missing.length ? list(missing) : el('p', { class: 'muted small', text: '—' })], missing.length > 0));
    const nq = st?.next_questions || [];
    nodes.push(det(`next questions (${nq.length})`, [nq.length ? list(nq) : el('p', { class: 'muted small', text: '—' })], nq.length > 0));
    const flags = st?.flags || [];
    nodes.push(
      det(`flags (${flags.length})`, [flags.length ? list(flags, (f) => `${f.type}: ${f.detail}${f.protocol_section ? ` (§${f.protocol_section})` : ''}`) : el('p', { class: 'muted small', text: '—' })], flags.length > 0)
    );
    const ts = st?.to_save || [];
    nodes.push(det(`pending saves (${ts.length})`, [ts.length ? pre(ts) : el('p', { class: 'muted small', text: '—' })]));

    const lp = data.lastPlan;
    if (lp) {
      nodes.push(
        det(
          `last planner run — ${lp.model}`,
          [
            el('p', { class: 'muted small', text: 'retrieval:' }),
            lp.toolCalls?.length ? list(lp.toolCalls, (c) => `${c.tool}(${JSON.stringify(c.args)})`) : el('p', { class: 'muted small', text: 'no retrieval' }),
            el('p', { class: 'muted small', text: 'writes applied:' }),
            lp.applied?.length ? pre(lp.applied) : el('p', { class: 'muted small', text: 'none' }),
          ],
          false
        )
      );
    }

    nodes.push(det('full planner state JSON', [pre(st)], verbose()));

    if (data.patient) {
      nodes.push(
        det('patient context', [
          el('p', { class: 'muted small', text: 'profile / enrollment' }),
          pre({ profile: data.patient.profile, enrollment: data.patient.enrollment }),
          el('p', { class: 'muted small', text: 'medications' }),
          pre(data.patient.medications),
          el('p', { class: 'muted small', text: 'protocol rules' }),
          pre(data.patient.protocol_rules),
        ])
      );
    }

    box.appendChild(stack(nodes));
  }

  // ---------------------------------------------------------------- data flow
  let talkerSig = null;
  let brainSig = null;
  async function refresh() {
    if (!sessionId) return;
    try {
      const data = await fetchJson(`/api/brain/debug?sessionId=${encodeURIComponent(sessionId)}`);
      renderConversation(data.conversation);

      // Only re-render a pane when its data actually changed; otherwise the
      // user's expanded <details> and scroll position would be destroyed.
      const tSig = JSON.stringify(data.lastTurn ?? null);
      if (tSig !== talkerSig) {
        talkerSig = tSig;
        renderTalker(data.lastTurn);
      }
      const bSig = JSON.stringify({
        s: data.state ?? null,
        p: data.planner ?? null,
        lp: data.lastPlan ?? null,
        pt: data.patient ?? null,
      });
      if (bSig !== brainSig) {
        brainSig = bSig;
        renderBrain(data);
      }
    } catch {
      /* transient */
    }
  }

  async function refreshUntilIdle(attempts = 8, delay = 1300) {
    for (let i = 0; i < attempts; i++) {
      await refresh();
      await sleep(delay);
      if (!sessionId) return;
    }
  }

  async function loadPatients() {
    try {
      const { patients } = await fetchJson('/api/patients');
      const sel = $('#livePatient');
      sel.innerHTML = '';
      for (const p of patients) {
        const opt = el('option', { text: `${p.subject_id} — ${p.given_name} ${p.family_name}` });
        opt.value = p.subject_id;
        sel.appendChild(opt);
      }
      subjectId = sel.value || null;
    } catch (err) {
      showError('Patients: ' + err.message);
    }
  }

  async function newSession() {
    subjectId = $('#livePatient').value;
    if (!subjectId) {
      showError('No participant selected.');
      return null;
    }
    const data = await fetchJson('/api/brain/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId }),
    });
    sessionId = data.sessionId;
    $('#liveSessionState').textContent = `session ${sessionId.slice(0, 8)}… (${subjectId})`;
    $('#liveSessionState').classList.add('ok');
    queue = [];
    pendingFinals = [];
    interim = '';
    convSig = talkerSig = brainSig = null;
    renderConversation([]);
    renderTalker(null);
    renderBrain(null);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refresh, 1600);
    await refresh();
    return sessionId;
  }

  /** One conversational turn: talker replies fast; planner runs after. */
  async function doTurn(text) {
    setCallStatus('thinking…');
    try {
      await fetchJson('/api/brain/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, subjectId, text }),
      });
      await refresh();
      if ($('#liveAutoSpeak').checked) {
        const lastAgent = [...currentConversation].reverse().find((t) => t.speaker === 'agent');
        if (lastAgent?.transcript) await speak(lastAgent.transcript, { model: 'aura-2-helena-en' });
      }
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

  // ---- live STT → auto-send each finished utterance ----
  function scheduleFlush(ms = 900) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushFinals, ms);
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
        scheduleFlush(msg.speech_final ? 350 : 900);
      } else {
        interim = t;
        if (call) setCallStatus('listening…');
      }
      renderConversation(currentConversation);
    } else if (msg.type === 'UtteranceEnd') {
      scheduleFlush(250);
    }
  }

  async function startCall() {
    if (call) return;
    clearError();
    try {
      if (!sessionId) await newSession();
      if (!sessionId) return;

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const params = new URLSearchParams();
      params.set('model', 'nova-3');
      params.set('encoding', 'linear16');
      params.set('sample_rate', String(ctx.sampleRate));
      params.set('smart_format', 'true');
      params.set('punctuate', 'true');
      params.set('interim_results', 'true');
      params.set('vad_events', 'true');
      params.set('endpointing', '300');
      params.set('utterance_end_ms', '1000');

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/listen?${params}`);
      ws.binaryType = 'arraybuffer';
      ws.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        handleStt(m);
      };
      ws.onerror = () => showError('Live STT socket error');
      ws.onclose = () => {
        if (call) endCall();
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
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
      $('#liveStartCall').disabled = true;
      $('#liveEndCall').disabled = false;
      setCallStatus('listening…');
    } catch (err) {
      showError('Mic: ' + err.message);
      endCall();
    }
  }

  async function endCall() {
    if (!call) {
      setCallStatus('idle');
      return;
    }
    const { ws, ctx, stream, source, processor } = call;
    call = null;
    try { processor.disconnect(); } catch {}
    try { source.disconnect(); } catch {}
    try { stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { if (ws.readyState === WebSocket.OPEN) ws.close(); } catch {}
    try { ctx.close(); } catch {}
    flushFinals();
    $('#liveStartCall').disabled = false;
    $('#liveEndCall').disabled = true;
    setCallStatus('idle');
    if (sessionId) {
      try {
        await fetchJson('/api/brain/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
      } catch {}
    }
    refresh();
  }

  // ---------------------------------------------------------------- wiring
  $('#liveStartCall').addEventListener('click', startCall);
  $('#liveEndCall').addEventListener('click', endCall);
  $('#liveSend').addEventListener('click', () => {
    enqueueTurn($('#liveInput').value);
    $('#liveInput').value = '';
  });
  $('#liveInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      enqueueTurn($('#liveInput').value);
      $('#liveInput').value = '';
    }
  });
  $('#liveRefresh').addEventListener('click', refresh);
  $('#liveVerbose').addEventListener('change', () => {
    // force a rebuild so the verbose toggle takes effect
    convSig = talkerSig = brainSig = null;
    refresh();
  });
  $('#livePatient').addEventListener('change', () => {
    // switching participant starts a fresh session on next call
    if (call) endCall();
    sessionId = null;
    $('#liveSessionState').textContent = 'no session';
    $('#liveSessionState').classList.remove('ok');
  });

  loadPatients();
  setCallStatus('idle');
})();
