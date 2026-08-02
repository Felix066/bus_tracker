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
  // KALMAN FILTER — Smooth out GPS noise & jerky speed readings
  // =========================================================================
  const kalman = {
    q: 0.01,   // process noise
    r: 1.0,    // measurement noise
    p: 1.0,    // estimation error
    x: null,   // current estimate
    update(measurement) {
      if (this.x === null) { this.x = measurement; return measurement; }
      this.p = this.p + this.q;
      const K = this.p / (this.p + this.r);
      this.x = this.x + K * (measurement - this.x);
      this.p = (1 - K) * this.p;
      return this.x;
    }
  };

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
  function predict(busLat, busLon, targetLat, targetLon, rawSpeedKmph) {
    if (!busLat || !busLon || !targetLat || !targetLon) return null;

    const distanceM = haversineDist(busLat, busLon, targetLat, targetLon);

    // Check proximity states first
    if (distanceM <= INSIDE_BUS_THRESHOLD_M) {
      return { etaMinutes: 0, distanceM, status: 'inside_bus', label: '✅ Status: Inside Bus' };
    }

    // Apply Kalman filter to speed
    const smoothedSpeedKmph = kalman.update(rawSpeedKmph || MIN_SPEED_KMPH);
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
    const etaMinutes = Math.round(etaSeconds / 60);

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
  function updateETADisplay(busLat, busLon, rawSpeedKmph, studentLat, studentLon) {
    const etaEl = document.getElementById('eta-student');
    const etaCollegeEl = document.getElementById('eta-college');

    // Student ETA
    if (etaEl && studentLat && studentLon) {
      const result = predict(busLat, busLon, studentLat, studentLon, rawSpeedKmph);
      if (result) {
        etaEl.textContent = result.label;
        etaEl.style.color = result.status === 'inside_bus' ? '#10b981' : '#f59e0b';
      }
    }

    // College ETA
    if (etaCollegeEl) {
      const distToCollege = haversineDist(busLat, busLon, COLLEGE_LAT, COLLEGE_LON);
      if (distToCollege <= ARRIVED_COLLEGE_THRESHOLD_M) {
        etaCollegeEl.textContent = '🎓 Status: Arrived at College';
        etaCollegeEl.style.color = '#10b981';
      } else {
        const result = predict(busLat, busLon, COLLEGE_LAT, COLLEGE_LON, rawSpeedKmph);
        if (result) {
          etaCollegeEl.textContent = `🏫 College ${result.label.replace('🕒 AI ETA:', 'ETA:')}`;
          etaCollegeEl.style.color = '#818cf8';
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
