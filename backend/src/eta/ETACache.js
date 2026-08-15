// backend/src/eta/ETACache.js
// Manages the bus_eta_cache PostgreSQL table via Supabase service role.
// Provides durable ETA cache that survives backend restarts.

const ETA_CACHE_TTL_MS = parseInt(process.env.ETA_CACHE_TTL_MS || '45000', 10);

let supabase = null;

function init(supabaseClient) {
  supabase = supabaseClient;
}

/**
 * Get cached ETA for a bus. Returns null if missing or expired.
 * @param {string} busId
 * @returns {object|null}
 */
async function get(busId) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('bus_eta_cache')
      .select('*')
      .eq('bus_id', busId)
      .single();

    if (error || !data) return null;

    // Check expiry
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return null; // expired
    }
    return data;
  } catch (e) {
    console.error('[ETACache] get error:', e.message);
    return null;
  }
}

/**
 * Get cached ETA even if expired (for stale fallback).
 * @param {string} busId
 * @returns {object|null}
 */
async function getStale(busId) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('bus_eta_cache')
      .select('*')
      .eq('bus_id', busId)
      .single();
    return error ? null : data;
  } catch (e) {
    return null;
  }
}

/**
 * Store ETA result for a bus.
 * @param {string} busId
 * @param {object} etaData  - { eta_seconds, eta_minutes, distance_meters, origin_lat, origin_lon, destination_lat, destination_lon, provider, status }
 */
async function set(busId, etaData) {
  if (!supabase) return;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ETA_CACHE_TTL_MS);

  try {
    const { error } = await supabase
      .from('bus_eta_cache')
      .upsert({
        bus_id: busId,
        ...etaData,
        status: etaData.status || 'FRESH',
        calculated_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        updated_at: now.toISOString(),
      }, { onConflict: 'bus_id' });

    if (error) {
      console.error('[ETACache] set error:', error.message);
    }
  } catch (e) {
    console.error('[ETACache] set exception:', e.message);
  }
}

/**
 * Mark a bus's cache as stale (e.g., after ORS failure).
 * @param {string} busId
 */
async function markStale(busId) {
  if (!supabase) return;
  try {
    await supabase
      .from('bus_eta_cache')
      .update({ status: 'STALE', updated_at: new Date().toISOString() })
      .eq('bus_id', busId);
  } catch (e) {
    console.error('[ETACache] markStale error:', e.message);
  }
}

/**
 * Invalidate all bus ETA caches (called when admin changes destination).
 */
async function invalidateAll() {
  if (!supabase) return;
  try {
    const past = new Date(0).toISOString();
    const { error } = await supabase
      .from('bus_eta_cache')
      .update({ expires_at: past, status: 'STALE', updated_at: new Date().toISOString() })
      .neq('bus_id', ''); // all rows
    if (error) console.error('[ETACache] invalidateAll error:', error.message);
    else console.log('[ETACache] All caches invalidated (destination changed)');
  } catch (e) {
    console.error('[ETACache] invalidateAll exception:', e.message);
  }
}

module.exports = { init, get, getStale, set, markStale, invalidateAll };
