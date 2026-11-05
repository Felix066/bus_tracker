/**
 * Comprehensive Automated Regression Test Suite
 * Covers Issue 1 (Security), Issue 2 (Logout/Session), Issue 3 (Trip Lifecycle)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../../');
const backendDir = path.resolve(__dirname, '../');

console.log('================================================================');
console.log('  WHERE IS MY BUS — AUTOMATED SECURITY & REGRESSION TEST SUITE  ');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// ISSUE 1: SECURITY VULNERABILITIES
// -----------------------------------------------------------------------------
console.log('--- ISSUE 1: SECURITY VULNERABILITIES ---');

test('1.A: Hardcoded Staff PINs removed from index.html', () => {
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  assert.strictEqual(indexHtml.includes('VALID_STAFF_PINS'), false, 'VALID_STAFF_PINS should not exist in index.html');
  assert.strictEqual(indexHtml.includes('2026'), false, 'PIN 2026 should not exist in index.html');
  assert.strictEqual(indexHtml.includes('verifyStaffPin'), false, 'verifyStaffPin function should not exist');
  assert.strictEqual(indexHtml.includes('staff-pin-view'), false, 'staff-pin-view div should be removed');
  assert.strictEqual(indexHtml.includes('staff_pin_unlocked'), false, 'sessionStorage staff_pin_unlocked check should be removed');
});

test('1.B: Stored XSS in driver-dashboard.html SOS chat eliminated', () => {
  const driverHtml = fs.readFileSync(path.join(rootDir, 'driver-dashboard.html'), 'utf8');
  assert.strictEqual(driverHtml.includes('>${msg.message}</div>'), false, 'Unsafe innerHTML interpolation of msg.message must be removed');
  assert.strictEqual(driverHtml.includes('bubble.textContent = msg.message'), true, 'Safe DOM textContent must be used for msg.message');
});

test('1.B: XSS in js/chat.js voice and delete popup eliminated', () => {
  const chatJs = fs.readFileSync(path.join(rootDir, 'js/chat.js'), 'utf8');
  assert.strictEqual(chatJs.includes('deleteSingleMessage(\'${msgId}\')'), false, 'Unsafe inline onclick with msgId string must be removed');
  assert.strictEqual(chatJs.includes('document.createElement(\'audio\')'), true, 'Voice audio elements should be constructed via DOM');
  assert.strictEqual(chatJs.includes('parsed.protocol === \'http:\' || parsed.protocol === \'https:\''), true, 'Voice URLs must validate protocol scheme');
});

test('1.B: Analytics table in js/admin-dashboard.js uses textContent', () => {
  const adminJs = fs.readFileSync(path.join(rootDir, 'js/admin-dashboard.js'), 'utf8');
  assert.strictEqual(adminJs.includes('<td data-label="Bus">${item.bus_id}</td>'), false, 'Raw interpolation of bus_id in innerHTML should be removed');
  assert.strictEqual(adminJs.includes('tdBus.textContent = item.bus_id'), true, 'Bus ID must be assigned with textContent');
});

test('1.C: Reflected XSS & path leak in backend server.js Google callback fixed', () => {
  const serverJs = fs.readFileSync(path.join(backendDir, 'server.js'), 'utf8');
  assert.strictEqual(serverJs.includes('JSON.stringify(String(credential))'), true, 'Credential must be sanitized with JSON.stringify');
  assert.strictEqual(serverJs.includes('Internal Server Error: \' + err.message + \'\\nPath:'), false, 'Internal file path must not leak in 500 responses');
});

test('1.C: CORS allowedOrigins does not include "null"', () => {
  const serverJs = fs.readFileSync(path.join(backendDir, 'server.js'), 'utf8');
  const allowedSection = serverJs.substring(serverJs.indexOf('const allowedOrigins ='), serverJs.indexOf('app.use(cors('));
  assert.strictEqual(allowedSection.includes('\'null\''), false, 'CORS allowedOrigins must not contain "null"');
});

test('1.C: Backend body-parser limit reduced from 50mb to 15mb', () => {
  const serverJs = fs.readFileSync(path.join(backendDir, 'server.js'), 'utf8');
  assert.strictEqual(serverJs.includes('express.json({ limit: \'50mb\' })'), false, '50mb JSON body limit should be reduced');
  assert.strictEqual(serverJs.includes('express.json({ limit: \'15mb\' })'), true, 'JSON body limit should be set to 15mb');
});

test('1.C: Trip start enforces driver-to-bus assignment authorization', () => {
  const serverJs = fs.readFileSync(path.join(backendDir, 'server.js'), 'utf8');
  const tripStartSection = serverJs.substring(serverJs.indexOf('/api/trip/start'), serverJs.indexOf('/api/trip/end'));
  assert.strictEqual(tripStartSection.includes('req.user.assignedBus'), true, 'Trip start must verify assignedBus against driver token');
  assert.strictEqual(tripStartSection.includes('403'), true, 'Unauthorized bus start attempt must return 403');
});

// -----------------------------------------------------------------------------
// ISSUE 2: LOGOUT, BACK NAVIGATION AND SESSION MANAGEMENT
// -----------------------------------------------------------------------------
console.log('\n--- ISSUE 2: LOGOUT, BACK NAVIGATION & SESSION MANAGEMENT ---');

test('2.1: Cache-Control no-store headers configured for protected pages', () => {
  const serverJs = fs.readFileSync(path.join(backendDir, 'server.js'), 'utf8');
  assert.strictEqual(serverJs.includes('PROTECTED_HTML_PAGES'), true, 'PROTECTED_HTML_PAGES array must be defined');
  assert.strictEqual(serverJs.includes('no-store, no-cache, must-revalidate, private'), true, 'no-store Cache-Control header must be set');
});

test('2.2: session-protection.js handles browser bfcache pageshow restoration', () => {
  const sessProt = fs.readFileSync(path.join(rootDir, 'js/session-protection.js'), 'utf8');
  assert.strictEqual(sessProt.includes('event.persisted'), true, 'pageshow listener must check event.persisted for bfcache restoration');
  assert.strictEqual(sessProt.includes('window._currentRequiredRole'), true, 'Global required role tracker must be maintained');
});

test('2.3: Driver logout uses window.location.replace and clears all session state', () => {
  const driverAuth = fs.readFileSync(path.join(rootDir, 'js/driver-auth.js'), 'utf8');
  assert.strictEqual(driverAuth.includes('window.location.replace(\'driver-login.html\')'), true, 'Driver logout must use location.replace');
  assert.strictEqual(driverAuth.includes('localStorage.removeItem(\'activeTripId\')'), true, 'Driver logout must clear activeTripId');
  assert.strictEqual(driverAuth.includes('sessionStorage.clear()'), true, 'Driver logout must clear sessionStorage');
});

test('2.4: Student logout uses window.location.replace and clears sessionStorage', () => {
  const authJs = fs.readFileSync(path.join(rootDir, 'js/auth.js'), 'utf8');
  assert.strictEqual(authJs.includes('window.location.replace(\'student-login.html\')'), true, 'Student logout must use location.replace');
  assert.strictEqual(authJs.includes('sessionStorage.clear()'), true, 'Student logout must clear sessionStorage');
});

test('2.5: Admin logout uses window.location.replace and clears sessionStorage', () => {
  const adminHtml = fs.readFileSync(path.join(rootDir, 'admin-dashboard.html'), 'utf8');
  assert.strictEqual(adminHtml.includes('window.location.replace(\'admin-login.html\')'), true, 'Admin logout must use location.replace');
  assert.strictEqual(adminHtml.includes('sessionStorage.clear()'), true, 'Admin logout must clear sessionStorage');
});

test('2.6: Protected dashboards redirect unauthenticated visitors using location.replace', () => {
  const studentDash = fs.readFileSync(path.join(rootDir, 'student-dashboard.html'), 'utf8');
  const studentConsole = fs.readFileSync(path.join(rootDir, 'student-console.html'), 'utf8');
  assert.strictEqual(studentDash.includes('window.location.replace(\'student-login.html\')'), true, 'student-dashboard must use replace');
  assert.strictEqual(studentConsole.includes('window.location.replace(\'student-login.html\')'), true, 'student-console must use replace');
});

// -----------------------------------------------------------------------------
// ISSUE 3: DRIVER END TRIP AND BUS ONLINE STATUS
// -----------------------------------------------------------------------------
console.log('\n--- ISSUE 3: DRIVER END TRIP & BUS ONLINE STATUS ---');

test('3.1: driver-dashboard.html does not auto-logout or end trips on beforeunload', () => {
  const driverDash = fs.readFileSync(path.join(rootDir, 'driver-dashboard.html'), 'utf8');
  assert.strictEqual(driverDash.includes('window.addEventListener(\'beforeunload\''), false, 'beforeunload auto-logout must be removed');
});

test('3.2: backend /api/trip/end updates completed_at and resets current_bus_locations', () => {
  const serverJs = fs.readFileSync(path.join(backendDir, 'server.js'), 'utf8');
  const tripEndSection = serverJs.substring(serverJs.indexOf('/api/trip/end'), serverJs.indexOf('/api/analytics'));
  assert.strictEqual(tripEndSection.includes('completed_at: new Date().toISOString()'), true, 'trip/end must set completed_at');
  assert.strictEqual(tripEndSection.includes('speed_kmh: 0'), true, 'trip/end must reset speed_kmh in current_bus_locations');
});

test('3.3: trip.js endTrip retrieves busId before clearing localStorage and stops GPS', () => {
  const tripJs = fs.readFileSync(path.join(rootDir, 'js/trip.js'), 'utf8');
  const endTripSection = tripJs.substring(tripJs.indexOf('async function endTrip()'), tripJs.indexOf('async function recoverActiveTrip()'));
  assert.strictEqual(endTripSection.includes('navigator.geolocation.clearWatch(watchId)'), true, 'endTrip must clear GPS watch');
  assert.strictEqual(endTripSection.includes('clearInterval(window.gpsRetryInterval)'), true, 'endTrip must clear retry interval');
  assert.strictEqual(endTripSection.includes('stopTripTimer()'), true, 'endTrip must stop timer');
});

test('3.4: student-console.js persists lastEndedTripId in sessionStorage across reload', () => {
  const scJs = fs.readFileSync(path.join(rootDir, 'js/student-console.js'), 'utf8');
  assert.strictEqual(scJs.includes('sessionStorage.getItem(\'lastEndedTripId_\''), true, 'lastEndedTripId must be initialized from sessionStorage');
  assert.strictEqual(scJs.includes('sessionStorage.setItem(\'lastEndedTripId_\''), true, 'handleTripEnded must persist lastEndedTripId in sessionStorage');
});

test('3.5: student-console.js ignores GPS location updates when activeTripId is null', () => {
  const scJs = fs.readFileSync(path.join(rootDir, 'js/student-console.js'), 'utf8');
  assert.strictEqual(scJs.includes('if (activeTripId) {\n                            processNewLocation'), true, 'Realtime listener must not process location when activeTripId is null');
  assert.strictEqual(scJs.includes('const locRes = activeTripId ? await fetch'), true, '3s polling fallback must only fetch location when activeTripId is true');
});

test('3.6: student-console.js handleTripEnded removes marker and resets UI displays', () => {
  const scJs = fs.readFileSync(path.join(rootDir, 'js/student-console.js'), 'utf8');
  const endSection = scJs.substring(scJs.indexOf('function handleTripEnded()'), scJs.indexOf('function handleDriverOnline()'));
  assert.strictEqual(endSection.includes('window.map.removeLayer(window.busMarker)'), true, 'handleTripEnded must remove busMarker');
  assert.strictEqual(endSection.includes('statusText.textContent = \'Trip Ended\''), true, 'handleTripEnded must set Trip Ended status text');
  assert.strictEqual(endSection.includes('liveBadge.textContent = \'TRIP ENDED\''), true, 'handleTripEnded must set TRIP ENDED badge');
  assert.strictEqual(endSection.includes('speedDisplay.textContent = \'0 km/h\''), true, 'handleTripEnded must reset speed display to 0 km/h');
});

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
console.log('================================================================\n');

if (totalTests !== passedTests) {
  process.exit(1);
} else {
  console.log('ALL REGRESSION CHECKS PASSED SUCCESSFULLY!\n');
}

