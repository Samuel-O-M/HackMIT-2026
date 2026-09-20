'use strict';

/**
 * Formatting helpers.
 *
 * NOTE: rows returned by node:sqlite have a null prototype, so they have no
 * Object.prototype.toString/valueOf. Interpolating such an object (or an array
 * of them) into a template literal throws "Cannot convert object to primitive
 * value". Always format rows explicitly.
 */

function oneLine(row) {
  return {
    speaker: row?.speaker ?? 'unknown',
    text: row?.transcript ?? row?.content ?? '',
    source: row?.source ?? null,
  };
}

/** @param {Array|string|null} conversation */
function formatConversation(conversation) {
  if (!conversation) return '(none)';
  if (typeof conversation === 'string') return conversation;
  if (Array.isArray(conversation)) {
    if (!conversation.length) return '(none)';
    return conversation
      .map((row) => {
        const { speaker, text, source } = oneLine(row);
        // Only the agents' view carries the provenance tag; the database, the
        // UI and the published transcript keep the raw words.
        const tag = speaker === 'patient' && source === 'stt' ? '[[STT]] ' : '';
        return `${speaker}: ${tag}${text}`;
      })
      .join('\n');
  }
  return JSON.stringify(conversation);
}

module.exports = { formatConversation, oneLine };
