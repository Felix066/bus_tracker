class KalmanFilter {
  constructor() {
    this.lat = null;
    this.lon = null;
    this.variance = -1;
    this.minAccuracy = 1;
    this.lastTs = null;
  }

  process(lat, lon, accuracy, timestampMs) {
    accuracy = Math.max(accuracy || 20, this.minAccuracy);
    if (this.variance < 0) {
      this.lat = lat;
      this.lon = lon;
      this.variance = accuracy * accuracy;
      this.lastTs = timestampMs;
    } else {
      const timeMs = timestampMs - this.lastTs;
      if (timeMs > 0) {
        // Assume 3m/s movement noise increment
        this.variance += (timeMs / 1000) * 3 * 3;
      }
      const K = this.variance / (this.variance + accuracy * accuracy);
      this.lat += K * (lat - this.lat);
      this.lon += K * (lon - this.lon);
      this.variance = (1 - K) * this.variance;
      this.lastTs = timestampMs;
    }
    return { lat: this.lat, lon: this.lon };
  }
}

window.KalmanFilter = KalmanFilter;
