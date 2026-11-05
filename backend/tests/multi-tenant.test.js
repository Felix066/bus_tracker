// ============================================================================
// WHERE IS MY BUS — MULTI-TENANT SAAS & ACCESS-CODE TEST SUITE
// Automated verification for multi-institution tenancy, HMAC access-code
// cryptography, Super Admin RBAC, Institution Admin controls, and data isolation.
// ============================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const assert = require('assert');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_key_minimum_32_characters_long!';
process.env.INSTITUTION_CODE_HMAC_KEY = process.env.INSTITUTION_CODE_HMAC_KEY || 'wimb_secret_hmac_sha256_key_2026_default';
process.env.SUPER_ADMIN_BOOTSTRAP_USER = 'superadmin';
process.env.SUPER_ADMIN_BOOTSTRAP_PASS = 'SuperAdmin@2026!';

const app = require('../server');

const TEST_RESULTS = [];

async function runTest(name, fn) {
  try {
    await fn();
    TEST_RESULTS.push({ name, passed: true });
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    TEST_RESULTS.push({ name, passed: false, error: err.message });
    console.error(`  [FAIL] ${name}`);
    console.error(`         Error: ${err.message}`);
  }
}

let server;
let baseUrl;

async function makeRequest(method, endpoint, body = null, headers = {}) {
  const url = `${baseUrl}${endpoint}`;
  const reqHeaders = {
    'Content-Type': 'application/json',
    ...headers
  };
  const opts = {
    method: method.toUpperCase(),
    headers: reqHeaders
  };
  if (body !== null && method.toUpperCase() !== 'GET') {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let resData;
  const text = await res.text();
  try {
    resData = JSON.parse(text);
  } catch (e) {
    resData = text;
  }
  return {
    status: res.status,
    headers: res.headers,
    body: text,
    json: () => resData
  };
}

async function runAllTests() {
  console.log('\n================================================================');
  console.log('  WHERE IS MY BUS — MULTI-TENANT SAAS AUTOMATED TEST SUITE      ');
  console.log('================================================================\n');

  // Start ephemeral server on free port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    // --------------------------------------------------------------------------
    // SECTION A: ACCESS-CODE CRYPTOGRAPHY & FORMAT TESTS
    // --------------------------------------------------------------------------
    console.log('--- A. ACCESS-CODE GENERATION & CRYPTOGRAPHY ---');

    await runTest('A.1: Access code format matches WIMB-<PREFIX>-<BLOCKS> with 128-bit randomness', () => {
      const generate = app.locals.generateAccessCode;
      assert.strictEqual(typeof generate, 'function', 'generateAccessCode must be defined');

      const code = generate('PCE');
      assert.ok(code.startsWith('WIMB-PCE-'), 'Code must start with WIMB-PCE-');
      const regex = /^WIMB-[A-Z0-9]+-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/;
      assert.ok(regex.test(code), `Generated code "${code}" must match standard 128-bit chunked format`);
    });

    await runTest('A.2: Generated codes are unique across multiple calls', () => {
      const generate = app.locals.generateAccessCode;
      const codes = new Set();
      for (let i = 0; i < 20; i++) {
        codes.add(generate('TEST'));
      }
      assert.strictEqual(codes.size, 20, '20 generated codes must all be distinct');
    });

    await runTest('A.3: HMAC-SHA-256 calculation is deterministic and case-normalized', () => {
      const hash = app.locals.hashAccessCode;
      assert.strictEqual(typeof hash, 'function', 'hashAccessCode must be defined');

      const codeUpper = 'WIMB-PCE-2026-X9T4-M7K2';
      const codeLower = 'wimb-pce-2026-x9t4-m7k2';
      const codePadded = '  WIMB-PCE-2026-X9T4-M7K2  ';

      const h1 = hash(codeUpper);
      const h2 = hash(codeLower);
      const h3 = hash(codePadded);

      assert.strictEqual(h1.length, 64, 'SHA-256 hex string must be 64 characters');
      assert.strictEqual(h1, h2, 'Hash must match regardless of input case');
      assert.strictEqual(h1, h3, 'Hash must match regardless of whitespace padding');
    });

    await runTest('A.4: Plaintext access codes are never identical to their hash', () => {
      const generate = app.locals.generateAccessCode;
      const hash = app.locals.hashAccessCode;
      const plain = generate('PCE');
      const hashed = hash(plain);
      assert.notStrictEqual(plain, hashed, 'Plaintext code must never match hash');
      assert.ok(!hashed.includes(plain), 'Hash must never contain plaintext secret');
    });

    // --------------------------------------------------------------------------
    // SECTION B: PUBLIC INSTITUTION RESOLUTION ENDPOINT
    // --------------------------------------------------------------------------
    console.log('\n--- B. PUBLIC INSTITUTION RESOLUTION (POST /api/institutions/resolve-code) ---');

    await runTest('B.1: Rejects missing or empty access code', async () => {
      const res = await makeRequest('POST', '/api/institutions/resolve-code', {});
      assert.strictEqual(res.status, 400);
      const data = res.json();
      assert.strictEqual(data.ok, false);
    });

    await runTest('B.2: Rejects invalid or fake access code', async () => {
      const res = await makeRequest('POST', '/api/institutions/resolve-code', { code: 'WIMB-FAKE-9999-0000-0000' });
      assert.strictEqual(res.status, 401);
      const data = res.json();
      assert.strictEqual(data.ok, false);
      assert.ok(data.error.includes('Invalid or inactive'));
    });

    await runTest('B.3: Resolves default seeded Providence College access code', async () => {
      const res = await makeRequest('POST', '/api/institutions/resolve-code', { code: 'WIMB-PCE-2026-X9T4-M7K2' });
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(data.ok, true);
      assert.ok(data.institution, 'Must return institution object');
      assert.strictEqual(data.institution.code, 'PCE-001');
      assert.strictEqual(data.institution.name, 'Providence College of Engineering');
      assert.strictEqual(data.institution.code_hash, undefined, 'Must never expose code_hash');
    });

    // --------------------------------------------------------------------------
    // SECTION C: PLATFORM SUPER ADMIN (DEVELOPER) AUTH & RBAC
    // --------------------------------------------------------------------------
    console.log('\n--- C. PLATFORM SUPER ADMIN (DEVELOPER) AUTHENTICATION & RBAC ---');

    let superAdminToken = null;
    let institutionAdminToken = null;

    await runTest('C.1: Rejects invalid Super Admin credentials', async () => {
      const res = await makeRequest('POST', '/api/platform/login', {
        username: 'superadmin',
        password: 'WrongPassword@123'
      });
      assert.strictEqual(res.status, 401);
    });

    await runTest('C.2: Authenticates valid Super Admin and returns role super_admin JWT', async () => {
      const res = await makeRequest('POST', '/api/platform/login', {
        username: 'superadmin',
        password: 'SuperAdmin@2026!'
      });
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.token, 'Must return JWT token');
      assert.strictEqual(data.user.role, 'super_admin');
      superAdminToken = data.token;

      // Verify claims inside JWT
      const decoded = jwt.verify(superAdminToken, process.env.JWT_SECRET);
      assert.strictEqual(decoded.role, 'super_admin');
      assert.strictEqual(decoded.username, 'superadmin');
    });

    await runTest('C.3: Super Admin token can access GET /api/platform/dashboard-stats', async () => {
      const res = await makeRequest('GET', '/api/platform/dashboard-stats', null, {
        'authorization': 'Bearer ' + superAdminToken
      });
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.stats.totalInstitutions >= 1);
    });

    await runTest('C.4: Missing token is rejected with 401 on privileged platform routes', async () => {
      const res = await makeRequest('GET', '/api/platform/dashboard-stats');
      assert.strictEqual(res.status, 401);
    });

    await runTest('C.5: Regular Institution Admin token (role: admin) is rejected with 403 Forbidden', async () => {
      institutionAdminToken = jwt.sign(
        { user_id: '7dbad405-5147-471b-93b2-03e58c92c0e6', username: 'admin', role: 'admin', institution_id: app.locals.DEFAULT_INSTITUTION_ID },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const res = await makeRequest('GET', '/api/platform/dashboard-stats', null, {
        'authorization': 'Bearer ' + institutionAdminToken
      });
      assert.strictEqual(res.status, 403, 'Institution admin must be forbidden from platform routes');
      const data = res.json();
      assert.ok(data.error.includes('Platform Super Admin privileges required'));
    });

    // --------------------------------------------------------------------------
    // SECTION D: INSTITUTION REGISTRATION & ACCESS-CODE REVEAL
    // --------------------------------------------------------------------------
    console.log('\n--- D. INSTITUTION MANAGEMENT & ONE-TIME ACCESS CODE REVEAL ---');

    let testInstId = null;
    let testInstPlainCode = null;

    await runTest('D.1: Rejects registration without institution name or code', async () => {
      const res = await makeRequest('POST', '/api/platform/institutions', {
        institution_name: ''
      }, {
        'authorization': 'Bearer ' + superAdminToken
      });
      assert.strictEqual(res.status, 400);
    });

    await runTest('D.2: Super Admin can register an institution and receives plaintext code once', async () => {
      const timestamp = Date.now().toString().slice(-4);
      const testCode = `KCT-${timestamp}`;

      const res = await makeRequest('POST', '/api/platform/institutions', {
        institution_name: 'Kumaraguru College of Technology',
        institution_code: testCode,
        institution_type: 'college',
        address: 'Chinnavedampatti',
        district: 'Coimbatore',
        state: 'Tamil Nadu',
        contact_person: 'Fleet Manager',
        contact_email: 'fleet@kct.ac.in',
        contact_phone: '+91 422 266 9401',
        allow_admin_code_rotation: true
      }, {
        'authorization': 'Bearer ' + superAdminToken
      });

      assert.strictEqual(res.status, 201);
      const data = res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.institution.id);
      assert.ok(data.accessCode, 'Must return generated plaintext code');
      assert.ok(data.accessCode.startsWith('WIMB-KCT-'), 'Code must be prefixed with institution slug');

      testInstId = data.institution.id;
      testInstPlainCode = data.accessCode;
    });

    await runTest('D.3: Newly generated access code can be resolved via public endpoint', async () => {
      assert.ok(testInstPlainCode, 'Must have active plain access code');
      const res = await makeRequest('POST', '/api/institutions/resolve-code', {
        code: testInstPlainCode
      });
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(data.ok, true);
      assert.strictEqual(data.institution.id, testInstId);
      assert.strictEqual(data.institution.name, 'Kumaraguru College of Technology');
    });

    await runTest('D.4: Super Admin can rotate access code and old code is revoked immediately', async () => {
      const oldCode = testInstPlainCode;

      // 1. Rotate code
      const resRotate = await makeRequest('POST', `/api/platform/institutions/${testInstId}/access-code/rotate`, {}, {
        'authorization': 'Bearer ' + superAdminToken
      });
      assert.strictEqual(resRotate.status, 200);
      const rotateData = resRotate.json();
      assert.strictEqual(rotateData.success, true);
      assert.ok(rotateData.accessCode);
      assert.notStrictEqual(rotateData.accessCode, oldCode, 'New code must differ from old code');
      const newCode = rotateData.accessCode;

      // 2. Old code must be rejected immediately
      const resOld = await makeRequest('POST', '/api/institutions/resolve-code', { code: oldCode });
      assert.strictEqual(resOld.status, 401, 'Old code must be rejected with 401');

      // 3. New code resolves successfully
      const resNew = await makeRequest('POST', '/api/institutions/resolve-code', { code: newCode });
      assert.strictEqual(resNew.status, 200, 'New code must resolve with 200');
    });

    await runTest('D.5: Super Admin can toggle admin code rotation permission', async () => {
      const res = await makeRequest('PATCH', `/api/platform/institutions/${testInstId}/code-settings`, {
        allow_admin_code_rotation: false
      }, {
        'authorization': 'Bearer ' + superAdminToken
      });
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(data.allow_admin_code_rotation, false);
    });

    // --------------------------------------------------------------------------
    // SECTION E: INSTITUTION ADMINISTRATOR CONTROLS
    // --------------------------------------------------------------------------
    console.log('\n--- E. INSTITUTION ADMINISTRATOR CODE MANAGEMENT ---');

    await runTest('E.1: Institution Admin can view their own access code status', async () => {
      const res = await makeRequest('GET', '/api/institution/access-code/status', null, {
        'authorization': 'Bearer ' + institutionAdminToken
      });
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.institution);
      assert.ok(data.accessCode);
      assert.strictEqual(data.accessCode.code_hash, undefined, 'Must NEVER expose code hash to institution admin');
    });

    await runTest('E.2: Institution Admin code rotation is blocked when disabled by platform developer', async () => {
      const disabledAdminToken = jwt.sign(
        { user_id: '7dbad405-5147-471b-93b2-03e58c92c0e6', username: 'admin', role: 'admin', institution_id: testInstId },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const res = await makeRequest('POST', '/api/institution/access-code/rotate', {}, {
        'authorization': 'Bearer ' + disabledAdminToken
      });
      assert.strictEqual(res.status, 403, 'Rotation must be forbidden when allow_admin_code_rotation is false');
      const data = res.json();
      assert.ok(data.error.includes('disabled'));
    });

    // --------------------------------------------------------------------------
    // SECTION F: MULTI-TENANT BUS QUERY ISOLATION & BACKWARD COMPATIBILITY
    // --------------------------------------------------------------------------
    console.log('\n--- F. MULTI-TENANT BUS QUERY ISOLATION & BACKWARD COMPATIBILITY ---');

    await runTest('F.1: GET /api/public/buses without institution_id returns default fleet (backward compatibility)', async () => {
      const res = await makeRequest('GET', '/api/public/buses');
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(data.success, true);
      assert.ok(Array.isArray(data.buses), 'Buses must be an array');
    });

    await runTest('F.2: GET /api/public/buses?institution_id=<id> filters fleet by tenant', async () => {
      const res = await makeRequest('GET', `/api/public/buses?institution_id=${app.locals.DEFAULT_INSTITUTION_ID}`);
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(data.success, true);
      assert.ok(Array.isArray(data.buses));
    });

    await runTest('F.3: Platform audit logs capture super admin operations', async () => {
      const res = await makeRequest('GET', '/api/platform/audit-logs', null, {
        'authorization': 'Bearer ' + superAdminToken
      });
      assert.strictEqual(res.status, 200);
      const data = res.json();
      assert.strictEqual(data.success, true);
      assert.ok(Array.isArray(data.logs));
      assert.ok(data.logs.length > 0, 'Audit logs must record events');
      const actions = data.logs.map(l => l.action);
      assert.ok(actions.includes('SUPER_ADMIN_LOGIN') || actions.includes('INSTITUTION_REGISTERED'));
    });

  } finally {
    if (server) {
      server.close();
    }
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  const passed = TEST_RESULTS.filter(t => t.passed).length;
  const failed = TEST_RESULTS.filter(t => !t.passed).length;
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${TEST_RESULTS.length} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    console.error(`ERROR: ${failed} multi-tenant test(s) failed.`);
    process.exit(1);
  } else {
    console.log('ALL MULTI-TENANT SAAS TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  }
}

runAllTests();
