// js/road-eta.js — Road-Based ETA Engine (Shared Architecture)
//
// NEW ARCHITECTURE: ETA is computed ONCE on the backend per bus and broadcast
// via Supabase Realtime to ALL students watching that bus.
//
// This file:
//   - Renders received ETA data into the UI (applySharedETA)
//   - Provides a local haversine fallback (applyFallback) for when no broadcast arrives
//   - Handles bus status, speed smoothing, and student proximity (all local, no API cost)
//
// REMOVED: fetchRoadRoute() — students NO LONGER call /api/route/eta directly.
// REMOVED: per-student ETA cache state (lastRouteResult, lastRouteFetchTime, etc.)

window.RoadETA = (function () {

  // =========================================================================
  // KALMAN FILTER — Smooth noisy GPS speed readings (local, no API cost)
  // =========================================================================
  const speedKalman = {
    q: 0.01, r: 1.0, p: 1.0, x: null,
    update(m) {
      if (this.x === null) { this.x = m; return m; }
      this.p += this.q;
      const K = this.p / (this.p + this.r);
      this.x += K * (m - this.x);
      this.p = (1 - K) * this.p;
      return this.x;
    }
  };

  // =========================================================================
  // STATE
  // =========================================================================
  let destination = null;           // { name, latitude, longitude }
  let lastSharedETA = null;         // Last payload received from Realtime broadcast
  let lastSharedETATime = 0;        // Timestamp when lastSharedETA was received
  let lastBusStatus = 'Offline';

  const STALE_FALLBACK_MS = 90000; // If no Realtime ETA in 90s, switch to haversine fallback

  // Average speed tracking
  const speedHistory = [];
  const SPEED_WINDOW = 10;

  // Inside-bus detection
  let insideBusStartTime = null;
  let insideBusConfirmed = false;

  // =========================================================================
  // HAVERSINE — Used for student proximity detection ONLY (free, local)
  // =========================================================================
  function haversineDist(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // =========================================================================
  // LOAD DESTINATION — fetch once from backend, then cache in memory
  // =========================================================================
  async function loadDestination() {
    try {
      const res = await fetch(`${BACKEND_URL}/api/public/destination`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.destination) {
          destination = data.destination;
          const el = document.getElementById('dest-name-display');
          if (el) el.textContent = destination.name;
        }
      }
    } catch (e) {
      console.warn('[RoadETA] Could not load destination:', e);
    }
    return destination;
  }

  // =========================================================================
  // AVERAGE SPEED — rolling window
  // =========================================================================
  function updateAverageSpeed(speedKmh) {
    if (speedKmh !== null && speedKmh >= 0) {
      speedHistory.push(speedKmh);
      if (speedHistory.length > SPEED_WINDOW) speedHistory.shift();
    }
    if (speedHistory.length === 0) return 0;
    return speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length;
  }

  // =========================================================================
  // REAL-WORLD BUS STATUS ENGINE
  // =========================================================================
  // Production-grade status detection with:
  //   - Per-bus state isolation (supports multiple buses)
  //   - Median-filtered speed smoothing (removes GPS jitter)
  //   - Duration-based state confirmation (prevents flicker)
  //   - Traffic detection via speed ratios (not raw thresholds)
  //   - GPS quality awareness
  //   - Bus stop proximity detection
  //   - Route deviation detection (when data available)
  //   - Custom SVG status icons
  // =========================================================================

  const busStatusEngines = new Map();

  function getBusStatusResult(busId, {
    speedKmh = 0,
    expectedSpeedKmh = null,
    speedLimitKmh = null,
    gpsAccuracyM = null,
    distanceFromRouteM = null,
    distanceToNextStopM = null,
    timestamp = Date.now(),
    isNearBusStop = false,
    headingDifferenceDeg = null
  }) {

    // ── Create independent state for every bus ──────────────────────────
    if (!busStatusEngines.has(busId)) {
      busStatusEngines.set(busId, {
        samples: [],
        stoppedSince: null,
        slowSince: null,
        heavySince: null,
        offRouteSince: null,
        overspeedSince: null,
        lastValidTimestamp: null,
        lastStatus: null
      });
    }

    const state = busStatusEngines.get(busId);
    const now = timestamp;

    // ── Basic validation ────────────────────────────────────────────────
    const validSpeed = Number.isFinite(speedKmh) && speedKmh >= 0 && speedKmh <= 180;
    const speed = validSpeed ? speedKmh : 0;

    // ── GPS quality checks ──────────────────────────────────────────────
    const gpsIsPoor     = gpsAccuracyM != null && gpsAccuracyM > 50;
    const gpsIsVeryPoor = gpsAccuracyM != null && gpsAccuracyM > 100;
    const gpsStale      = state.lastValidTimestamp != null && (now - state.lastValidTimestamp > 15000);

    if (validSpeed && !gpsIsVeryPoor) {
      state.lastValidTimestamp = now;
    }

    // ── Speed smoothing (median filter over ~30s window) ────────────────
    // GPS speed can jump wildly: 0 → 32 → 4 → 28 → 0
    // Median filtering removes most of these spikes.
    state.samples.push({ speed, timestamp: now });
    state.samples = state.samples.filter(s => now - s.timestamp <= 30000);

    const sortedSpeeds = state.samples.map(s => s.speed).sort((a, b) => a - b);
    let filteredSpeed = speed;
    if (sortedSpeeds.length > 0) {
      const mid = Math.floor(sortedSpeeds.length / 2);
      filteredSpeed = sortedSpeeds.length % 2 === 0
        ? (sortedSpeeds[mid - 1] + sortedSpeeds[mid]) / 2
        : sortedSpeeds[mid];
    }

    // ── Calculate expected road speed ───────────────────────────────────
    // Ideally from: road/segment data, historical bus speed, or traffic routing.
    // If unavailable, use speed limit with conservative factor.
    let expectedSpeed = expectedSpeedKmh;
    if (expectedSpeed == null && speedLimitKmh != null && speedLimitKmh > 0) {
      expectedSpeed = speedLimitKmh * 0.70;
    }
    if (expectedSpeed != null) {
      expectedSpeed = Math.max(12, expectedSpeed);
    }

    // ── Stationary detection ────────────────────────────────────────────
    const effectivelyStopped = filteredSpeed < 2.5;

    if (effectivelyStopped) {
      if (state.stoppedSince == null) state.stoppedSince = now;
    } else {
      state.stoppedSince = null;
    }

    const stoppedDuration = state.stoppedSince != null ? (now - state.stoppedSince) / 1000 : 0;

    // ── Bus stop detection ──────────────────────────────────────────────
    const atBusStop = isNearBusStop && distanceToNextStopM != null
      && distanceToNextStopM <= 40 && stoppedDuration >= 6;

    // ── Route deviation ─────────────────────────────────────────────────
    // GPS can temporarily jump 50-100m, so require sustained deviation.
    const offRoute = distanceFromRouteM != null && distanceFromRouteM > 60;
    if (offRoute) {
      if (state.offRouteSince == null) state.offRouteSince = now;
    } else {
      state.offRouteSince = null;
    }
    const offRouteDuration = state.offRouteSince != null ? (now - state.offRouteSince) / 1000 : 0;

    // ── Traffic detection via speed ratio ────────────────────────────────
    // Compare current vs expected speed instead of raw thresholds.
    // Ratio 0.50 = 50% of normal = significantly slow.
    let speedRatio = null;
    if (expectedSpeed != null && expectedSpeed > 0) {
      speedRatio = filteredSpeed / expectedSpeed;
    }

    const significantlySlow = expectedSpeed != null && expectedSpeed >= 20
      && speedRatio < 0.60 && !atBusStop;
    const heavyTraffic = expectedSpeed != null && expectedSpeed >= 20
      && speedRatio < 0.35 && !atBusStop;

    // Require congestion to persist (prevents flicker from brief slowdowns)
    if (significantlySlow) {
      if (state.slowSince == null) state.slowSince = now;
    } else {
      state.slowSince = null;
    }
    if (heavyTraffic) {
      if (state.heavySince == null) state.heavySince = now;
    } else {
      state.heavySince = null;
    }

    const slowDuration  = state.slowSince  != null ? (now - state.slowSince)  / 1000 : 0;
    const heavyDuration = state.heavySince != null ? (now - state.heavySince) / 1000 : 0;

    // ── Stopped in traffic (stationary, NOT at a bus stop) ──────────────
    const stoppedInTraffic = !atBusStop && effectivelyStopped && stoppedDuration >= 30;

    // ── Speeding detection ──────────────────────────────────────────────
    const speeding = speedLimitKmh != null && speedLimitKmh > 0
      && filteredSpeed > speedLimitKmh + 10;
    if (speeding) {
      if (state.overspeedSince == null) state.overspeedSince = now;
    } else {
      state.overspeedSince = null;
    }
    const overspeedDuration = state.overspeedSince != null ? (now - state.overspeedSince) / 1000 : 0;
    const confirmedSpeeding = speeding && overspeedDuration >= 10;

    // ── Heading check ───────────────────────────────────────────────────
    const wrongDirection = headingDifferenceDeg != null
      && headingDifferenceDeg > 120 && filteredSpeed > 8;

    // ── FINAL STATUS DECISION (priority order) ──────────────────────────
    let result;

    // 1. GPS unreliable
    if (gpsIsVeryPoor || gpsStale) {
      result = {
        label: 'GPS Unreliable', color: '#64748b', code: 'GPS_UNRELIABLE', confidence: 0.25,
        uiIcon: `<svg viewBox="0 0 64 64" width="40" height="40"><circle cx="32" cy="32" r="23" fill="none" stroke="#64748b" stroke-width="5"/><path d="M22 32h20" stroke="#64748b" stroke-width="5" stroke-linecap="round"/></svg>`
      };
    }
    // 2. Off route (sustained)
    else if (offRouteDuration >= 15) {
      result = {
        label: 'Off Route', color: '#dc2626', code: 'OFF_ROUTE', confidence: 0.90,
        uiIcon: `<svg viewBox="0 0 64 64" width="40" height="40"><path d="M18 10 C18 10 43 18 46 28 C49 38 25 41 25 54" fill="none" stroke="#dc2626" stroke-width="6" stroke-linecap="round"/><circle cx="18" cy="10" r="5" fill="#dc2626"/><circle cx="25" cy="54" r="5" fill="#dc2626"/></svg>`
      };
    }
    // 3. Wrong direction
    else if (wrongDirection) {
      result = {
        label: 'Wrong Direction', color: '#dc2626', code: 'WRONG_DIRECTION', confidence: 0.80,
        uiIcon: `<svg viewBox="0 0 64 64" width="40" height="40"><path d="M32 8v48M20 20l12-12 12 12" fill="none" stroke="#dc2626" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      };
    }
    // 4. At a bus stop
    else if (atBusStop) {
      result = {
        label: 'At Bus Stop', color: '#f59e0b', code: 'AT_STOP', confidence: 0.95,
        uiIcon: `<svg viewBox="0 0 64 64" width="40" height="40"><rect x="18" y="10" width="28" height="44" rx="5" fill="none" stroke="#f59e0b" stroke-width="5"/><path d="M24 20h16M24 30h16M24 40h16" stroke="#f59e0b" stroke-width="4" stroke-linecap="round"/></svg>`
      };
    }
    // 5. Stopped in traffic (30s+ stop, not at bus stop)
    else if (stoppedInTraffic) {
      result = {
        label: 'Stopped in Traffic', color: '#ef4444', code: 'STOPPED_TRAFFIC', confidence: 0.90,
        uiIcon: `<svg viewBox="0 0 64 64" width="40" height="40"><circle cx="32" cy="32" r="25" fill="none" stroke="#ef4444" stroke-width="5"/><rect x="20" y="20" width="9" height="24" rx="2" fill="#ef4444"/><rect x="35" y="20" width="9" height="24" rx="2" fill="#ef4444"/></svg>`
      };
    }
    // 6. Heavy traffic (sustained, ratio-based)
    else if (heavyDuration >= 30) {
      result = {
        label: 'Heavy Traffic', color: '#f97316', code: 'HEAVY_TRAFFIC',
        confidence: expectedSpeed != null ? 0.88 : 0.55,
        uiIcon: `<svg viewBox="0 0 64 64" width="40" height="40"><path d="M13 45h38" stroke="#f97316" stroke-width="6" stroke-linecap="round"/><path d="M18 32h28" stroke="#f97316" stroke-width="6" stroke-linecap="round"/><path d="M25 19h14" stroke="#f97316" stroke-width="6" stroke-linecap="round"/></svg>`
      };
    }
    // 7. Slow traffic (sustained, ratio-based)
    else if (slowDuration >= 45) {
      result = {
        label: 'Slow Traffic', color: '#f59e0b', code: 'SLOW_TRAFFIC',
        confidence: expectedSpeed != null ? 0.84 : 0.50,
        uiIcon: `<svg viewBox="0 0 64 64" width="40" height="40"><circle cx="20" cy="46" r="5" fill="#f59e0b"/><circle cx="32" cy="46" r="5" fill="#f59e0b"/><circle cx="44" cy="46" r="5" fill="#f59e0b"/><path d="M16 25h32" stroke="#f59e0b" stroke-width="6" stroke-linecap="round"/></svg>`
      };
    }
    // 8. Confirmed speeding
    else if (confirmedSpeeding) {
      result = {
        label: 'Above Speed Limit', color: '#dc2626', code: 'SPEEDING', confidence: 0.90,
        uiIcon: `<svg viewBox="0 0 64 64" width="40" height="40"><circle cx="32" cy="32" r="25" fill="none" stroke="#dc2626" stroke-width="5"/><path d="M32 18v18" stroke="#dc2626" stroke-width="6" stroke-linecap="round"/><circle cx="32" cy="46" r="3" fill="#dc2626"/></svg>`
      };
    }
    // 9. Normal movement
    else if (filteredSpeed >= 2.5) {
      result = {
        label: 'Moving', color: '#10b981', code: 'MOVING',
        confidence: gpsIsPoor ? 0.65 : 0.92,
        uiIcon: `<svg viewBox="0 0 64 64" width="40" height="40"><path d="M14 32h36" stroke="#10b981" stroke-width="6" stroke-linecap="round"/><path d="M38 20l12 12-12 12" fill="none" stroke="#10b981" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      };
    }
    // 10. Temporarily stopped (< 30s, uncertain)
    else {
      result = {
        label: 'Temporarily Stopped', color: '#f59e0b', code: 'TEMP_STOP', confidence: 0.70,
        uiIcon: `<svg viewBox="0 0 64 64" width="40" height="40"><circle cx="32" cy="32" r="25" fill="none" stroke="#f59e0b" stroke-width="5"/><rect x="23" y="21" width="7" height="22" rx="2" fill="#f59e0b"/><rect x="34" y="21" width="7" height="22" rx="2" fill="#f59e0b"/></svg>`
      };
    }

    // ── Diagnostics ─────────────────────────────────────────────────────
    result.filteredSpeedKmh = Number(filteredSpeed.toFixed(1));
    result.rawSpeedKmh      = Number(speed.toFixed(1));
    result.expectedSpeedKmh = expectedSpeed != null ? Number(expectedSpeed.toFixed(1)) : null;
    result.speedRatio       = speedRatio != null ? Number(speedRatio.toFixed(2)) : null;
    result.gpsAccuracyM     = gpsAccuracyM != null ? Number(gpsAccuracyM.toFixed(1)) : null;
    result.distanceFromRouteM = distanceFromRouteM != null ? Number(distanceFromRouteM.toFixed(1)) : null;
    result.timestamp        = now;
    result.stoppedDurationS = Number(stoppedDuration.toFixed(1));

    state.lastStatus = result;
    return result;
  }

  // Legacy wrapper — keeps the old call signature working where needed
  function determineBusStatus(speedKmh, lastGPSTime, hasDestination, busId) {
    const now = Date.now();
    const gpsAge = lastGPSTime ? (now - lastGPSTime) : Infinity;

    // Handle cases the advanced engine doesn't cover
    if (gpsAge > 90000) {
      return {
        label: 'Offline', color: '#ef4444', code: 'OFFLINE', confidence: 1.0,
        uiIcon: `<svg viewBox="0 0 64 64" width="40" height="40"><circle cx="32" cy="32" r="23" fill="none" stroke="#ef4444" stroke-width="5"/><path d="M20 20l24 24M44 20l-24 24" stroke="#ef4444" stroke-width="5" stroke-linecap="round"/></svg>`
      };
    }

    const state = busStatusEngines.get(busId || 'default') || {};

    if (lastSharedETA && lastSharedETA.distance_meters != null) {
      if (lastSharedETA.distance_meters < 100) {
        state.hasReached = true;
      } else if (lastSharedETA.distance_meters > 300) {
        state.hasReached = false;
      }
    }

    if (state.hasReached) {
      return {
        label: 'Reached Destination', color: '#6366f1', code: 'ARRIVED', confidence: 0.95,
        uiIcon: `<svg viewBox="0 0 64 64" width="40" height="40"><path d="M20 32l8 8 16-16" fill="none" stroke="#6366f1" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      };
    }

    // Delegate to the advanced engine
    return getBusStatusResult(busId || 'default', {
      speedKmh: speedKmh || 0,
      timestamp: now
    });
  }

  // =========================================================================
  // NEAR BUS DETECTION — local haversine, no API cost
  // =========================================================================
  function getNearBusStatus(studentLat, studentLon, busLat, busLon, busSpeedKmh) {
    if (!studentLat || !studentLon || !busLat || !busLon) return null;

    const dist = haversineDist(studentLat, studentLon, busLat, busLon);

    if (dist <= 40 && busSpeedKmh > 5) {
      if (!insideBusStartTime) {
        insideBusStartTime = Date.now();
      } else if (!insideBusConfirmed && (Date.now() - insideBusStartTime) >= 60000) {
        insideBusConfirmed = true;
      }
    } else {
      if (insideBusConfirmed && dist > 100) insideBusConfirmed = false;
      if (dist > 60) insideBusStartTime = null;
    }

    if (insideBusConfirmed) return { label: 'Inside Bus',   color: '#6366f1', bg: 'rgba(99,102,241,0.12)',  icon: 'fa-person-seat' };
    if (dist <= 50)          return { label: 'Very Close',  color: '#10b981', bg: 'rgba(16,185,129,0.12)',  icon: 'fa-circle-check' };
    if (dist <= 100)         return { label: 'Near Bus',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   icon: 'fa-location-arrow' };
    if (dist <= 150)         return { label: 'Boarding Zone', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: 'fa-circle-dot' };
    return { label: 'Away', color: '#64748b', bg: 'rgba(100,116,139,0.08)', icon: 'fa-location-dot' };
  }

  // =========================================================================
  // ETA COMPUTATION — converts road distance + speed to minutes
  // Used by both applySharedETA (for display) and applyFallback
  // =========================================================================
  function computeETA(road_distance_m, smoothedSpeedKmh, avgSpeedKmh, duration_s) {
    const effectiveSpeed = Math.max(smoothedSpeedKmh || avgSpeedKmh || 20, 5);
    const hour = new Date().getHours();
    const trafficFactor = ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19)) ? 1.3
      : ((hour >= 10 && hour <= 15) || (hour >= 20 && hour <= 22)) ? 1.1 : 0.9;

    if (duration_s && duration_s > 0) {
      const scaledDuration = duration_s * (30 / effectiveSpeed);
      return Math.max(1, Math.round((scaledDuration * trafficFactor) / 60));
    }

    const effectiveSpeedMs = effectiveSpeed / 3.6;
    const etaSec = (road_distance_m / effectiveSpeedMs) * trafficFactor;
    return Math.max(1, Math.round(etaSec / 60));
  }

  // =========================================================================
  // applySharedETA — called when Supabase Realtime delivers a shared ETA payload
  // NO API call is made here — this just renders what the backend computed.
  // =========================================================================
  function applySharedETA(payload, smoothedSpeed, avgSpeed) {
    lastSharedETA = payload;
    lastSharedETATime = Date.now();

    const destEtaEl  = document.getElementById('road-eta-dest');
    const destDistEl = document.getElementById('road-dist-dest');
    const destNameEl = document.getElementById('dest-name-display');

    if (destNameEl && destination) destNameEl.textContent = destination.name;

    const distM  = payload.distance_meters;
    const distKm = distM != null ? (distM / 1000).toFixed(1) : '?';
    const destName = destination?.name || 'Destination';

    if (payload.status === 'UNAVAILABLE' || payload.status === 'GPS_STALE') {
      if (destEtaEl)  { destEtaEl.textContent = 'ETA Unavailable'; destEtaEl.style.color = '#94a3b8'; }
      if (destDistEl) destDistEl.textContent = payload.status === 'GPS_STALE' ? 'Bus location outdated' : 'ETA service unavailable';
      return;
    }

    if (distM != null && distM < 500) {
      if (destEtaEl)  { destEtaEl.textContent = 'Arrived! ✅'; destEtaEl.style.color = '#10b981'; }
      if (destDistEl) destDistEl.textContent = `< 500m to ${destName}`;
      return;
    }

    if (smoothedSpeed < 1) {
      if (destEtaEl)  { destEtaEl.textContent = 'Bus Stopped'; destEtaEl.style.color = '#f59e0b'; }
      if (destDistEl) destDistEl.textContent = `${distKm} km from bus to ${destName}`;
      return;
    }

    // Compute locally based on the broadcasted road distance and current live speed,
    // combined with the backend's highly accurate ORS duration (if available).
    // This perfectly combines the "fine ETA" from ORS with instant local updates.
    let etaMins = computeETA(distM, smoothedSpeed, avgSpeed, payload.base_duration_s);

    const sourceLabel = payload.provider === 'ors' ? '🛣️ Road' : '📐 Estimated';
    const isStale = payload.status === 'STALE';
    const staleWarning = isStale ? ' ⚠️ (updating...)' : '';

    if (destEtaEl)  {
      destEtaEl.textContent = `~${etaMins} min${staleWarning}`;
      destEtaEl.style.color = isStale ? '#f59e0b' : '#059669';
    }
    if (destDistEl) destDistEl.textContent = `${distKm} km from bus to ${destName} · ${sourceLabel}`;
  }

  // =========================================================================
  // applyFallback — used when no Realtime ETA has been received in 90s
  // Uses local haversine to give a rough estimate without any API call.
  // =========================================================================
  function applyFallback(busLat, busLon, smoothedSpeed, avgSpeed) {
    if (!destination || !busLat || !busLon) return;

    const distM = haversineDist(busLat, busLon, destination.latitude, destination.longitude) * 1.25;
    const distKm = (distM / 1000).toFixed(1);
    const destName = destination?.name || 'Destination';

    const destEtaEl  = document.getElementById('road-eta-dest');
    const destDistEl = document.getElementById('road-dist-dest');

    if (distM < 500) {
      if (destEtaEl)  { destEtaEl.textContent = 'Arrived! ✅'; destEtaEl.style.color = '#10b981'; }
      if (destDistEl) destDistEl.textContent = `< 500m to ${destName} · 📐 Estimated`;
      return;
    }

    if (smoothedSpeed < 1) {
      if (destEtaEl)  { destEtaEl.textContent = 'Bus Stopped'; destEtaEl.style.color = '#f59e0b'; }
      if (destDistEl) destDistEl.textContent = `${distKm} km from bus to ${destName} · 📐 Estimated`;
      return;
    }

    const etaMins = computeETA(distM, smoothedSpeed, avgSpeed, null);
    if (destEtaEl)  { destEtaEl.textContent = `~${etaMins} min`; destEtaEl.style.color = '#94a3b8'; }
    if (destDistEl) destDistEl.textContent = `${distKm} km from bus to ${destName} · 📐 Estimated`;
  }

  // =========================================================================
  // MAIN UPDATE FUNCTION — called by student-console.js on every GPS update
  // Updates speed cards, bus status, student proximity — does NOT call any API.
  // ETA rendering happens in applySharedETA (called by Realtime listener) or
  // applyFallback (called when no Realtime ETA received in 90s).
  // =========================================================================
  function updateDisplay(busLat, busLon, speedKmh, studentLat, studentLon, lastGPSTime, busId, studentAccuracyGlobal) {
    if (!busLat || !busLon) return;

    const avgSpeed = updateAverageSpeed(speedKmh);
    const smoothedSpeed = speedKalman.update(speedKmh !== null ? speedKmh : 0);

    // ── Update Speed Cards ───────────────────────────────────────────────
    const speedEl    = document.getElementById('road-speed-display');
    const avgSpeedEl = document.getElementById('road-avg-speed');
    if (speedEl) speedEl.textContent = `${Math.round(speedKmh !== null ? speedKmh : 0)} km/h`;
    if (avgSpeedEl) avgSpeedEl.textContent = `${Math.round(avgSpeed)} km/h`;

    // ── Last GPS Update ──────────────────────────────────────────────────
    const lastGPSEl = document.getElementById('road-last-gps');
    if (lastGPSEl && lastGPSTime) {
      const ageS = Math.round((Date.now() - lastGPSTime) / 1000);
      lastGPSEl.textContent = ageS < 5 ? 'Just now' : `${ageS}s ago`;
    }

    // ── Bus Status ───────────────────────────────────────────────────────
    const busStatus = determineBusStatus(speedKmh, lastGPSTime, !!destination, busId);
    lastBusStatus = busStatus.label;
    
    // Update old hidden elements (legacy support)
    const statusEl    = document.getElementById('road-bus-status');
    const statusDotEl = document.getElementById('road-bus-status-dot');
    if (statusEl)    { statusEl.textContent = busStatus.label; statusEl.style.color = busStatus.color; }
    if (statusDotEl)   statusDotEl.style.background = busStatus.color;

    // Update Student Console UI elements
    const newStatusText = document.getElementById('bus-status-display');
    const newStatusIcon = document.getElementById('status-icon');
    if (newStatusText) {
        newStatusText.textContent = busStatus.label.toUpperCase();
        newStatusText.style.color = busStatus.color;
    }
    if (newStatusIcon && busStatus.uiIcon) {
        newStatusIcon.innerHTML = busStatus.uiIcon;
        newStatusIcon.style.display = 'flex';
    }

    // ── ETA: use shared ETA if fresh, otherwise fallback ────────────────
    const etaAge = Date.now() - lastSharedETATime;
    if (lastSharedETA && etaAge < STALE_FALLBACK_MS) {
      applySharedETA(lastSharedETA, smoothedSpeed, avgSpeed);
    } else if (destination) {
      applyFallback(busLat, busLon, smoothedSpeed, avgSpeed);
    } else {
      // No destination set yet — try loading
      if (!destination) loadDestination().catch(() => {});
      const destEtaEl = document.getElementById('road-eta-dest');
      if (destEtaEl && destEtaEl.textContent === 'Loading...') {
        destEtaEl.textContent = 'No destination set';
      }
    }

    // ── Student → Bus proximity (local haversine, no API) ────────────────
    const studentDistEl   = document.getElementById('road-dist-student');
    const studentStatusEl = document.getElementById('road-student-status');

    if (studentLat && studentLon) {
      const nearStatus = getNearBusStatus(studentLat, studentLon, busLat, busLon, smoothedSpeed);
      if (nearStatus && studentStatusEl) {
        studentStatusEl.textContent = nearStatus.label;
        studentStatusEl.style.color = nearStatus.color;
        studentStatusEl.style.background = nearStatus.bg;
      }

      if (studentDistEl) {
        const distM = haversineDist(studentLat, studentLon, busLat, busLon);
        const distKm = (distM / 1000).toFixed(1);

        let accWarning = '';
        if (studentAccuracyGlobal != null) {
          if (studentAccuracyGlobal > 1000) {
            accWarning = ` ⚠️ GPS accuracy poor (±${(studentAccuracyGlobal / 1000).toFixed(1)}km)`;
          } else if (studentAccuracyGlobal > 50) {
            accWarning = ` (±${Math.round(studentAccuracyGlobal)}m)`;
          }
        }

        if (insideBusConfirmed) {
          studentDistEl.textContent = 'You are currently on the bus';
        } else if (smoothedSpeed < 1) {
          studentDistEl.textContent = `${distKm} km away${accWarning} · Bus is currently stopped`;
        } else {
          const etaMins = Math.max(1, Math.round((distM / (Math.max(smoothedSpeed, 5) / 3.6)) / 60));
          studentDistEl.textContent = `${distKm} km away${accWarning} · ETA ~${etaMins} min for bus to reach you`;
        }
      }
    } else {
      if (studentStatusEl) studentStatusEl.textContent = 'Allow location for proximity detection';
      if (studentDistEl)   studentDistEl.textContent   = 'Share location to see distance from bus';
    }
  }

  // =========================================================================
  // PUBLIC API
  // =========================================================================
  return {
    init: loadDestination,
    update: updateDisplay,         // called on every GPS update for speed/status/proximity
    applySharedETA,                // called by Realtime ETA listener
    applyFallback,                 // called when Realtime ETA is stale
    loadDestination,
    haversineDist,
    getNearBusStatus,
    getBusStatusResult,            // advanced status engine for direct use
    getBusStatus: () => lastBusStatus,
    getLastSharedETA: () => lastSharedETA,
  };

})();
