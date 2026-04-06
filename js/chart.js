function renderTimeline(stops, currentIndex, arrivals = {}) {
  const container = document.getElementById('stop-timeline');
  if (!container) return;

  const header = container.querySelector('.timeline-header');
  container.innerHTML = '';
  if (header) container.appendChild(header);

  stops.forEach((stop, i) => {
    const status = i < currentIndex ? 'completed'
                 : i === currentIndex ? 'current'
                 : 'upcoming';

    const etaText = (i > currentIndex) ? calculateETA(i, currentIndex, stops) : null;
    const arrTime = arrivals[stop.name] || '---';

    const row = document.createElement('div');
    row.className = 'stop-row ' + status;
    row.id = 'stop-' + i;
    row.innerHTML = `
      <div class="time-col">
        <span class="arr-time">${arrTime}</span>
        ${etaText ? `<span class="eta">~${etaText} min</span>` : ''}
      </div>
      <div class="line-col">
        <div class="line top ${i === 0 ? 'hide' : i <= currentIndex ? 'green' : 'gray'}"></div>
        <div class="dot ${status}"></div>
        <div class="line bot ${i === stops.length - 1 ? 'hide' : i < currentIndex ? 'green' : 'gray'}"></div>
      </div>
      <div class="name-col">
        <span class="stop-name">${stop.name}</span>
        <span class="stop-num">Stop ${i + 1} of ${stops.length}</span>
      </div>
    `;
    container.appendChild(row);
  });
}

function calculateETA(stopIndex, currentIndex, stops) {
  // Simple heuristic: 3 mins per stop
  return (stopIndex - currentIndex) * 3;
}

function computeChartPosition(busLat, busLon, tripType) {
  const route = getRoute(tripType);
  let closestIdx = 0;
  let minDist = Infinity;

  route.forEach((stop, i) => {
    const d = haversineDistance(busLat, busLon, stop.lat, stop.lon);
    if (d < minDist) { minDist = d; closestIdx = i; }
  });

  const prevIdx = closestIdx;
  const nextIdx = Math.min(closestIdx + 1, route.length - 1);

  const prevStop = route[prevIdx];
  const nextStop = route[nextIdx];

  const totalSegDist = haversineDistance(prevStop.lat, prevStop.lon, nextStop.lat, nextStop.lon);
  const busToPrev = haversineDistance(busLat, busLon, prevStop.lat, prevStop.lon);

  const progress = totalSegDist > 0 ? Math.min(busToPrev / totalSegDist, 1.0) : 0;

  return { prevIdx, nextIdx, progress };
}

function updateChartMarker(pos) {
  const marker = document.getElementById('chart-bus-marker');
  const prevRow = document.getElementById('stop-' + pos.prevIdx);
  const nextRow = document.getElementById('stop-' + pos.nextIdx);

  if (!marker || !prevRow) return;

  const prevTop = prevRow.offsetTop + prevRow.offsetHeight / 2;
  const nextTop = nextRow ? (nextRow.offsetTop + nextRow.offsetHeight / 2) : prevTop;

  const markerTop = prevTop + pos.progress * (nextTop - prevTop);
  marker.style.top = markerTop + 'px';
  marker.style.display = 'block';

  // scroll container to marker
  const container = document.getElementById('stop-timeline');
  if (container) {
    const scrollPos = markerTop - container.offsetHeight / 2;
    container.scrollTo({ top: scrollPos, behavior: 'smooth' });
  }
}

window.renderTimeline = renderTimeline;
window.computeChartPosition = computeChartPosition;
window.updateChartMarker = updateChartMarker;
