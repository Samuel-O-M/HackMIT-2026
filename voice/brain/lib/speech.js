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
 * Cuts a stream of text into speakable chunks at sentence boundaries only.
 * A sentence is emitted the instant its closing punctuation and following
 * whitespace arrive, so speech starts as soon as the first sentence is
 * complete. Nothing is ever cut mid-sentence; the final sentence is emitted
 * by flush().
 *
 * The only boundary is a period followed by whitespace, so "3.5 mg" and
 * "10 mg." are not split, and abbreviations ("Mr. Smith", "e.g. aspirin") do
 * not end a sentence.
 */
function createChunker(emit) {
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
    const re = /\.["')\]]?\s/g;
    let m;
    while ((m = re.exec(buf))) {
      const end = m.index + m[0].length;
      if (!endsSentence(buf, m.index)) continue;
      return end;
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
