// backend/src/eta/etaUtils.js
// Shared utility functions for the ETA subsystem.

/**
 * Haversine distance in meters between two GPS coordinates.
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Generate a consistent integer hash for a string (for pg advisory locks).
 * Uses a simple djb2-style hash mapped to a 32-bit signed integer range.
 */
function stringToLockId(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0; // force 32-bit int
  }
  return hash;
}

module.exports = { haversineMeters, stringToLockId };
