'use strict';

/**
 * Helpers for turning a streamed reply into speech as it arrives.
 *
 * Text-to-speech time grows with length (a short clause is ~0.9 s, a full
 * sentence ~3 s), so waiting for the whole reply before speaking is what made
 * the call feel slow. Instead the reply is cut into small chunks; each is
 * synthesised the moment it is complete, and playback starts on the first.
 */

/** A period after these does not end a sentence: "Mr. Smith", "e.g. aspirin". */
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'e.g', 'i.e', 'approx', 'no']);

/** Does the period at `index` in `text` close a real sentence, or an abbreviation/initial? */
function endsSentence(text, index) {
  if (text[index] !== '.') return true;
  const word = (text.slice(0, index).match(/(\S+)$/) || [''])[0].toLowerCase().replace(/^[("']+/, '');
  return !(ABBREVIATIONS.has(word) || /^[a-z]$/.test(word));
}

/**
 * Cuts a stream of text into speakable chunks. The first chunk ends at the
 * first clause (comma or sentence end) so speech starts as early as possible;
 * later chunks end at sentence boundaries.
 *
 * A boundary is punctuation followed by whitespace, so "3.5 mg" and "10 mg."
 * mid-word aren't split; the final sentence is emitted by flush().
 */
function createChunker(emit, { firstMinChars = 14, firstMaxChars = 34, maxChars = 160 } = {}) {
  let buf = '';
  let emitted = 0;

  const take = (n) => {
    const piece = buf.slice(0, n).trim();
    buf = buf.slice(n);
    if (piece) {
      emitted++;
      emit(piece);
    }
  };

  const boundary = () => {
    const re = emitted === 0 ? /[.!?…,;:—]["')\]]?\s/g : /[.!?…]["')\]]?\s/g;
    let m;
    while ((m = re.exec(buf))) {
      const end = m.index + m[0].length;
      if (!endsSentence(buf, m.index)) continue;
      if (emitted === 0 && end < firstMinChars) continue; // too short to be worth a request
      return end;
    }
    // First chunk only. A model that opens with a long clause and no comma used
    // to hold up all speech until the sentence finished; breaking at a word is
    // worth it once, because it is the chunk everything else waits behind.
    if (emitted === 0 && buf.length > firstMaxChars) {
      const space = buf.lastIndexOf(' ', firstMaxChars);
      if (space >= firstMinChars) return space + 1;
    }
    if (buf.length > maxChars) {
      const space = buf.lastIndexOf(' ', maxChars);
      if (space > 40) return space + 1;
    }
    return -1;
  };

  return {
    push(delta) {
      buf += delta;
      for (let end = boundary(); end >= 0; end = boundary()) take(end);
    },
    flush() {
      take(buf.length);
    },
    get emitted() {
      return emitted;
    },
  };
}

/**
 * Splits the Talker's stream into speech and the trailing planner directive.
 *
 * The Talker ends a reply with `<<PLAN: ...>>` — one line telling the background
 * planner what to work out next. It is never spoken. Speech is forwarded the
 * moment it arrives; only a few characters are held back, in case a delta ends
 * part-way through the marker.
 */
const PLAN_MARK = '<<PLAN:';

function createPlanSplitter(onSpeech) {
  let raw = '';
  let fed = 0;
  let cut = -1;

  const emit = (upto) => {
    if (upto > fed) {
      const piece = raw.slice(fed, upto);
      fed = upto;
      if (piece) onSpeech(piece);
    }
  };

  return {
    push(delta) {
      raw += delta;
      if (cut !== -1) return; // everything after the marker belongs to the planner
      const at = raw.indexOf(PLAN_MARK);
      if (at !== -1) {
        cut = at;
        emit(at);
        return;
      }
      emit(raw.length - (PLAN_MARK.length - 1));
    },
    flush() {
      if (cut === -1) emit(raw.length);
    },
    /** Only the words meant to be said out loud. */
    get speech() {
      return (cut === -1 ? raw : raw.slice(0, cut)).trim();
    },
    /** The line for the planner, or null if the Talker did not leave one. */
    get directive() {
      const m = raw.match(/<<\s*PLAN\s*:([\s\S]*?)(?:>>|$)/i);
      return m && m[1].trim() ? m[1].trim() : null;
    },
  };
}

/** Text safe to hand to TTS: no markdown, quote marks or role prefixes. */
function speakable(text, { first = false } = {}) {
  let out = String(text || '').replace(/[*_`#>]/g, '').replace(/["“”]/g, '');
  if (first) out = out.replace(/^\s*(agent|assistant|say|speak|output)\s*[:\-]\s*/i, '');
  return out.trim();
}

module.exports = { createChunker, createPlanSplitter, speakable, endsSentence };
