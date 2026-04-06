let timerInterval;

function startTripTimer() {
  const startTime = Date.now();
  timerInterval = setInterval(() => {
    const diff = Date.now() - startTime;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    const display = document.getElementById('trip-duration-display');
    if (display) display.textContent = timeStr;
  }, 1000);
}

function stopTripTimer() {
  clearInterval(timerInterval);
}

window.startTripTimer = startTripTimer;
window.stopTripTimer = stopTripTimer;
