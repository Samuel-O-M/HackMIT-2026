'use strict';

/**
 * One date parser, shared.
 *
 * Identity verification and transcript redaction both have to understand a
 * date of birth said out loud — "march fifteenth", "3/15/54", "the 22nd of
 * October". They used to parse it separately, and the two disagreed: a date
 * verification accepted could still slip past redaction and reach the
 * clinical record. Same parser for both, so that cannot drift again.
 */

const NUM_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
  thirtieth: 30, 'thirty-first': 31, thirtyfirst: 31,
};
const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function wordsToNumber(words) {
  let total = 0;
  let any = false;
  for (const w of words) {
    const v = NUM_WORDS[w];
    if (v != null) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

function iso(y, m, d) {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Parse a date of birth from digits or spoken words into YYYY-MM-DD. */
function normalizeDob(raw) {
  if (!raw) return null;
  const s = String(raw)
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    // "the fifteenth" and "march 15th" are how people say a date out loud, and
    // the suffix made the whole thing unparseable — a correct date of birth
    // failed verification. Strip it from digits only; word forms are handled below.
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;

  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = s.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (m) {
    let a = +m[1];
    let b = +m[2];
    let y = +m[3];
    if (y < 100) y += y < 30 ? 2000 : 1900;
    let mo = a;
    let d = b;
    if (mo > 12 && b <= 12) {
      mo = b;
      d = a;
    }
    return iso(y, mo, d);
  }

  // Only now split hyphens between letters: "twenty-second" is two words, but
  // the numeric forms above still needed "3-15-1954" intact.
  const tokens = s.replace(/([a-z])-([a-z])/g, '$1 $2').split(' ');
  const monthIdx = tokens.findIndex((t) => MONTHS[t] != null);
  const month = monthIdx >= 0 ? MONTHS[tokens[monthIdx]] : null;

  let yStart = -1;
  let yEnd = -1;
  const i4 = tokens.findIndex((t) => /^(1[89]\d{2}|20\d{2})$/.test(t));
  const i19 = tokens.indexOf('nineteen');
  const i20 = tokens.indexOf('twenty');
  if (i4 !== -1) {
    yStart = i4;
    yEnd = i4;
  } else if (i19 !== -1) {
    yStart = i19;
    yEnd = i19;
    while (yEnd + 1 < tokens.length && NUM_WORDS[tokens[yEnd + 1]] != null) yEnd++;
  } else if (i20 !== -1) {
    yStart = i20;
    yEnd = i20;
    while (yEnd + 1 < tokens.length && NUM_WORDS[tokens[yEnd + 1]] != null) yEnd++;
  }

  let year = null;
  if (yStart >= 0) {
    if (i4 === yStart) {
      year = +tokens[yStart];
    } else {
      const rest = tokens.slice(yStart + 1, yEnd + 1);
      year = (tokens[yStart] === 'nineteen' ? 1900 : 2000) + (wordsToNumber(rest) || 0);
    }
  }

  let day = null;
  for (let i = 0; i < tokens.length; i++) {
    if (yStart >= 0 && i >= yStart && i <= yEnd) continue;
    if (/^\d{1,2}$/.test(tokens[i])) {
      const n = +tokens[i];
      if (n >= 1 && n <= 31) {
        day = n;
        break;
      }
    }
  }
  if (day == null) {
    const dayWords = tokens.filter((t, i) => {
      if (yStart >= 0 && i >= yStart && i <= yEnd) return false;
      if (i === monthIdx) return false;
      return NUM_WORDS[t] != null;
    });
    day = wordsToNumber(dayWords);
  }

  return month && day && year ? iso(year, month, day) : null;
}

/**
 * Every span of `text` that states `isoTarget`, whatever form it is said in.
 *
 * Structural rather than a list of spellings: candidate spans are parsed and
 * kept only if they normalise to the target date. That catches the forms a
 * fixed list misses — a mis-said ordinal, an abbreviated month, a two-digit
 * year — which is exactly how one got through before.
 */
function findDateSpans(text, isoTarget) {
  if (!text || !isoTarget) return [];
  const MONTH_RE = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
  const patterns = [
    new RegExp(`\\b\\d{4}-\\d{1,2}-\\d{1,2}\\b`, 'gi'),
    new RegExp(`\\b\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}\\b`, 'gi'),
    new RegExp(`\\b${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4}\\b`, 'gi'),
    new RegExp(`\\b(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?,?\\s+\\d{2,4}\\b`, 'gi'),
    // Spoken in words: "the fifteenth of march nineteen fifty four".
    new RegExp(`\\b(?:the\\s+)?[a-z-]+\\s+(?:of\\s+)?${MONTH_RE}\\.?,?\\s+(?:nineteen|twenty)[a-z\\s-]{0,24}\\b`, 'gi'),
    new RegExp(`\\b${MONTH_RE}\\.?\\s+[a-z-]+,?\\s+(?:nineteen|twenty)[a-z\\s-]{0,24}\\b`, 'gi'),
  ];
  const spans = [];
  for (const re of patterns) {
    for (const m of String(text).matchAll(re)) {
      if (normalizeDob(m[0]) === isoTarget) spans.push(m[0]);
    }
  }
  // Longest first, so a wider span is replaced before one nested inside it.
  return [...new Set(spans)].sort((a, b) => b.length - a.length);
}

module.exports = { normalizeDob, findDateSpans, MONTHS, iso };
