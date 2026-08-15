// backend/src/eta/ETAPollerManager.js
// Manages per-bus ETA polling workers.
//
// CORE INVARIANT:
//   ONE bus + ANY number of active viewers = ONE poller + ONE ORS API call per interval
//   ONE bus + ZERO active viewers         = ZERO ORS calls
//
// State machine per bus:
//   INACTIVE -> ACTIVE (first viewer joins)
//   ACTIVE   -> GRACE  (last viewer leaves)
//   GRACE    -> INACTIVE (grace period expires with no new viewers)
//   GRACE    -> ACTIVE   (new viewer joins during grace period)

const ETAProvider  = require('./ETAProvider');
const ETACache     = require('./ETACache');
const ETALock      = require('./ETALock');
const ETABroadcast = require('./ETABroadcast');

const ETA_POLL_INTERVAL_MS = parseInt(process.env.ETA_POLL_INTERVAL_MS || '45000', 10);
const ETA_GRACE_PERIOD_MS  = parseInt(process.env.ETA_GRACE_PERIOD_MS  || '30000', 10);
const ETA_GPS_MAX_AGE_MS   = parseInt(process.env.ETA_GPS_MAX_AGE_MS   || '120000', 10);

// In-memory state: Map<busId, BusPollerState>
const busState = new Map();

// Destination is loaded once and cached in-memory
let cachedDestination = null;

let supabase = null;

function init(supabaseClient) {
  supabase = supabaseClient;
  ETACache.init(supabaseClient);
  ETALock.init(supabaseClient);
  ETABroadcast.init(supabaseClient);
}

/**
 * Update in-memory destination cache (called on startup and when admin changes destination).
 */
function setDestination(dest) {
  cachedDestination = dest;
  console.log(`[ETAPollerManager] Destination updated: ${dest?.name} (${dest?.latitude}, ${dest?.longitude})`);
}

function getDestination() {
  return cachedDestination;
}

function getBusState(busId) {
  if (!busState.has(busId)) {
    busState.set(busId, {
      pollerStatus: 'INACTIVE',
      viewerCount: 0,
      intervalHandle: null,
      graceTimer: null,
      // Session metrics
      apiCallCount: 0,
      cacheHitCount: 0,
      cacheMissCount: 0,
      lastApiCall: null,
      lastEtaMinutes: null,
      lastCacheStatus: 'NO_VIEWERS',
    });
  }
  return busState.get(busId);
}

/**
 * Called by ViewerService when a student starts viewing a bus.
 * @param {string} busId
 */
function onViewerJoin(busId) {
  const state = getBusState(busId);
  state.viewerCount++;

  // Cancel any pending grace period shutdown
  if (state.graceTimer) {
    clearTimeout(state.graceTimer);
    state.graceTimer = null;
    console.log(`[ETA_VIEWER_JOIN] bus=${busId} count=${state.viewerCount} (grace cancelled)`);
  } else {
    console.log(`[ETA_VIEWER_JOIN] bus=${busId} count=${state.viewerCount}`);
  }

  // Start the poller if it's not already running
  if (state.pollerStatus === 'INACTIVE' || state.pollerStatus === 'GRACE') {
    startPoller(busId);
  }
}

/**
 * Called by ViewerService when a student stops viewing a bus.
 * @param {string} busId
 */
function onViewerLeave(busId) {
  const state = getBusState(busId);
  state.viewerCount = Math.max(0, state.viewerCount - 1);
  console.log(`[ETA_VIEWER_LEAVE] bus=${busId} count=${state.viewerCount}`);

  if (state.viewerCount === 0 && state.pollerStatus === 'ACTIVE') {
    enterGracePeriod(busId);
  }
}

function startPoller(busId) {
  const state = getBusState(busId);

  // Prevent duplicate pollers — critical invariant
  if (state.intervalHandle) {
    state.pollerStatus = 'ACTIVE';
    return;
  }

  state.pollerStatus = 'ACTIVE';
  console.log(`[ETA_POLL_START] bus=${busId} interval=${ETA_POLL_INTERVAL_MS}ms`);

  // Trigger an immediate first poll so students get ETA right away
  pollBus(busId).catch((e) => console.error(`[ETAPollerManager] First poll error ${busId}:`, e.message));

  state.intervalHandle = setInterval(() => {
    pollBus(busId).catch((e) => console.error(`[ETAPollerManager] Poll error ${busId}:`, e.message));
  }, ETA_POLL_INTERVAL_MS);
}

