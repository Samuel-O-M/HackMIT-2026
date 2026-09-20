'use strict';

/**
 * A per-session "wrap up and hang up" signal.
 *
 * Raised by the `end_call` tool (either agent) and consumed by the orchestrator
 * at the end of a turn. In memory on purpose: it lives and dies with the call,
 * and nothing about the call depends on it surviving a restart.
 */
const pending = new Set();

module.exports = {
  request(sessionId) {
    if (sessionId) pending.add(sessionId);
  },
  /** Read and clear. */
  take(sessionId) {
    return pending.delete(sessionId);
  },
  peek(sessionId) {
    return pending.has(sessionId);
  },
};
