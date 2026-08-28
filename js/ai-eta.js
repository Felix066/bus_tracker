// js/ai-eta.js — Custom AI-Driven ETA Prediction Engine
// Uses Kalman-smoothed velocity, traffic time-of-day weights,
// and haversine distance to compute real-time ETA predictions.

window.AIEta = (function () {

  // =========================================================================
  // CONFIGURATION — Update college GPS coordinates below
  // =========================================================================
  const COLLEGE_LAT = 9.0750;   // ← Replace with your actual college latitude
  const COLLEGE_LON = 76.5710;  // ← Replace with your actual college longitude

  const INSIDE_BUS_THRESHOLD_M = 30;   // meters — triggers "Inside Bus" status
  const ARRIVED_COLLEGE_THRESHOLD_M = 120; // meters — triggers "Arrived at College"
  const MIN_SPEED_KMPH = 5;            // below this, bus is considered stopped

  // =========================================================================
  // KALMAN FILTER — Smooth out GPS noise & jerky speed readings (Per Bus)
  // =========================================================================
  const kalmanStates = {};
  
  function getKalmanFilteredSpeed(busId, measurement) {
    if (!busId) busId = 'default';
    if (!kalmanStates[busId]) {
      kalmanStates[busId] = { q: 0.01, r: 1.0, p: 1.0, x: measurement };
      return measurement;
    }
    const state = kalmanStates[busId];
    state.p = state.p + state.q;
    const K = state.p / (state.p + state.r);
    state.x = state.x + K * (measurement - state.x);
    state.p = (1 - K) * state.p;
    return state.x;
  }

  // =========================================================================
  // TIME-OF-DAY TRAFFIC SCALING
  // =========================================================================
  function getTrafficFactor() {
    const hour = new Date().getHours();
    // Peak hours: 7-9 AM and 4-7 PM → slower travel
    if ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19)) return 1.45;
    // Mid-day moderate traffic
    if ((hour >= 10 && hour <= 15) || (hour >= 20 && hour <= 22)) return 1.15;
    // Night / early morning — fast
    return 0.90;
  }

  // =========================================================================
  // DECELERATION PROXIMITY FACTOR
  // Simulate slow-down near stops/college
  // =========================================================================
  function getDecelerationFactor(distanceM) {
    if (distanceM < 200) return 1.6;   // Very close — slowing to stop
    if (distanceM < 500) return 1.3;   // Approaching intersection/stop
    if (distanceM < 1500) return 1.15;  // Within 1.5km — cautious speed
    return 1.0;
  }

  // =========================================================================
  // haversine — Returns distance in meters between two GPS coords
  // =========================================================================
  function haversineDist(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // =========================================================================
  // CORE AI PREDICTION FUNCTION
  // Returns: { etaMinutes, distanceM, status, label }
  // =========================================================================
  function predict(busLat, busLon, targetLat, targetLon, rawSpeedKmph, busId = 'default') {
    if (!busLat || !busLon || !targetLat || !targetLon) return null;

    // Apply a road tortuosity factor to convert straight-line haversine to realistic road distance
    const ROAD_FACTOR = 1.35;
    const rawDistanceM = haversineDist(busLat, busLon, targetLat, targetLon);
    const distanceM = rawDistanceM * ROAD_FACTOR;

    // Check proximity states first (using raw straight-line distance for accuracy)
    if (rawDistanceM <= INSIDE_BUS_THRESHOLD_M) {
      return { etaMinutes: 0, distanceM: rawDistanceM, status: 'inside_bus', label: '✅ Status: Inside Bus' };
    }

    // Apply Kalman filter to speed per bus
    const smoothedSpeedKmph = getKalmanFilteredSpeed(busId, rawSpeedKmph || MIN_SPEED_KMPH);
    const effectiveSpeedKmph = Math.max(smoothedSpeedKmph, MIN_SPEED_KMPH);

    // Apply AI traffic factor
    const trafficFactor = getTrafficFactor();

    // Apply deceleration factor based on proximity
    const decelerationFactor = getDecelerationFactor(distanceM);

    // Adjust effective speed with AI corrections
    const adjustedSpeedKmph = effectiveSpeedKmph / (trafficFactor * decelerationFactor);
    const adjustedSpeedMs = Math.max(adjustedSpeedKmph / 3.6, 0.5);

    // ETA in seconds → minutes
    const etaSeconds = distanceM / adjustedSpeedMs;
    let etaMinutes = Math.round(etaSeconds / 60);

    // Add +1 minute penalty for every 1.5km to account for bus stops and traffic lights
    const stopPenaltyMins = Math.floor(distanceM / 1500);
    etaMinutes += stopPenaltyMins;

    let label;
    if (etaMinutes < 1) {
      label = `🚌 Arriving now (${Math.round(distanceM)}m away)`;
    } else {
      const distKm = (distanceM / 1000).toFixed(1);
      label = `🕒 AI ETA: ~${etaMinutes} min · ${distKm} km`;
    }

    return { etaMinutes, distanceM, status: 'en_route', label };
  }

  // =========================================================================
  // UPDATE UI — Renders prediction to target DOM element
  // =========================================================================
  function updateETADisplay(busLat, busLon, rawSpeedKmph, studentLat, studentLon, busId = 'default') {
    const etaEl = document.getElementById('eta-student');
    const etaSubEl = document.getElementById('eta-student-sub');
    const etaCollegeEl = document.getElementById('eta-college');
    const etaCollegeSubEl = document.getElementById('eta-college-sub');

    // Student ETA
    if (etaEl) {
      if (studentLat && studentLon) {
        const result = predict(busLat, busLon, studentLat, studentLon, rawSpeedKmph, busId);
        if (result) {
          if (result.status === 'inside_bus') {
            etaEl.textContent = 'On Board';
            etaEl.style.color = '#10b981';
            if (etaSubEl) etaSubEl.innerHTML = '<i class="fas fa-check-circle" style="color:#10b981;"></i> You are currently inside the bus';
          } else {
            etaEl.textContent = result.etaMinutes < 1 ? '< 1 min' : `~${result.etaMinutes} mins`;
            etaEl.style.color = '#4f46e5';
            const distKm = (result.distanceM / 1000).toFixed(1);
            if (etaSubEl) etaSubEl.innerHTML = `<i class="fas fa-location-arrow" style="color:#6366f1;"></i> ${distKm} km to your stop · Live AI Estimate`;
          }
        }
      } else {
        etaEl.textContent = 'Waiting GPS...';
        if (etaSubEl) etaSubEl.innerHTML = '<i class="fas fa-map-marker-alt" style="color:#94a3b8;"></i> Allow location for personal stop ETA';
      }
    }

    // College ETA
    if (etaCollegeEl) {
      const distToCollege = haversineDist(busLat, busLon, COLLEGE_LAT, COLLEGE_LON);
      if (distToCollege <= ARRIVED_COLLEGE_THRESHOLD_M) {
        etaCollegeEl.textContent = 'Arrived';
        etaCollegeEl.style.color = '#10b981';
        if (etaCollegeSubEl) etaCollegeSubEl.innerHTML = '<i class="fas fa-graduation-cap" style="color:#10b981;"></i> Bus has arrived at Campus';
      } else {
        const result = predict(busLat, busLon, COLLEGE_LAT, COLLEGE_LON, rawSpeedKmph, busId);
        if (result) {
          etaCollegeEl.textContent = result.etaMinutes < 1 ? '< 1 min' : `~${result.etaMinutes} mins`;
          etaCollegeEl.style.color = '#059669';
          const distKm = (distToCollege / 1000).toFixed(1);
          if (etaCollegeSubEl) etaCollegeSubEl.innerHTML = `<i class="fas fa-school" style="color:#10b981;"></i> ${distKm} km to College · Traffic Factored`;
        }
      }
    }
  }

  return {
    predict,
    updateETADisplay,
    haversineDist,
    COLLEGE_LAT,
    COLLEGE_LON
  };
})();
