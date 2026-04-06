function calculateETAToStop(targetStopIndex, currentStopIndex, route) {
  if (targetStopIndex <= currentStopIndex) return null;
  
  // A more "realistic" calculation could use average speed,
  // but a simple time-per-stop heuristic is fine.
  const stopsRemaining = targetStopIndex - currentStopIndex;
  const avgMinutesPerStop = 5; // Assumed 5 min per stop including wait
  return stopsRemaining * avgMinutesPerStop;
}

window.calculateETAToStop = calculateETAToStop;
