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
  // BUS STATUS ENGINE — local, no API cost
  // =========================================================================
  function determineBusStatus(speedKmh, lastGPSTime, hasDestination) {
    const now = Date.now();
    const gpsAge = lastGPSTime ? (now - lastGPSTime) : Infinity;

    if (gpsAge > 90000) return { label: 'Offline', color: '#ef4444', icon: 'fa-wifi-slash' };
    if (!hasDestination) return { label: 'Active', color: '#10b981', icon: 'fa-bus' };

    if (lastSharedETA && lastSharedETA.distance_meters < 100) {
      return { label: 'Reached Destination', color: '#6366f1', icon: 'fa-flag-checkered' };
    }

    const speed = speedKmh || 0;
    if (speed < 2)  return { label: 'Stopped', color: '#f59e0b', icon: 'fa-circle-pause' };
    if (speed < 8)  return { label: 'Traffic Delay', color: '#f97316', icon: 'fa-traffic-light' };
    if (speed < 60) return { label: 'Moving', color: '#10b981', icon: 'fa-bus-simple' };
    return { label: 'Moving Fast', color: '#22c55e', icon: 'fa-gauge-high' };
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

    if (distM != null && distM < 100) {
      if (destEtaEl)  { destEtaEl.textContent = 'Arrived! ✅'; destEtaEl.style.color = '#10b981'; }
      if (destDistEl) destDistEl.textContent = `< 100m to ${destName}`;
      return;
    }

    if (smoothedSpeed < 1) {
      if (destEtaEl)  { destEtaEl.textContent = 'Bus Stopped'; destEtaEl.style.color = '#f59e0b'; }
      if (destDistEl) destDistEl.textContent = `${distKm} km from bus to ${destName}`;
      return;
    }

    // Use backend-computed ETA minutes if available, otherwise compute locally
    let etaMins;
    if (payload.eta_minutes != null) {
      etaMins = payload.eta_minutes;
    } else {
      etaMins = computeETA(distM, smoothedSpeed, avgSpeed, null);
    }

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
    const busStatus = determineBusStatus(speedKmh, lastGPSTime, !!destination);
    lastBusStatus = busStatus.label;
    const statusEl    = document.getElementById('road-bus-status');
    const statusDotEl = document.getElementById('road-bus-status-dot');
    if (statusEl)    { statusEl.textContent = busStatus.label; statusEl.style.color = busStatus.color; }
    if (statusDotEl)   statusDotEl.style.background = busStatus.color;

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
    update: updateDisplay,         // still called on every GPS update for speed/status/proximity
    applySharedETA,                // called by Realtime ETA listener
    applyFallback,                 // called when Realtime ETA is stale
    loadDestination,
    haversineDist,
    getNearBusStatus,
    getBusStatus: () => lastBusStatus,
    getLastSharedETA: () => lastSharedETA,
  };

})();
