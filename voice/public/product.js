'use strict';

/* ============ PRODUCT — fast Talker + async Thinker/Planner ============ */

(function () {
  const { $, showError, clearError, fetchJson, speak, Recorder } = window.App;

  const recorder = new Recorder();
  let sessionId = null;
  let subjectId = null;
  const display = []; // { role: 'user'|'agent', content }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function render() {
    const box = $('#prodMessages');
    box.innerHTML = '';
    for (const m of display) {
      const div = document.createElement('div');
      div.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = m.role === 'user' ? 'Participant' : 'Talker';
      div.appendChild(who);
      div.appendChild(document.createTextNode(m.content));
      box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
  }

  function renderPlanner(state, planner) {
    const status = planner
      ? `${planner.running ? '⏳ planning…' : '✓ idle'}${planner.lastPlanModel ? ' · ' + planner.lastPlanModel : ''}` +
        (planner.errors?.length ? ` · errors: ${planner.errors.join('; ')}` : '')
      : '—';
    $('#plannerStatus').textContent = status;

    $('#thinkGoal').textContent = state?.goal || '—';
    $('#thinkKnown').textContent = (state?.known || []).map((k) => k.fact || JSON.stringify(k)).join('  •  ') || '—';
    $('#thinkMissing').textContent = (state?.missing || []).join('  •  ') || '—';
    $('#thinkNext').textContent = (state?.next_questions || []).join('  •  ') || '—';
    $('#thinkFlags').textContent =
      (state?.flags || [])
        .map((f) => `${f.type}: ${f.detail}${f.protocol_section ? ` (§${f.protocol_section})` : ''}`)
        .join('  •  ') || '—';
    $('#thinkRaw').textContent = JSON.stringify({ state, planner }, null, 2);
  }

  /** Poll planner state until it settles (the planner runs after the reply). */
  async function refreshPlanner(sid, attempts = 8, delay = 1200) {
    for (let i = 0; i < attempts; i++) {
      try {
        const d = await fetchJson(`/api/brain/state?sessionId=${encodeURIComponent(sid)}`);
        renderPlanner(d.state, d.planner);
        if (!d.planner?.running && i > 0) return; // settled after at least one check
      } catch {
        return;
      }
      await sleep(delay);
    }
  }

  async function loadPatients() {
    try {
      const { patients } = await fetchJson('/api/patients');
      const sel = $('#patientSelect');
      sel.innerHTML = '';
      for (const p of patients) {
        const opt = document.createElement('option');
        opt.value = p.subject_id;
        opt.textContent = `${p.subject_id} — ${p.given_name} ${p.family_name} (${p.study_id || 'no study'})`;
        sel.appendChild(opt);
      }
      subjectId = sel.value || null;
    } catch (err) {
      showError('Patients: ' + err.message);
    }
  }

  async function startSession() {
    clearError();
    subjectId = $('#patientSelect').value;
    if (!subjectId) return showError('No participant selected.');
    try {
      const data = await fetchJson('/api/brain/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId }),
      });
      sessionId = data.sessionId;
      display.length = 0;
      render();
      renderPlanner(null, null);
      $('#sessionState').textContent = `session ${sessionId.slice(0, 8)}… (${subjectId})`;
      $('#sessionState').classList.add('ok');
    } catch (err) {
      showError('Session: ' + err.message);
    }
  }

  async function sendTurn(text) {
    const content = (text || '').trim();
    if (!content) return;
    if (!sessionId) {
      await startSession();
      if (!sessionId) return;
    }
    clearError();
    display.push({ role: 'user', content });
    render();
    $('#prodInput').value = '';
    $('#prodSendBtn').disabled = true;
    $('#plannerStatus').textContent = '⏳ planning…';

    try {
      const data = await fetchJson('/api/brain/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, subjectId, text: content }),
      });
      display.push({ role: 'agent', content: data.say || '(no reply)' });
      render();
      renderPlanner(data.state, { running: data.planning });
      if ($('#prodAutoSpeak').checked && data.say) {
        await speak(data.say, { model: 'aura-2-helena-en' });
      }
      // The reply is already spoken; now catch the planner when it lands.
      refreshPlanner(sessionId);
    } catch (err) {
      showError('Brain: ' + err.message);
    } finally {
      $('#prodSendBtn').disabled = false;
    }
  }

  // ---- record → transcribe → (auto) send ----
  $('#prodRecordBtn').addEventListener('click', async () => {
    if (recorder.recording) {
      const blob = await recorder.stop();
      $('#prodRecordBtn').textContent = '● Record';
      $('#prodRecordBtn').classList.remove('recording');
      $('#prodRecordState').textContent = 'transcribing…';
      try {
        const data = await window.App.transcribeBlob(blob, {
          model: 'nova-3',
          smart_format: 'true',
          punctuate: 'true',
        });
        $('#prodTranscript').value = data.transcript || '';
        $('#prodUseTranscriptBtn').disabled = !data.transcript;
        $('#prodRecordState').textContent = 'done';
        if ($('#prodAutoSpeak').checked && data.transcript) await sendTurn(data.transcript);
      } catch (err) {
        $('#prodRecordState').textContent = 'error';
        showError('STT: ' + err.message);
      }
      return;
    }
    clearError();
    try {
      await recorder.start();
      $('#prodRecordBtn').textContent = '■ Stop';
      $('#prodRecordBtn').classList.add('recording');
      $('#prodRecordState').textContent = 'recording…';
    } catch (err) {
      showError('Microphone: ' + err.message);
    }
  });

  $('#newSessionBtn').addEventListener('click', startSession);
  $('#prodSendBtn').addEventListener('click', () => sendTurn($('#prodInput').value));
  $('#prodInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendTurn($('#prodInput').value);
  });
  $('#prodUseTranscriptBtn').addEventListener('click', () => sendTurn($('#prodTranscript').value));

  loadPatients();
})();
