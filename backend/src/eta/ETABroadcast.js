// backend/src/eta/ETABroadcast.js
// Broadcasts the computed ETA result to all students watching a specific bus
// via Supabase Realtime channel bus-eta-{busId}.
// Students subscribe to this channel — they NEVER call ORS directly.

let supabase = null;

function init(supabaseClient) {
  supabase = supabaseClient;
}

/**
 * Broadcast ETA payload to all students subscribed to a bus channel.
 * @param {string} busId
 * @param {object} etaPayload
 */
async function broadcast(busId, etaPayload) {
  if (!supabase) return;
  try {
    const channel = supabase.channel(`bus-eta-${busId}`);
    await channel.send({
      type: 'broadcast',
      event: 'eta_update',
      payload: {
        bus_id: busId,
        ...etaPayload,
        broadcast_at: new Date().toISOString(),
      },
    });
    // Clean up the channel after sending (we don't persist subscriptions server-side)
    await supabase.removeChannel(channel);
  } catch (e) {
    console.error(`[ETABroadcast] Failed to broadcast for ${busId}:`, e.message);
  }
}

/**
 * Broadcast an unavailable / stale status to let students update their UI.
 * @param {string} busId
 * @param {string} status - 'UNAVAILABLE' | 'GPS_STALE' | 'STALE'
 * @param {object|null} lastKnown - the last known ETA data if any
 */
async function broadcastStatus(busId, status, lastKnown = null) {
  await broadcast(busId, {
    status,
    eta_seconds: lastKnown?.eta_seconds ?? null,
    eta_minutes: lastKnown?.eta_minutes ?? null,
    distance_meters: lastKnown?.distance_meters ?? null,
    calculated_at: lastKnown?.calculated_at ?? null,
    provider: lastKnown?.provider ?? null,
  });
}

module.exports = { init, broadcast, broadcastStatus };
