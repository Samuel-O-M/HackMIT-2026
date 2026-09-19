'use strict';

/* ============================ TEST AREA ============================ */

(function () {
  const { $, showError, clearError, fetchJson, speak, stopAudio, Recorder, transcribeBlob, fillVoices } = window.App;

  const chatHistory = [];
  const recorder = new Recorder();

  // ---------------------------------------------------------------- settings
  function sttParams() {
    const p = {};
    p.model = $('#sttModel').value;
    const lang = $('#sttLanguage').value.trim();
    if (lang) p.language = lang;
    p.smart_format = String($('#sttSmart').checked);
    p.punctuate = String($('#sttPunct').checked);
    p.diarize = String($('#sttDiarize').checked);
    p.numerals = String($('#sttNumerals').checked);
    const redact = $('#sttRedact').value;
    if (redact) p.redact = redact;
    return p;
  }

  // ------------------------------------------------------- batch STT (mic)
  $('#recordBtn').addEventListener('click', async () => {
    if (recorder.recording) {
      const blob = await recorder.stop();
      $('#recordBtn').textContent = '● Record';
      $('#recordBtn').classList.remove('recording');
      $('#recordState').textContent = 'transcribing…';
      try {
        const data = await transcribeBlob(blob, sttParams());
        $('#transcript').value = data.transcript || '(no speech detected)';
        $('#sttRaw').textContent = JSON.stringify(data.raw, null, 2);
        $('#recordState').textContent = 'done';
      } catch (err) {
        $('#recordState').textContent = 'error';
        showError('STT: ' + err.message);
      }
      return;
    }
    clearError();
    try {
      await recorder.start();
      $('#recordBtn').textContent = '■ Stop';
      $('#recordBtn').classList.add('recording');
      $('#recordState').textContent = 'recording…';
    } catch (err) {
      showError('Microphone: ' + err.message);
    }
  });

  // ------------------------------------------------------- transcribe a URL
  $('#urlBtn').addEventListener('click', async () => {
    clearError();
    const url = $('#urlInput').value.trim();
    if (!url) return showError('Enter an audio URL first.');
    const entries = Object.entries(sttParams()).filter(([, v]) => v != null);
    const qs = '?' + new URLSearchParams(entries).toString();
    $('#urlRaw').textContent = 'transcribing…';
    try {
      const res = await fetch('/api/transcribe' + qs, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.err_msg || data?.error || 'failed');
      $('#urlRaw').textContent = JSON.stringify(data.raw, null, 2);
      $('#transcript').value = data.transcript || '';
    } catch (err) {
      $('#urlRaw').textContent = '';
      showError('STT: ' + err.message);
    }
  });

  // ------------------------------------------------------- LIVE streaming STT
  let live = null;
  const liveLog = (line) => {
    const el = $('#liveLog');
    el.textContent = `${new Date().toLocaleTimeString()}  ${line}\n` + el.textContent;
  };

  async function startLive() {
    clearError();
    let ctx, ws, stream, source, processor;
    let finalText = '';

    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const params = new URLSearchParams();
    params.set('model', $('#sttModel').value);
    params.set('encoding', 'linear16');
    params.set('sample_rate', String(ctx.sampleRate));
    params.set('smart_format', String($('#sttSmart').checked));
    params.set('punctuate', String($('#sttPunct').checked));
    params.set('diarize', String($('#sttDiarize').checked));
    params.set('numerals', String($('#sttNumerals').checked));
    params.set('interim_results', String($('#liveInterimChk').checked));
    params.set('vad_events', String($('#liveVad').checked));
    const ep = $('#liveEndpointing').value;
    if (ep) params.set('endpointing', ep);
    const lang = $('#sttLanguage').value.trim();
    if (lang) params.set('language', lang);
    const redact = $('#sttRedact').value;
    if (redact) params.set('redact', redact);

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws/listen?${params}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      liveLog('connected');
      $('#liveState').textContent = 'live';
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'Results') {
        const alt = msg.channel?.alternatives?.[0];
        const text = alt?.transcript || '';
        if (msg.is_final) {
          if (text) {
            finalText = finalText ? `${finalText} ${text}` : text;
            $('#liveFinal').value = finalText;
          }
          $('#liveInterim').textContent = '…';
        } else {
          $('#liveInterim').textContent = text || '…';
        }
        if (text) liveLog(`Results final=${msg.is_final} speech_final=${msg.speech_final} :: ${text}`);
      } else if (msg.type === 'SpeechStarted') {
        liveLog('SpeechStarted');
      } else if (msg.type === 'UtteranceEnd') {
        liveLog('UtteranceEnd');
      } else if (msg.type === 'Metadata') {
        liveLog(`Metadata request_id=${msg.request_id}`);
      }
    };
    ws.onerror = () => liveLog('WebSocket error');
    ws.onclose = (e) => {
      liveLog(`closed (${e.code})`);
      stopLive();
    };

    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    source = ctx.createMediaStreamSource(stream);
    processor = ctx.createScriptProcessor(4096, 1, 1);
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
    processor.connect(ctx.destination); // required for onaudioprocess to fire

    live = { ctx, ws, stream, source, processor };
  }

  function stopLive() {
    if (!live) return;
    const { ctx, ws, stream, source, processor } = live;
    try { processor.disconnect(); } catch {}
    try { source.disconnect(); } catch {}
    try { stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { if (ws.readyState === WebSocket.OPEN) ws.close(); } catch {}
    try { ctx.close(); } catch {}
    live = null;
    $('#liveBtn').textContent = '▶ Start live';
    $('#liveBtn').classList.remove('recording');
    $('#liveState').textContent = 'idle';
  }

  $('#liveBtn').addEventListener('click', async () => {
    if (live) {
      stopLive();
      return;
    }
    $('#liveBtn').textContent = '■ Stop live';
    $('#liveBtn').classList.add('recording');
    $('#liveFinal').value = '';
    $('#liveInterim').textContent = '…';
    try {
      await startLive();
    } catch (err) {
      showError('Live STT: ' + err.message);
      stopLive();
    }
  });

  // --------------------------------------------------------------- chat
  function renderMessages() {
    const box = $('#messages');
    box.innerHTML = '';
    for (const m of chatHistory) {
      const div = document.createElement('div');
      div.className = 'msg ' + m.role;
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = m.role === 'user' ? 'You' : 'Assistant';
      div.appendChild(who);
      div.appendChild(document.createTextNode(m.content));
      box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
  }

  async function sendChat(text) {
    const content = (text || '').trim();
    if (!content) return;
    clearError();
    chatHistory.push({ role: 'user', content });
    renderMessages();
    $('#chatInput').value = '';
    $('#sendBtn').disabled = true;
    try {
      const data = await fetchJson('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chatHistory,
          model: $('#chatModel').value,
          reasoningEffort: $('#chatEffort').value,
        }),
      });
      chatHistory.push({ role: 'assistant', content: data.reply });
      renderMessages();
      if ($('#autoSpeak').checked && data.reply) {
        await speak(data.reply, { model: $('#ttsVoice').value });
      }
    } catch (err) {
      showError('Chat: ' + err.message);
    } finally {
      $('#sendBtn').disabled = false;
    }
  }

  $('#sendBtn').addEventListener('click', () => sendChat($('#chatInput').value));
  $('#chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat($('#chatInput').value);
  });
  $('#useTranscriptBtn').addEventListener('click', () => {
    const t = $('#transcript').value || $('#liveFinal').value;
    if (t) {
      $('#chatInput').value = t;
      $('#chatInput').focus();
    }
  });

  // --------------------------------------------------------------- TTS
  $('#speakBtn').addEventListener('click', async () => {
    clearError();
    const text = $('#ttsText').value.trim();
    if (!text) return showError('Type something to speak.');
    try {
      await speak(text, {
        model: $('#ttsVoice').value,
        encoding: $('#ttsEncoding').value,
        container: $('#ttsContainer').value,
      });
    } catch (err) {
      showError('TTS: ' + err.message);
    }
  });
  $('#stopAudioBtn').addEventListener('click', stopAudio);

  // --------------------------------------------------------------- init
  fillVoices($('#ttsVoice'));
  const { loadHealth, initTabs } = window.App;
  loadHealth();
  initTabs();
})();
