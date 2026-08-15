// backend/src/eta/ETAProvider.js
// Abstraction layer for the external ORS routing/ETA API.
// NEVER import this from frontend — API key lives on server only.

const { haversineMeters } = require('./etaUtils');

const ORS_TIMEOUT_MS = 8000;
const ORS_BASE_URL = 'https://api.openrouteservice.org/v2/directions/driving-car';

/**
 * Calculate road-based ETA from origin to destination.
 * Falls back to haversine estimate if ORS key is missing or API fails.
 *
 * @param {number} fromLat
 * @param {number} fromLon
 * @param {number} toLat
 * @param {number} toLon
 * @param {string} busId  - used for logging only
 * @returns {{ road_distance_m, road_distance_km, duration_s, source }}
 */
async function calculateETA(fromLat, fromLon, toLat, toLon, busId) {
  const ORS_KEY = process.env.ORS_API_KEY;

  if (!ORS_KEY || ORS_KEY.startsWith('your_')) {
    console.warn(`[ETAProvider] No ORS key — using haversine fallback for ${busId}`);
    return haversineFallback(fromLat, fromLon, toLat, toLon);
  }

  const url = `${ORS_BASE_URL}?api_key=${ORS_KEY}&start=${fromLon},${fromLat}&end=${toLon},${toLat}`;

  const orsRes = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'BusTrack/1.0' },
    signal: AbortSignal.timeout(ORS_TIMEOUT_MS),
  });

  if (!orsRes.ok) {
    const body = await orsRes.text().catch(() => '');
    throw new Error(`ORS ${orsRes.status}: ${body.slice(0, 200)}`);
  }

  const orsData = await orsRes.json();
  const summary = orsData?.features?.[0]?.properties?.summary;
  const segment = orsData?.features?.[0]?.properties?.segments?.[0];

  const road_distance_m = summary?.distance || segment?.distance || 0;
  const duration_s      = summary?.duration  || segment?.duration  || 0;

  return {
    road_distance_m,
    road_distance_km: (road_distance_m / 1000).toFixed(1),
    duration_s,
    source: 'ors',
  };
}

function haversineFallback(fromLat, fromLon, toLat, toLon) {
  const dist = haversineMeters(fromLat, fromLon, toLat, toLon);
  const road_distance_m = dist * 1.25; // 25% road factor
  return {
    road_distance_m,
    road_distance_km: (road_distance_m / 1000).toFixed(1),
    duration_s: road_distance_m / (30 / 3.6), // assume 30 km/h
    source: 'haversine_fallback',
  };
}

module.exports = { calculateETA, haversineFallback };
