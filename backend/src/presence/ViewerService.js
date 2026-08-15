// backend/src/presence/ViewerService.js
// Manages active viewer sessions using in-memory Maps + heartbeat TTL.
// Viewer sessions expire automatically if heartbeat stops — no reliance on browser unload events.
//
// Data structure:
//   viewers: Map<busId, Map<sessionId, ViewerSession>>
//   ViewerSession: { studentId, lastSeen, expiresAt }

const crypto = require('crypto');
const ETAPollerManager = require('../eta/ETAPollerManager');

const VIEWER_TTL_MS       = parseInt(process.env.VIEWER_TTL_MS       || '60000', 10);
const CLEANUP_INTERVAL_MS = parseInt(process.env.VIEWER_CLEANUP_MS   || '30000', 10);
const MAX_SESSIONS_PER_STUDENT = 5; // prevent abuse

// Map<busId, Map<sessionId, ViewerSession>>
const viewers = new Map();

let cleanupHandle = null;

/**
 * Start the background cleanup interval to evict expired sessions.
 * Call this once on server startup.
 */
function startCleanupInterval() {
  if (cleanupHandle) return;
  cleanupHandle = setInterval(cleanupExpired, CLEANUP_INTERVAL_MS);
  console.log(`[ViewerService] Cleanup interval started (every ${CLEANUP_INTERVAL_MS}ms)`);
}

/**
 * Register a new viewer session for a bus.
 * Returns the sessionId to be stored by the client.
 * @param {string} busId
 * @param {string} studentId
 * @returns {string} sessionId
 */
function registerViewer(busId, studentId) {
  if (!viewers.has(busId)) {
    viewers.set(busId, new Map());
  }

  const busViewers = viewers.get(busId);

  // Enforce per-student session limit (anti-abuse)
  let studentSessions = 0;
  for (const session of busViewers.values()) {
    if (session.studentId === studentId) studentSessions++;
  }
  if (studentSessions >= MAX_SESSIONS_PER_STUDENT) {
    // Evict the oldest session for this student
    for (const [sid, session] of busViewers.entries()) {
      if (session.studentId === studentId) {
        busViewers.delete(sid);
        break;
      }
    }
  }

  const sessionId = crypto.randomUUID();
  const now = Date.now();
  busViewers.set(sessionId, {
    studentId,
    lastSeen: now,
    expiresAt: now + VIEWER_TTL_MS,
  });

  const countBefore = busViewers.size - 1;
  console.log(`[ETA_VIEWER_JOIN] bus=${busId} session=${sessionId.slice(0, 8)} student=${studentId} count=${busViewers.size}`);

  // Notify poller ONLY when this is the FIRST viewer (count was 0)
  if (countBefore === 0) {
    ETAPollerManager.onViewerJoin(busId);
  }

  return sessionId;
}

/**
 * Remove a viewer session (called on best-effort unregister from client).
 * @param {string} busId
 * @param {string} sessionId
 */
function unregisterViewer(busId, sessionId) {
  const busViewers = viewers.get(busId);
  if (!busViewers || !busViewers.has(sessionId)) return;

  busViewers.delete(sessionId);
  console.log(`[ETA_VIEWER_LEAVE] bus=${busId} session=${sessionId.slice(0, 8)} count=${busViewers.size}`);

  if (busViewers.size === 0) {
    ETAPollerManager.onViewerLeave(busId);
  }
}

/**
 * Refresh a viewer's TTL — called by the client heartbeat endpoint.
 * Returns true if the session is valid, false if it has already expired.
 * @param {string} busId
 * @param {string} sessionId
 * @returns {boolean}
 */
function heartbeat(busId, sessionId) {
  const busViewers = viewers.get(busId);
  if (!busViewers) return false;

  const session = busViewers.get(sessionId);
  if (!session) return false;

  const now = Date.now();
  session.lastSeen = now;
  session.expiresAt = now + VIEWER_TTL_MS;
  return true;
}

/**
 * Get current viewer count for a bus.
 * @param {string} busId
 * @returns {number}
 */
function getViewerCount(busId) {
  return viewers.get(busId)?.size || 0;
}

/**
 * Validate that a sessionId belongs to the given student on the given bus.
 * @param {string} busId
 * @param {string} sessionId
 * @param {string} studentId
 * @returns {boolean}
 */
function validateSession(busId, sessionId, studentId) {
  const session = viewers.get(busId)?.get(sessionId);
  if (!session) return false;
  if (session.studentId !== studentId) return false;
  if (Date.now() > session.expiresAt) return false;
  return true;
}

/**
 * Background cleanup: evict expired sessions and notify ETAPollerManager.
 */
function cleanupExpired() {
  const now = Date.now();
  for (const [busId, busViewers] of viewers.entries()) {
    const countBefore = busViewers.size;
    for (const [sessionId, session] of busViewers.entries()) {
      if (now > session.expiresAt) {
        busViewers.delete(sessionId);
        console.log(`[ETA_VIEWER_EXPIRED] bus=${busId} session=${sessionId.slice(0, 8)}`);
      }
    }
    const countAfter = busViewers.size;
    // If all viewers expired, notify the poller
    if (countBefore > 0 && countAfter === 0) {
      console.log(`[ViewerService] All viewers expired for ${busId} — stopping poller`);
      ETAPollerManager.onViewerLeave(busId);
    }
  }
}

/**
 * Get snapshot of all bus viewer counts (for admin monitoring).
 */
function getAllViewerCounts() {
  const result = {};
  for (const [busId, busViewers] of viewers.entries()) {
    result[busId] = busViewers.size;
  }
  return result;
}

module.exports = {
  startCleanupInterval,
  registerViewer,
  unregisterViewer,
  heartbeat,
  getViewerCount,
  validateSession,
  getAllViewerCounts,
};
