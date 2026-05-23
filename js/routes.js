const ROUTE_CACHE_VERSION = 'v1';

function getCachedRoute(busId = 'Bus 4') {
  try {
    const key = `bustrack_route_${busId.toLowerCase().replace(' ', '')}`;
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (parsed.version !== ROUTE_CACHE_VERSION) return null;
    console.log(`[Cache] Route loaded from localStorage for ${busId}`);
    return parsed.data;
  } catch {
    return null;
  }
}

function cacheRoute(busId, routeData) {
  try {
    const key = `bustrack_route_${busId.toLowerCase().replace(' ', '')}`;
    localStorage.setItem(key, JSON.stringify({
      version: ROUTE_CACHE_VERSION,
      data: routeData,
      cached_at: Date.now()
    }));
    console.log(`[Cache] Route saved to localStorage for ${busId}`);
  } catch {
    console.warn(`[Cache] Could not save route to localStorage for ${busId}`);
  }
}

const busStopsBus4 = [
  { name: 'Kottarakkara',      lat: 9.0018, lon: 76.7759 },
  { name: 'Mylom',             lat: 9.0125, lon: 76.7795 },
  { name: 'Kalayapuram',       lat: 9.0250, lon: 76.7830 },
  { name: 'Kulakkada',         lat: 9.0364, lon: 76.7967 },
  { name: 'Enathu',            lat: 9.0706, lon: 76.7839 },
  { name: 'Kilivayal',         lat: 9.0903, lon: 76.7365 },
  { name: 'Adoor',             lat: 9.1559, lon: 76.7316 },
  { name: 'Mithrapuram',       lat: 9.1423, lon: 76.7205 },
  { name: 'Paranthal',         lat: 9.1802, lon: 76.7208 },
  { name: 'Kurampala',         lat: 9.2042, lon: 76.7038 },
  { name: 'Pandalam',          lat: 9.2375, lon: 76.6810 },
  { name: 'Kulanada',          lat: 9.2463, lon: 76.6738 },
  { name: 'Manthuka',          lat: 9.2734, lon: 76.6628 },
  { name: 'Karakkadu',         lat: 9.2926, lon: 76.6527 },
  { name: 'Mulakkuzha',        lat: 9.3076, lon: 76.6408 },
  { name: 'Hatchery',          lat: 9.3139, lon: 76.6382 },
  { name: 'Providence College',lat: 9.3203, lon: 76.6390 }
];

const BUSES = {
  'Bus 1': { hasRoute: false },
  'Bus 2': { hasRoute: false },
  'Bus 3': { hasRoute: false },
  'Bus 4': { hasRoute: true, stops: busStopsBus4 },
  'Bus 5': { hasRoute: false },
  'Bus 6': { hasRoute: false },
};

function getRoute(tripType, busId = 'Bus 4') {
  let route = getCachedRoute(busId);
  if (!route) {
    // For now we fallback to busStopsBus4 if the route isn't defined
    // Later you can add actual routes for Bus 1, Bus 2, etc.
    route = BUSES[busId]?.stops || busStopsBus4;
    cacheRoute(busId, route);
  }
  return tripType === 'morning' ? route : [...route].reverse();
}

window.BUSES = BUSES;
window.getRoute = getRoute;
