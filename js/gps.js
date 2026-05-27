let passengerGpsInterval = null;

function roundCoord(value) {
  return Math.round(value * 10000) / 10000;
}

function startPassengerGPS(tripId, busId, role) {
  // OPTIMIZATION: Passengers/Students no longer send GPS data.
  // They receive driver location purely via realtime subscriptions.
  console.log('ℹ️ ' + role + ' mode: Receiving location updates via realtime (not sending)');
}

function stopPassengerGPS(tripId, busId, role) {
  // No longer needed
}

// Event listeners removed as GPS tracking for students is disabled.

window.startPassengerGPS = startPassengerGPS;
window.stopPassengerGPS = stopPassengerGPS;

