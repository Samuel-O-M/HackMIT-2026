'use strict';

/* ============ LIVE BRAIN — 3 views (conversation · talker · brain) ============ */

(function () {
  const { $, showError, clearError, fetchJson, speak, Recorder } = window.App;

  const recorder = new Recorder();
  let sessionId = null;
  let subjectId = null;
  let pollTimer = null;

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
  function det(summary, nodes, open = false) {
    const d = el('details', { class: 'acc' });
    if (open) d.open = true;
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

  // ---------------------------------------------------------------- rendering
  function renderConversation(conversation) {
    const box = $('#liveConversation');
    clear(box);
    if (!conversation?.length) {
      box.appendChild(el('p', { class: 'muted small', text: 'No turns yet.' }));
      return;
    }
    for (const turn of conversation) {
      const isUser = turn.speaker === 'patient';
      const div = el('div', { class: 'msg ' + (isUser ? 'user' : 'assistant') }, [
        el('span', { class: 'who', text: isUser ? 'Participant' : 'Agent (Talker)' }),
        document.createTextNode(turn.transcript),
      ]);
      box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
  }

  function renderTalker(lastTurn) {
    const box = $('#liveTalker');
    clear(box);
    if (!lastTurn) {
      box.appendChild(el('p', { class: 'muted small', text: 'No turn yet — record or type something.' }));
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
        el('div', { class: 'kv' }, [el('span', { text: 'talker replied (spoken)' }), el('div', {}, [document.createTextNode(lastTurn.say || '—')])]),
        tools.length
          ? det(
              `tool calls (${tools.length})`,
              tools.map((c, i) =>
                det(`${i + 1}. ${c.name}`, [pre({ args: c.args, result: c.result })], verbose())
              ),
              verbose()
            )
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
    nodes.push(
      det(`known (${known.length})`, [known.length ? list(known, (k) => `${k.fact}${k.source ? `  [${k.source}]` : ''}`) : el('p', { class: 'muted small', text: '—' })])
    );
    const missing = st?.missing || [];
    nodes.push(det(`missing (${missing.length})`, [missing.length ? list(missing) : el('p', { class: 'muted small', text: '—' })], missing.length > 0));
    const nq = st?.next_questions || [];
    nodes.push(det(`next questions (${nq.length})`, [nq.length ? list(nq) : el('p', { class: 'muted small', text: '—' })], nq.length > 0));
    const flags = st?.flags || [];
    nodes.push(
      det(
        `flags (${flags.length})`,
        [flags.length ? list(flags, (f) => `${f.type}: ${f.detail}${f.protocol_section ? ` (§${f.protocol_section})` : ''}`) : el('p', { class: 'muted small', text: '—' })],
        flags.length > 0
      )
    );
    const ts = st?.to_save || [];
    nodes.push(det(`pending saves (${ts.length})`, [ts.length ? pre(ts) : el('p', { class: 'muted small', text: '—' })]));

    const lp = data.lastPlan;
    if (lp) {
      nodes.push(
        det(
          `last planner run — ${lp.model}`,
          [
            lp.toolCalls?.length ? el('p', { class: 'muted small', text: 'retrieval:' }) : null,
            lp.toolCalls?.length
              ? list(lp.toolCalls, (c) => `${c.tool}(${JSON.stringify(c.args)})`)
              : el('p', { class: 'muted small', text: 'no retrieval' }),
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
          data.patient.advice?.length ? el('p', { class: 'muted small', text: 'advice logged' }) : null,
          data.patient.advice?.length ? pre(data.patient.advice) : null,
        ])
      );
    }

    box.appendChild(stack(nodes));
  }

  // ---------------------------------------------------------------- data flow
  async function refresh() {
    if (!sessionId) return;
    try {
      const data = await fetchJson(`/api/brain/debug?sessionId=${encodeURIComponent(sessionId)}`);
      renderConversation(data.conversation);
      renderTalker(data.lastTurn);
      renderBrain(data);
    } catch (err) {
      /* transient; ignore on poll */
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
    clearError();
    subjectId = $('#livePatient').value;
    if (!subjectId) return showError('No participant selected.');
    try {
      const data = await fetchJson('/api/brain/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId }),
      });
      sessionId = data.sessionId;
      $('#liveSessionState').textContent = `session ${sessionId.slice(0, 8)}… (${subjectId})`;
      $('#liveSessionState').classList.add('ok');
      renderConversation([]);
      renderTalker(null);
      renderBrain(null);
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(refresh, 1600);
      refresh();
    } catch (err) {
      showError('Session: ' + err.message);
    }
  }

  async function send(text) {
    const content = (text || '').trim();
    if (!content) return;
    if (!sessionId) await newSession();
    if (!sessionId) return;
    clearError();
    $('#liveSend').disabled = true;
    try {
      await fetchJson('/api/brain/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, subjectId, text: content }),
      });
      $('#liveInput').value = '';
      await refresh();
      if ($('#liveAutoSpeak').checked) {
        // speak the latest agent line
        const data = await fetchJson(`/api/brain/debug?sessionId=${encodeURIComponent(sessionId)}`);
        const lastAgent = [...(data.conversation || [])].reverse().find((t) => t.speaker === 'agent');
        if (lastAgent?.transcript) await speak(lastAgent.transcript, { model: 'aura-2-helena-en' });
      }
      refreshUntilIdle();
    } catch (err) {
      showError('Brain: ' + err.message);
    } finally {
      $('#liveSend').disabled = false;
    }
  }

  // ---- record → transcribe → send ----
  $('#liveRecord').addEventListener('click', async () => {
    if (recorder.recording) {
      const blob = await recorder.stop();
      $('#liveRecord').textContent = '● Record';
      $('#liveRecord').classList.remove('recording');
      $('#liveRecordState').textContent = 'transcribing…';
      try {
        const data = await window.App.transcribeBlob(blob, { model: 'nova-3', smart_format: 'true', punctuate: 'true' });
        $('#liveRecordState').textContent = 'done';
        if (data.transcript) {
          if ($('#liveAutoSend').checked) await send(data.transcript);
          else $('#liveInput').value = data.transcript;
        }
      } catch (err) {
        $('#liveRecordState').textContent = 'error';
        showError('STT: ' + err.message);
      }
      return;
    }
    clearError();
    try {
      await recorder.start();
      $('#liveRecord').textContent = '■ Stop';
      $('#liveRecord').classList.add('recording');
      $('#liveRecordState').textContent = 'recording…';
    } catch (err) {
      showError('Microphone: ' + err.message);
    }
  });

  $('#liveNewSession').addEventListener('click', newSession);
  $('#liveSend').addEventListener('click', () => send($('#liveInput').value));
  $('#liveInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send($('#liveInput').value);
  });
  $('#liveRefresh').addEventListener('click', refresh);
  $('#liveVerbose').addEventListener('change', refresh);

  loadPatients();
})();