function enterGracePeriod(busId) {
  const state = getBusState(busId);
  state.pollerStatus = 'GRACE';
  console.log(`[ETA_POLL_GRACE] bus=${busId} grace=${ETA_GRACE_PERIOD_MS}ms`);

  state.graceTimer = setTimeout(() => {
    // Recheck — a viewer might have joined during grace
    const currentState = getBusState(busId);
    if (currentState.viewerCount === 0) {
      stopPoller(busId);
    }
  }, ETA_GRACE_PERIOD_MS);
}

function stopPoller(busId) {
  const state = getBusState(busId);
  if (state.intervalHandle) {
    clearInterval(state.intervalHandle);
    state.intervalHandle = null;
  }
  if (state.graceTimer) {
    clearTimeout(state.graceTimer);
    state.graceTimer = null;
  }
  state.pollerStatus = 'INACTIVE';
  state.lastCacheStatus = 'NO_VIEWERS';
  console.log(`[ETA_POLL_STOP] bus=${busId}`);
}

/**
 * Core poll cycle for a single bus.
 * Guarantees at most ONE ORS API call regardless of viewer count.
 */
async function pollBus(busId) {
  if (!supabase) return;

  // 1. Get latest bus GPS
  const { data: locRows, error: locErr } = await supabase
    .from('current_bus_locations')
    .select('latitude, longitude, speed_kmh, updated_at')
    .eq('bus_id', busId)
    .limit(1);

  if (locErr || !locRows || locRows.length === 0) {
    console.warn(`[ETAPollerManager] No GPS data for ${busId}`);
    const stale = await ETACache.getStale(busId);
    await ETABroadcast.broadcastStatus(busId, 'UNAVAILABLE', stale);
    return;
  }

  const loc = locRows[0];
  const gpsAge = Date.now() - new Date(loc.updated_at).getTime();

  // 2. Validate GPS freshness
  if (gpsAge > ETA_GPS_MAX_AGE_MS) {
    console.warn(`[ETAPollerManager] GPS stale for ${busId} (${Math.round(gpsAge / 1000)}s old)`);
    const stale = await ETACache.getStale(busId);
    await ETABroadcast.broadcastStatus(busId, 'GPS_STALE', stale);
    return;
  }

  // 3. Get destination
  const dest = cachedDestination;
  if (!dest || !dest.latitude || !dest.longitude) {
    // No destination set — nothing to compute
    return;
  }

  const state = getBusState(busId);

  // 4. Check cache (FRESH check)
  const cached = await ETACache.get(busId);
  if (cached) {
    state.cacheHitCount++;
    state.lastCacheStatus = 'FRESH';
    state.lastEtaMinutes = cached.eta_minutes;
    console.log(`[ETA_CACHE_HIT] bus=${busId} eta=${cached.eta_minutes}min`);
    await ETABroadcast.broadcast(busId, {
      eta_seconds: cached.eta_seconds,
      eta_minutes: cached.eta_minutes,
      distance_meters: cached.distance_meters,
      status: 'FRESH',
      provider: cached.provider,
      calculated_at: cached.calculated_at,
    });
    return;
  }

  // 5. Cache miss — attempt to acquire distributed lock
  state.cacheMissCount++;
  state.lastCacheStatus = 'MISS';
  console.log(`[ETA_CACHE_MISS] bus=${busId}`);

  const lockAcquired = await ETALock.acquire(busId);

  if (!lockAcquired) {
    // Another instance is already computing — wait and read the result
    console.log(`[ETA_LOCK_SKIPPED] bus=${busId} — waiting for peer to finish`);
    await new Promise((r) => setTimeout(r, 3000));
    const freshResult = await ETACache.get(busId);
    if (freshResult) {
      await ETABroadcast.broadcast(busId, {
        eta_seconds: freshResult.eta_seconds,
        eta_minutes: freshResult.eta_minutes,
        distance_meters: freshResult.distance_meters,
        status: 'FRESH',
        provider: freshResult.provider,
        calculated_at: freshResult.calculated_at,
      });
    }
    return;
  }

  // 6. Double-check cache after acquiring lock (prevents stampede)
  const doubleCheck = await ETACache.get(busId);
  if (doubleCheck) {
    await ETALock.release(busId);
    state.cacheHitCount++;
    await ETABroadcast.broadcast(busId, {
      eta_seconds: doubleCheck.eta_seconds,
      eta_minutes: doubleCheck.eta_minutes,
      distance_meters: doubleCheck.distance_meters,
      status: 'FRESH',
      provider: doubleCheck.provider,
      calculated_at: doubleCheck.calculated_at,
    });
    return;
  }

  // 7. Call external ETA API (ONE call per bus per interval — guaranteed by lock)
  console.log(`[ETA_LOCK_ACQUIRED] bus=${busId}`);
  console.log(`[ETA_API_REQUEST] bus=${busId} from=(${loc.latitude},${loc.longitude}) to=(${dest.latitude},${dest.longitude})`);

  const callStart = Date.now();
  let routeResult = null;

  try {
    routeResult = await ETAProvider.calculateETA(
      loc.latitude, loc.longitude,
      dest.latitude, dest.longitude,
      busId
    );
    state.apiCallCount++;
    state.lastApiCall = new Date().toISOString();
    console.log(`[ETA_API_SUCCESS] bus=${busId} source=${routeResult.source} latency=${Date.now() - callStart}ms`);
  } catch (apiErr) {
    console.error(`[ETA_API_FAILURE] bus=${busId}:`, apiErr.message);
    await ETALock.release(busId);
    // Mark cache as stale and broadcast last known
    await ETACache.markStale(busId);
    const lastKnown = await ETACache.getStale(busId);
    await ETABroadcast.broadcastStatus(busId, 'STALE', lastKnown);
    return;
  }

  // 8. Compute ETA minutes from route distance + current speed
  const speedKmh = Math.max(loc.speed_kmh || 15, 5);
  const etaSeconds = routeResult.duration_s > 0
    ? Math.round(routeResult.duration_s * (30 / speedKmh)) // scale ORS 30km/h assumption
    : Math.round((routeResult.road_distance_m / (speedKmh / 3.6)));
  const etaMinutes = Math.max(1, Math.round(etaSeconds / 60));

  const etaData = {
    eta_seconds: etaSeconds,
    eta_minutes: etaMinutes,
    distance_meters: routeResult.road_distance_m,
    origin_lat: loc.latitude,
    origin_lon: loc.longitude,
    destination_lat: dest.latitude,
    destination_lon: dest.longitude,
    provider: routeResult.source,
    status: 'FRESH',
  };

  // 9. Store in cache
  await ETACache.set(busId, etaData);
  state.lastEtaMinutes = etaMinutes;

  // 10. Release lock before broadcasting (reduces lock hold time)
  await ETALock.release(busId);
  console.log(`[ETA_LOCK_RELEASED] bus=${busId}`);

  // 11. Broadcast to ALL students on this bus via Supabase Realtime
  await ETABroadcast.broadcast(busId, {
    eta_seconds: etaSeconds,
    eta_minutes: etaMinutes,
    distance_meters: routeResult.road_distance_m,
    status: 'FRESH',
    provider: routeResult.source,
    calculated_at: new Date().toISOString(),
  });

  console.log(`[ETA_BROADCAST] bus=${busId} eta=${etaMinutes}min viewers=${state.viewerCount}`);
}

/**
 * Get monitoring data for all buses (for admin endpoint).
 */
function getMonitoringData() {
  const buses = [];
  for (const [busId, state] of busState.entries()) {
    const callsAvoided = Math.max(0, (state.viewerCount - 1) * state.apiCallCount);
    buses.push({
      bus_id: busId,
      viewer_count: state.viewerCount,
      poller_status: state.pollerStatus,
      last_api_call: state.lastApiCall,
      last_eta_minutes: state.lastEtaMinutes,
      cache_status: state.lastCacheStatus,
      api_call_count_session: state.apiCallCount,
      cache_hit_count_session: state.cacheHitCount,
      cache_miss_count_session: state.cacheMissCount,
      estimated_calls_avoided: callsAvoided,
    });
  }
  return buses;
}

module.exports = { init, onViewerJoin, onViewerLeave, setDestination, getDestination, getMonitoringData, getBusState };
