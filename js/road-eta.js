// js/road-eta.js — Road-Based ETA Engine
// Replaces ai-eta.js haversine logic with real road distance via ORS proxy.
// All routing calls go through /api/route/eta (backend protects ORS API key).
// Smart caching: only calls backend when bus moves >150m or 30s elapsed.
// Never calls routing API every 3 seconds — respects ORS free tier (2000/day).

window.RoadETA = (function () {

  // =========================================================================
  // KALMAN FILTER — Smooth noisy GPS speed readings
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
  // STATE — Persistent across updates, kept in memory only (no DB writes)
  // =========================================================================
  let destination = null;       // { name, latitude, longitude } — from admin
  let lastRouteResult = null;   // Last successful ORS response
  let lastRouteFetchTime = 0;   // Timestamp of last ORS call
  let lastRouteBusLat = null;
  let lastRouteBusLon = null;

  const ROUTE_CACHE_MS = 30000; // 30 seconds between API calls
  const ROUTE_MOVE_M   = 150;   // Minimum bus movement to trigger new fetch

  // Average speed tracking (rolling window of last 10 readings)
  const speedHistory = [];
  const SPEED_WINDOW = 10;

  // Inside-bus detection state
  let insideBusStartTime = null;
  let insideBusConfirmed = false;

  // Bus status state
  let lastBusStatus = 'Offline';

  // =========================================================================
  // HAVERSINE — Client-side, used only for proximity/near-bus detection
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
          // Update destination name in UI
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
  // BUS STATUS ENGINE — automatically determine bus operating state
  // =========================================================================
  function determineBusStatus(speedKmh, lastGPSTime, hasDestination) {
    const now = Date.now();
    const gpsAge = lastGPSTime ? (now - lastGPSTime) : Infinity;

    if (gpsAge > 90000) return { label: 'Offline', color: '#ef4444', icon: 'fa-wifi-slash' };

    if (!hasDestination) return { label: 'Active', color: '#10b981', icon: 'fa-bus' };

    // Check if reached destination (use last route result)
    if (lastRouteResult && lastRouteResult.road_distance_m < 100) {
      return { label: 'Reached Destination', color: '#6366f1', icon: 'fa-flag-checkered' };
    }

    const speed = speedKmh || 0;
    if (speed < 2)  return { label: 'Stopped', color: '#f59e0b', icon: 'fa-circle-pause' };
    if (speed < 8)  return { label: 'Traffic Delay', color: '#f97316', icon: 'fa-traffic-light' };
    if (speed < 60) return { label: 'Moving', color: '#10b981', icon: 'fa-bus-simple' };
    return { label: 'Moving Fast', color: '#22c55e', icon: 'fa-gauge-high' };
  }

  // =========================================================================
  // NEAR BUS DETECTION — based on student GPS vs bus GPS (haversine only)
  // =========================================================================
  function getNearBusStatus(studentLat, studentLon, busLat, busLon, busSpeedKmh) {
    if (!studentLat || !studentLon || !busLat || !busLon) return null;

    const dist = haversineDist(studentLat, studentLon, busLat, busLon);

    // Inside-bus detection: student within 40m of moving bus for 60+ seconds
    if (dist <= 40 && busSpeedKmh > 5) {
      if (!insideBusStartTime) {
        insideBusStartTime = Date.now();
      } else if (!insideBusConfirmed && (Date.now() - insideBusStartTime) >= 60000) {
        insideBusConfirmed = true;
      }
    } else {
      if (insideBusConfirmed && dist > 100) {
        insideBusConfirmed = false; // Exited bus
      }
      if (dist > 60) insideBusStartTime = null;
    }

    if (insideBusConfirmed) {
      return { label: 'Inside Bus', color: '#6366f1', bg: 'rgba(99,102,241,0.12)', icon: 'fa-person-seat' };
    }
    if (dist <= 50)  return { label: 'Very Close', color: '#10b981', bg: 'rgba(16,185,129,0.12)', icon: 'fa-circle-check' };
    if (dist <= 100) return { label: 'Near Bus', color: '#22c55e', bg: 'rgba(34,197,94,0.12)', icon: 'fa-location-arrow' };
    if (dist <= 150) return { label: 'Boarding Zone', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: 'fa-circle-dot' };
    return { label: 'Away', color: '#64748b', bg: 'rgba(100,116,139,0.08)', icon: 'fa-location-dot' };
  }

  // =========================================================================
  // FETCH ROAD ETA — from backend ORS proxy (smart caching enforced here too)
  // =========================================================================
  async function fetchRoadRoute(busLat, busLon, targetLat, targetLon, busId) {
    const now = Date.now();

    // Check if we can reuse the last result
    if (lastRouteResult && lastRouteBusLat !== null) {
      const age = now - lastRouteFetchTime;
      const moved = haversineDist(lastRouteBusLat, lastRouteBusLon, busLat, busLon);
      if (age < ROUTE_CACHE_MS && moved < ROUTE_MOVE_M) {
        return { ...lastRouteResult, cached: true };
      }
    }

    try {
      const url = `${BACKEND_URL}/api/route/eta?fromLat=${busLat}&fromLon=${busLon}&toLat=${targetLat}&toLon=${targetLon}&busId=${encodeURIComponent(busId || '')}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error('Backend route error');
      const data = await res.json();
      if (data.success) {
        lastRouteResult = data;
        lastRouteFetchTime = now;
        lastRouteBusLat = busLat;
        lastRouteBusLon = busLon;
        return data;
      }
    } catch (e) {
      console.warn('[RoadETA] fetchRoadRoute failed:', e.message);
    }

    // Return last known result as fallback
    return lastRouteResult;
  }

  // =========================================================================
  // COMPUTE ETA MINUTES — uses road distance + kalman-smoothed speed
  // =========================================================================
  function computeETA(road_distance_m, speedKmh, avgSpeedKmh, duration_s) {
    // If ORS gave us a duration, use it as base and adjust for current speed
    if (duration_s && duration_s > 0 && speedKmh > 2) {
      const smoothedSpeed = speedKalman.update(speedKmh);
      const effectiveSpeed = Math.max(smoothedSpeed, 5); // min 5 km/h
      // ORS duration assumes average 30 km/h; scale by actual speed
      const scaledDuration = duration_s * (30 / effectiveSpeed);
      // Traffic time-of-day adjustment
      const hour = new Date().getHours();
      const trafficFactor = ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19)) ? 1.3
        : ((hour >= 10 && hour <= 15) || (hour >= 20 && hour <= 22)) ? 1.1 : 0.9;
      return Math.round((scaledDuration * trafficFactor) / 60);
    }

    // Pure distance-based fallback (Kalman-smoothed speed)
    const smoothedSpeed = speedKalman.update(speedKmh || avgSpeedKmh || 20);
    const effectiveSpeedMs = Math.max(smoothedSpeed, 5) / 3.6;
    const hour = new Date().getHours();
    const trafficFactor = ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19)) ? 1.3
      : ((hour >= 10 && hour <= 15) || (hour >= 20 && hour <= 22)) ? 1.1 : 0.9;
    const etaSec = (road_distance_m / effectiveSpeedMs) * trafficFactor;
    return Math.max(Math.round(etaSec / 60), 1);
  }

  // =========================================================================
  // MAIN UPDATE FUNCTION — called by student-console.js on every GPS update
  // =========================================================================
  async function updateDisplay(busLat, busLon, speedKmh, studentLat, studentLon, lastGPSTime, busId) {
    if (!busLat || !busLon) return;

    const avgSpeed = updateAverageSpeed(speedKmh);
    const smoothedSpeed = speedKalman.update(speedKmh || 0);

    // ── Update Speed Cards ───────────────────────────────────────────────
    const speedEl   = document.getElementById('road-speed-display');
    const avgSpeedEl = document.getElementById('road-avg-speed');
    if (speedEl) speedEl.textContent = `${Math.round(smoothedSpeed)} km/h`;
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
    if (statusEl) {
      statusEl.textContent = busStatus.label;
      statusEl.style.color = busStatus.color;
    }
    if (statusDotEl) statusDotEl.style.background = busStatus.color;

    // ── Destination ETA (road distance) ─────────────────────────────────
    const destEtaEl  = document.getElementById('road-eta-dest');
    const destDistEl = document.getElementById('road-dist-dest');
    const destNameEl = document.getElementById('dest-name-display');

    if (!destination) {
      // Destination not yet loaded — try loading
      await loadDestination();
    }

    if (destination) {
      if (destNameEl) destNameEl.textContent = destination.name;

      const routeData = await fetchRoadRoute(busLat, busLon, destination.latitude, destination.longitude, busId);

      if (routeData) {
        const distM  = routeData.road_distance_m;
        const distKm = routeData.road_distance_km;

        if (distM < 100) {
          // Arrived
          if (destEtaEl)  { destEtaEl.textContent = 'Arrived'; destEtaEl.style.color = '#10b981'; }
          if (destDistEl) destDistEl.textContent = `< 100m to ${destination.name}`;
        } else {
          const etaMins = computeETA(distM, speedKmh, avgSpeed, routeData.duration_s);
          const source  = routeData.source === 'ors' ? '🛣️ Road' : '📐 Estimated';
          if (destEtaEl)  { destEtaEl.textContent = `~${etaMins} min`; destEtaEl.style.color = '#059669'; }
          if (destDistEl) destDistEl.textContent = `${distKm} km to ${destination.name} · ${source}`;
        }
      }
    } else {
      if (destEtaEl)  destEtaEl.textContent = 'No destination set';
      if (destDistEl) destDistEl.textContent = 'Admin has not set a destination yet';
    }

    // ── Student → Bus (road distance) ────────────────────────────────────
    const studentDistEl   = document.getElementById('road-dist-student');
    const studentStatusEl = document.getElementById('road-student-status');

    if (studentLat && studentLon) {
      const nearStatus = getNearBusStatus(studentLat, studentLon, busLat, busLon, speedKmh);

      if (nearStatus) {
        if (studentStatusEl) {
          studentStatusEl.textContent = nearStatus.label;
          studentStatusEl.style.color = nearStatus.color;
          studentStatusEl.style.background = nearStatus.bg;
        }
      }

      // Road distance: bus → student (via backend proxy)
      const studentRoute = await fetchRoadRoute(busLat, busLon, studentLat, studentLon, `${busId || ''}_student`);
      if (studentRoute) {
        const etaMins = computeETA(studentRoute.road_distance_m, speedKmh, avgSpeed, studentRoute.duration_s);
        if (studentDistEl) {
          if (insideBusConfirmed) {
            studentDistEl.textContent = 'You are currently on the bus';
          } else {
            studentDistEl.textContent = `${studentRoute.road_distance_km} km · ETA ~${etaMins} min to your location`;
          }
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
    update: updateDisplay,
    loadDestination,
    haversineDist,
    getNearBusStatus,
    getBusStatus: () => lastBusStatus
  };

})();
