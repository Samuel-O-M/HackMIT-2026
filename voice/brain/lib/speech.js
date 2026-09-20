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
function createChunker(emit, { firstMinChars = 14, maxChars = 160 } = {}) {
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

/** Text safe to hand to TTS: no markdown, quote marks or role prefixes. */
function speakable(text, { first = false } = {}) {
  let out = String(text || '').replace(/[*_`#>]/g, '').replace(/["“”]/g, '');
  if (first) out = out.replace(/^\s*(agent|assistant|say|speak|output)\s*[:\-]\s*/i, '');
  return out.trim();
}

module.exports = { createChunker, speakable, endsSentence };
