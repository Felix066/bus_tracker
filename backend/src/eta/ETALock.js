// backend/src/eta/ETALock.js
// Distributed locking via PostgreSQL Advisory Locks (via Supabase RPC).
// Works across multiple backend instances sharing the same Supabase database.
// Locks are connection-scoped: they auto-release on disconnect or server restart.
// There is NEVER a permanently stuck lock.

const { stringToLockId } = require('./etaUtils');

let supabase = null;

function init(supabaseClient) {
  supabase = supabaseClient;
}

/**
 * Try to acquire a non-blocking advisory lock for a bus.
 * Returns true if lock was acquired, false if another process holds it.
 * @param {string} busId
 * @returns {Promise<boolean>}
 */
async function acquire(busId) {
  if (!supabase) return true; // assume acquired if no DB
  try {
    const lockId = stringToLockId(`eta:${busId}`);
    const { data, error } = await supabase.rpc('pg_try_advisory_lock', { lock_id: lockId });
    if (error) {
      // If the RPC doesn't exist yet, fall back gracefully (single-instance safe)
      console.warn('[ETALock] pg_try_advisory_lock RPC not available, assuming single-instance:', error.message);
      return true;
    }
    return data === true;
  } catch (e) {
    console.warn('[ETALock] acquire error (treating as acquired):', e.message);
    return true;
  }
}

/**
 * Release the advisory lock for a bus.
 * @param {string} busId
 */
async function release(busId) {
  if (!supabase) return;
  try {
    const lockId = stringToLockId(`eta:${busId}`);
    await supabase.rpc('pg_advisory_unlock', { lock_id: lockId });
  } catch (e) {
    // Non-fatal — lock will auto-release on connection close
    console.warn('[ETALock] release error (non-fatal):', e.message);
  }
}

module.exports = { init, acquire, release };
