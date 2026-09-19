'use strict';

/* Shared helpers. Exposed on window.App. */

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  let audio = null;

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
      const msg =
        data?.error?.message || data?.error?.err_msg || data?.error || `HTTP ${res.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
  }

  /** Play text through Deepgram TTS. params: { model, encoding, container, ... } */
  async function speak(text, params = {}) {
    const entries = Object.entries(params).filter(([, v]) => v !== '' && v != null);
    const qs = entries.length ? '?' + new URLSearchParams(entries).toString() : '';
    const res = await fetch('/api/tts' + qs, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error?.message || d.error || `TTS failed (${res.status})`);
    }
    const blob = await res.blob();
    stopAudio();
    audio = new Audio(URL.createObjectURL(blob));
    await audio.play().catch(() => {});
    return blob;
  }

  function stopAudio() {
    if (audio) {
      audio.pause();
      audio.src = '';
      audio = null;
    }
  }

  /** Minimal mic recorder returning a Blob on stop(). */
  class Recorder {
    constructor() {
      this.mr = null;
      this.stream = null;
      this.chunks = [];
      this.mime = 'audio/webm';
    }
    get recording() {
      return this.mr && this.mr.state === 'recording';
    }
    async start() {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ['audio/webm', 'audio/mp4', 'audio/ogg'];
      const mime = preferred.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
      this.mr = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
      this.chunks = [];
      this.mr.ondataavailable = (e) => {
        if (e.data.size) this.chunks.push(e.data);
      };
      this.mr.start();
      this.mime = this.mr.mimeType || mime || 'audio/webm';
    }
    stop() {
      return new Promise((resolve) => {
        this.mr.onstop = () => {
          this.stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(this.chunks, { type: this.mime }));
        };
        this.mr.stop();
      });
    }
  }

  /** POST a raw audio Blob to /api/transcribe with allow-listed params. */
  async function transcribeBlob(blob, params = {}) {
    const entries = Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== false);
    const qs = entries.length ? '?' + new URLSearchParams(entries).toString() : '';
    const res = await fetch('/api/transcribe' + qs, {
      method: 'POST',
      headers: { 'Content-Type': (blob.type || 'audio/webm').split(';')[0] },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.err_msg || data?.error?.message || data?.error || `STT failed (${res.status})`);
    }
    return data;
  }

  async function loadHealth() {
    try {
      const h = await fetchJson('/api/health');
      const dg = $('#status [data-key="deepgram"]');
      const oa = $('#status [data-key="openai"]');
      dg.textContent = `Deepgram: ${h.deepgram ? 'set' : 'missing'}`;
      dg.classList.add(h.deepgram ? 'ok' : 'bad');
      oa.textContent = `OpenAI: ${h.openai ? 'set' : 'missing'}`;
      oa.classList.add(h.openai ? 'ok' : 'bad');
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = `${h.chatModel} · ${h.reasoningEffort}`;
      $('#status').appendChild(pill);
      return h;
    } catch {
      showError('Cannot reach the server. Is `node server.js` running?');
      return null;
    }
  }

  function initTabs() {
    const main = document.querySelector('main');
    $$('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
        $$('.tab-panel').forEach((p) =>
          p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab)
        );
        // The Live tab goes full-bleed so its 3 panes can span the viewport.
        if (main) main.classList.toggle('wide', btn.dataset.tab === 'live');
      });
    });
  }

  const VOICES = [
    ['aura-2-thalia-en', 'thalia — clear, confident (f)'],
    ['aura-2-helena-en', 'helena — caring, friendly (f)'],
    ['aura-2-harmonia-en', 'harmonia — empathetic, calm (f)'],
    ['aura-2-andromeda-en', 'andromeda — casual, expressive (f)'],
    ['aura-2-luna-en', 'luna — friendly, natural (f)'],
    ['aura-2-apollo-en', 'apollo — confident, casual (m)'],
    ['aura-2-arcas-en', 'arcas — smooth, clear (m)'],
    ['aura-2-aries-en', 'aries — warm, caring (m)'],
    ['aura-2-zeus-en', 'zeus — deep, trustworthy (m)'],
    ['aura-2-estrella-es', 'estrella — Spanish (f)'],
    ['aura-2-celeste-es', 'celeste — Spanish (f)'],
    ['aura-asteria-en', 'asteria — Aura-1 (f)'],
  ];

  function fillVoices(select) {
    for (const [id, label] of VOICES) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `${id}  (${label})`;
      select.appendChild(opt);
    }
  }

  window.App = {
    $,
    $$,
    showError,
    clearError,
    fetchJson,
    speak,
    stopAudio,
    Recorder,
    transcribeBlob,
    loadHealth,
    initTabs,
    VOICES,
    fillVoices,
  };
})();
