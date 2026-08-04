// js/routes.js - Bus Routes & Stops Configuration

const morningRoute = [
  { name: "Kollam Junction", lat: 8.8932, lon: 76.6141 },
  { name: "Kottarakkara", lat: 9.0000, lon: 76.7800 },
  { name: "Adoor", lat: 9.1526, lon: 76.7314 },
  { name: "Pandalam", lat: 9.2312, lon: 76.6834 },
  { name: "College Campus", lat: 9.0750, lon: 76.5710 }
];

const eveningRoute = [
  { name: "College Campus", lat: 9.0750, lon: 76.5710 },
  { name: "Pandalam", lat: 9.2312, lon: 76.6834 },
  { name: "Adoor", lat: 9.1526, lon: 76.7314 },
  { name: "Kottarakkara", lat: 9.0000, lon: 76.7800 },
  { name: "Kollam Junction", lat: 8.8932, lon: 76.6141 }
];

function getRoute(tripType) {
  if (tripType === 'evening') return eveningRoute;
  return morningRoute;
}

window.morningRoute = morningRoute;
window.eveningRoute = eveningRoute;
window.getRoute = getRoute;
