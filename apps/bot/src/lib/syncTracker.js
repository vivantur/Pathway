// ── Supabase sync tracker ────────────────────────────────────────────────────
// Tracks in-flight Supabase write promises (so SIGTERM can drain them before
// shutdown) and counts consecutive sync failures (so we can warn the GM in
// Discord when the database is unreachable).
//
// State modules call _trackSync() to register a write; the bootstrap layer
// calls drainSupabaseSyncs() during graceful shutdown.
//
// Extracted from lib/storage.js in Phase 1 to break circular deps: every
// state/*.js module needs the tracker, and storage.js needs state/*.js for
// its barrel re-exports.

// Track consecutive sync failures so the GM can be warned in-Discord.
let _syncConsecutiveFailures = 0;
const SYNC_DEGRADED_THRESHOLD = 3;

// In-flight Supabase sync promises — drained on SIGTERM so Railway rolling
// deploys don't kill the process before companion/character state is flushed.
const _inflightSyncs = new Set();

function _trackSync(p) {
  const tracked = Promise.resolve(p).finally(() => _inflightSyncs.delete(tracked));
  _inflightSyncs.add(tracked);
  return tracked;
}

async function drainSupabaseSyncs() {
  if (_inflightSyncs.size === 0) return;
  console.log(`[Supabase] draining ${_inflightSyncs.size} in-flight sync(s) before shutdown…`);
  await Promise.allSettled([..._inflightSyncs]);
}

function _recordSyncSuccess() { _syncConsecutiveFailures = 0; }
function _recordSyncFailure() { _syncConsecutiveFailures++; }

// Returns true if Supabase syncs have been failing repeatedly.
// Call this at the start/end of an encounter to warn the GM.
function isSyncDegraded() { return _syncConsecutiveFailures >= SYNC_DEGRADED_THRESHOLD; }

module.exports = {
  _trackSync,
  drainSupabaseSyncs,
  _recordSyncSuccess,
  _recordSyncFailure,
  isSyncDegraded,
  SYNC_DEGRADED_THRESHOLD,
};
