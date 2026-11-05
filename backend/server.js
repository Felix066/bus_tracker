const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');

// ============================================================================
// ETA OPTIMIZATION MODULES
// ============================================================================
const ViewerService    = require('./src/presence/ViewerService');
const ETAPollerManager = require('./src/eta/ETAPollerManager');
const ETACache         = require('./src/eta/ETACache');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || '47792284104-7dncvdit6ilh47snjfm8anekv3jvavko.apps.googleusercontent.com');

const app = express();

// ============================================================================
// CACHE-CONTROL SECURITY HEADERS (Bfcache & Sensitive Page Protection)
// ============================================================================
const PROTECTED_HTML_PAGES = [
  '/admin-dashboard.html',
  '/driver-dashboard.html',
  '/student-dashboard.html',
  '/student-console.html',
  '/super-admin.html'
];

app.use((req, res, next) => {
  if (PROTECTED_HTML_PAGES.some(p => req.path.endsWith(p)) || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.set('trust proxy', 1); // Enable trusting reverse proxy for accurate client IPs in rate limiting
let supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize ETA optimization subsystems
// ETAPollerManager.init() internally calls ETACache.init() and ETALock.init() — do NOT call ETACache.init() separately.
ETAPollerManager.init(supabase);
ViewerService.startCleanupInterval();

// ============================================================================
// AUTOMATED SERVER-SIDE SESSION & TRIP HEALTH MONITOR
// Runs every 60s to detect disconnected drivers & auto-close abandoned trips
// ============================================================================
const DRIVER_OFFLINE_THRESHOLD_MS = 2.5 * 60 * 1000;  // 2.5 minutes without heartbeat/location
const TRIP_AUTO_CLOSE_THRESHOLD_MS = 45 * 60 * 1000; // 45 minutes without location update

function startTripHealthMonitor() {
  setInterval(async () => {
    try {
      const now = new Date();
      const offlineCutoff = new Date(now.getTime() - DRIVER_OFFLINE_THRESHOLD_MS).toISOString();

      // 1. Mark stale driver sessions as offline
      await supabase
        .from('driver_sessions')
        .update({ is_online: false })
        .eq('is_online', true)
        .lt('last_seen', offlineCutoff);

      // 2. Find active trips that have had no location update for > 45 minutes
      const tripCutoff = new Date(now.getTime() - TRIP_AUTO_CLOSE_THRESHOLD_MS).toISOString();
      const { data: staleTrips } = await supabase
        .from('trips')
        .select('id, bus_id, started_at')
        .eq('status', 'active');

      if (staleTrips && staleTrips.length > 0) {
        for (const trip of staleTrips) {
          const { data: loc } = await supabase
            .from('current_bus_locations')
            .select('updated_at')
            .eq('bus_id', trip.bus_id)
            .single();

          const lastActivity = loc?.updated_at || trip.started_at;
          if (new Date(lastActivity) < new Date(tripCutoff)) {
            console.log(`[HealthMonitor] Auto-closing abandoned trip ${trip.id} for ${trip.bus_id}`);
            await supabase
              .from('trips')
              .update({ status: 'completed', completed_at: now.toISOString() })
              .eq('id', trip.id);
          }
        }
      }
    } catch (err) {
      console.warn('[TripHealthMonitor] Error during background check:', err.message);
    }
  }, 60000);
}

startTripHealthMonitor();

// Load current destination into ETAPollerManager memory on startup (non-blocking)
(async () => {
  try {
    const { data } = await supabase.from('destinations').select('*').eq('id', 1).single();
    if (data) {
      ETAPollerManager.setDestination(data);
      console.log('[Startup] Destination loaded:', data.name);
    }
  } catch (e) {
    console.warn('[Startup] Could not load destination:', e.message);
  }
})();

// 1. JWT Secret Security Enforcement
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'your-random-secret-key-min-32-characters-long-here-1234567890' || JWT_SECRET.length < 32) {
  console.error('\n[FATAL ERROR] Insecure or missing JWT_SECRET environment variable!');
  console.error('You MUST set a secure JWT_SECRET of at least 32 characters in your backend/.env file before the server can start.');
  process.exit(1);
}

// 3. Production Deployment Security Hardening (CORS)
const allowedOrigins = [
  process.env.FRONTEND_URL, 
  'http://localhost:5500', 
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'https://accounts.google.com',
  'https://myaccount.google.com',
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(helmet({
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  // strict-origin-when-cross-origin is required so that Google's servers receive
  // the Referer header when validating the login_uri in redirect mode.
  // Helmet's default 'no-referrer' strips this header and breaks Android Chrome auth.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://accounts.google.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://accounts.google.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:", "blob:", "https://lh3.googleusercontent.com"],
      connectSrc: ["'self'", "https://qlzqymdeguhzlxnfawiq.supabase.co", "wss://qlzqymdeguhzlxnfawiq.supabase.co", "https://nominatim.openstreetmap.org", "https://accounts.google.com", "https://api.openrouteservice.org"],
      frameSrc: ["'self'", "https://accounts.google.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  }
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Stricter rate limiter for authentication endpoints with IP and identifier grouping
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Generate a unique key per IP + email/username to specifically prevent brute force
    // on a single account from a single IP, while also limiting total spam.
    let identifier = 'unknown';
    if (req.body) {
      if (req.body.username) identifier = req.body.username.toLowerCase();
      else if (req.body.email) identifier = req.body.email.toLowerCase();
      // Google token is too long to be an identifier, rely on IP for google auth
    }
    return `${req.ip}_${identifier}`;
  },
  message: { error: 'Too many login attempts from this IP/Account. Please try again in 15 minutes.' }
});
app.use('/api/auth/', authLimiter);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
const fs = require('fs');

// Handle Google GIS Redirect POST callback
app.post('/google-callback.html', (req, res) => {
  try {
    const credential = req.body && (req.body.credential || req.body.id_token);
    
    if (!credential) {
      console.error('[GoogleCallback] Missing credential in body:', req.body);
      return res.redirect('/student-login.html?error=NoCredential');
    }
    
    const filePath = path.join(__dirname, '../google-callback.html');
    let html = fs.readFileSync(filePath, 'utf8');
    
    // Inject the script to trigger the callback manually since GIS won't do it for a server-side POST
    const injection = `<script>
      if (typeof window.handleGoogleCallback === 'function') {
        window.handleGoogleCallback({ credential: ${JSON.stringify(String(credential))} });
      } else {
        console.error('handleGoogleCallback not found');
      }
    </script>`;
    
    html = html.replace('</body>', injection + '\n</body>');
    res.send(html);
  } catch (err) {
    console.error('[POST /google-callback.html] Error:', err);
    res.status(500).send('Authentication processing failed. Please try again.');
  }
});

// Serve static frontend files from the parent directory
app.use(express.static(path.join(__dirname, '../')));

// ============================================================================
// MAP TILE PROXY — bypasses firewall restrictions on tile servers
// Requests come from the server (not the browser), so they are not blocked.
// Usage: /tiles/:z/:x/:y  =>  proxies https://tile.openstreetmap.org/{z}/{x}/{y}.png
// ============================================================================
const https = require('https');
const http = require('http'); 

app.get('/tiles/:z/:x/:y', (req, res) => {
  const { z, x, y } = req.params;

  // Validate params to prevent path traversal / abuse
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return res.status(400).send('Invalid tile coords');
  }
  if (parseInt(z) > 19 || parseInt(z) < 0) {
    return res.status(400).send('Zoom out of range');
  }

  // Try OSM first, fall back to CartoDB
  const tileUrls = [
    `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`
  ];

  function fetchTile(urlIndex) {
    if (urlIndex >= tileUrls.length) {
      return res.status(502).send('All tile sources failed');
    }
    const tileUrl = tileUrls[urlIndex];
    const client = tileUrl.startsWith('https') ? https : http;

    const request = client.get(tileUrl, {
      headers: {
        'User-Agent': 'BusTrack/1.0 (School Bus Tracking System)',
        'Accept': 'image/png,image/*'
      },
      timeout: 8000
    }, (upstream) => {
      if (upstream.statusCode !== 200) {
        upstream.resume();
        return fetchTile(urlIndex + 1);
      }
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // cache tiles for 24h
      res.setHeader('Access-Control-Allow-Origin', '*');
      upstream.pipe(res);
    });

    request.on('error', () => fetchTile(urlIndex + 1));
    request.on('timeout', () => { request.destroy(); fetchTile(urlIndex + 1); });
  }

  fetchTile(0);
});

// --- USER ACCESS MANAGEMENT ENDPOINTS ---

// Get App Settings
app.get('/api/admin/settings', requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabase.from('app_settings').select('allow_everyone').eq('id', 1).maybeSingle();
    if (error) throw error;
    res.json(data || { allow_everyone: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update App Settings
app.post('/api/admin/settings', requireRole(['admin']), async (req, res) => {
  try {
    const { allow_everyone } = req.body;
    const { data, error } = await supabase
      .from('app_settings')
      .upsert({ id: 1, allow_everyone })
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, settings: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Authorized Users
app.get('/api/admin/authorized-users', requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('authorized_users')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, users: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add Authorized User
app.post('/api/admin/authorized-users', requireRole(['admin']), async (req, res) => {
  try {
    let { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    email = email.toLowerCase().trim();

    const { data, error } = await supabase
      .from('authorized_users')
      .insert({ email, added_by: req.user.username })
      .select()
      .single();
      
    if (error) {
      if (error.code === '23505') { // Unique violation
        return res.status(400).json({ error: 'Email is already authorized' });
      }
      throw error;
    }
    res.json({ success: true, user: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove Authorized User
app.delete('/api/admin/authorized-users/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('authorized_users')
      .delete()
      .eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// MULTI-TENANT SAAS CONSTANTS, CRYPTOGRAPHIC UTILITIES & MFA
// ============================================================================
const INSTITUTION_CODE_HMAC_KEY = process.env.INSTITUTION_CODE_HMAC_KEY || 'wimb_secret_hmac_sha256_key_2026_default';

/**
 * Generates an Institution Access Code with >= 128 bits of CSPRNG entropy.
 * Format: WIMB-<PREFIX>-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
 * Randomness: 16 bytes = 128 bits = 32 hexadecimal characters (8 blocks of 4 hex chars).
 */
function generateAccessCode(institutionCode) {
  const prefixRaw = (institutionCode || 'INST').split('-')[0];
  const cleanPrefix = prefixRaw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'INST';
  const randomBytes = crypto.randomBytes(16); // 16 bytes = 128 bits of entropy
  const randomHex = randomBytes.toString('hex').toUpperCase(); // 32 hex chars (32 * 4 = 128 bits)
  const chunks = randomHex.match(/.{1,4}/g).join('-'); // 8 blocks of 4 hex chars
  return `WIMB-${cleanPrefix}-${chunks}`;
}

/**
 * Calculates HMAC-SHA-256 digest of normalized access code.
 * Plaintext codes are NEVER stored in persistent storage or logs.
 */
function hashAccessCode(code) {
  if (!code || typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  return crypto.createHmac('sha256', INSTITUTION_CODE_HMAC_KEY).update(normalized).digest('hex');
}

/**
 * Enforces strong password policy:
 * >= 12 characters, >= 1 uppercase, >= 1 lowercase, >= 1 number, >= 1 special symbol.
 */
function validateStrongPassword(password) {
  if (typeof password !== 'string') return { valid: false, message: 'Password must be a string' };
  if (password.length < 12) return { valid: false, message: 'Password must be at least 12 characters long' };
  if (!/[A-Z]/.test(password)) return { valid: false, message: 'Password must contain at least one uppercase letter' };
  if (!/[a-z]/.test(password)) return { valid: false, message: 'Password must contain at least one lowercase letter' };
  if (!/[0-9]/.test(password)) return { valid: false, message: 'Password must contain at least one number' };
  const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"|,.<>\/?~`]/.test(password) || password.includes('\\');
  if (!hasSymbol) return { valid: false, message: 'Password must contain at least one special character' };
  return { valid: true };
}

// RFC 6238 TOTP Multi-Factor Authentication Utilities (Pure Node.js crypto, zero dependencies)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTOTP(secretBase32, timeOffsetSteps = 0, timeStepSec = 30) {
  const key = base32Decode(secretBase32);
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / timeStepSec) + timeOffsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt = (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  ) % 1000000;
  return codeInt.toString().padStart(6, '0');
}

function verifyTOTP(secretBase32, token, window = 1) {
  if (!secretBase32 || !token) return false;
  const cleanToken = String(token).trim();
  if (cleanToken.length !== 6 || !/^\d{6}$/.test(cleanToken)) return false;
  for (let step = -window; step <= window; step++) {
    if (generateTOTP(secretBase32, step) === cleanToken) return true;
  }
  return false;
}

// Persistent Audit Logging to Supabase
async function logPlatformAudit(actorId, actorType, action, institutionId = null, metadata = {}, req = null) {
  const logEntry = {
    id: crypto.randomUUID(),
    actor_id: String(actorId),
    actor_type: actorType,
    action,
    institution_id: institutionId,
    metadata,
    ip_address: req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip) : null,
    user_agent: req ? req.headers['user-agent'] : null,
    created_at: new Date().toISOString()
  };

  try {
    const { error } = await supabase.from('platform_audit_logs').insert([logEntry]);
    if (error) {
      console.warn('[Platform Audit] Failed to record audit log:', error.message);
    }
  } catch (err) {
    console.warn('[Platform Audit] Audit log exception:', err.message);
  }
}

// Rate Limiters for Access Code Resolution & Platform Management
const resolveCodeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many access code attempts. Please wait a minute and try again.' }
});

const platformLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many platform management requests. Please try again later.' }
});

// ============================================================================
// AUTHORIZATION MIDDLEWARE (AUTHORITATIVE SERVER-SIDE TENANT DERIVATION)
// ============================================================================
async function verifyRole(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // AUTHORITATIVE ACTIVE DATABASE VERIFICATION & TENANT DERIVATION
    if (decoded.role === 'admin') {
      const { data: adminRecord, error: adminErr } = await supabase
        .from('admins')
        .select('id, username, institution_id')
        .eq('id', decoded.user_id)
        .single();

      if (adminErr || !adminRecord) {
        return res.status(401).json({ error: 'Admin account revoked or deleted' });
      }

      if (!adminRecord.institution_id) {
        return res.status(403).json({ error: 'Admin account has no institution assigned' });
      }

      const { data: inst, error: instErr } = await supabase
        .from('institutions')
        .select('id, status')
        .eq('id', adminRecord.institution_id)
        .single();

      if (instErr || !inst || inst.status !== 'active') {
        return res.status(403).json({ error: 'Associated institution is inactive or suspended' });
      }

      // Authoritative tenant derived exclusively from database record
      req.user.institution_id = adminRecord.institution_id;
    } else if (decoded.role === 'driver') {
      const { data: driverRecord, error: driverErr } = await supabase
        .from('drivers')
        .select('id, username, assigned_bus, institution_id')
        .eq('id', decoded.user_id)
        .single();

      if (driverErr || !driverRecord) {
        return res.status(401).json({ error: 'Driver account revoked or deleted' });
      }

      if (!driverRecord.institution_id) {
        return res.status(403).json({ error: 'Driver account has no institution assigned' });
      }

      const { data: inst, error: instErr } = await supabase
        .from('institutions')
        .select('id, status')
        .eq('id', driverRecord.institution_id)
        .single();

      if (instErr || !inst || inst.status !== 'active') {
        return res.status(403).json({ error: 'Associated institution is inactive or suspended' });
      }

      // Authoritative tenant & assigned bus derived exclusively from database record
      req.user.institution_id = driverRecord.institution_id;
      req.user.assignedBus = driverRecord.assigned_bus;
    } else if (decoded.role === 'super_admin') {
      const { data: platformAdmin, error: paErr } = await supabase
        .from('platform_admins')
        .select('id, status')
        .eq('id', decoded.user_id)
        .single();

      if (paErr || !platformAdmin || platformAdmin.status !== 'active') {
        return res.status(401).json({ error: 'Platform admin account inactive or revoked' });
      }
    }

    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    verifyRole(req, res, () => {
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ 
          error: `Forbidden: Requires one of ${allowedRoles.join(', ')}` 
        });
      }
      next();
    });
  };
}

function requireSuperAdmin(req, res, next) {
  verifyRole(req, res, () => {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ 
        error: 'Forbidden: Platform Super Admin privileges required' 
      });
    }
    next();
  });
}

// ============================================================================
// AUTHENTICATION - INVITATION-BASED REGISTRATION
// ============================================================================

// GENERATE INVITATION LINK (Admin only)
app.post('/api/auth/generate-invitation', requireRole(['admin']), async (req, res) => {
  try {
    const { email, role, college_id } = req.body;
    
    const invitationToken = crypto.randomBytes(32).toString('hex');
    
    const { data, error } = await supabase
      .from('invitations')
      .insert({
        email,
        role,
        college_id,
        token: invitationToken,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        used: false
      })
      .select();
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    const registrationLink = `${process.env.FRONTEND_URL}/register.html?token=${invitationToken}`;
    
    res.json({
      success: true,
      message: 'Invitation created',
      registration_link: registrationLink,
      expires_in_days: 7
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REGISTER WITH INVITATION TOKEN
app.post('/api/auth/register-with-token', async (req, res) => {
  try {
    const { token, password, full_name } = req.body;
    
    if (!token || !password || !full_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const { data: invitation, error: inviteError } = await supabase
      .from('invitations')
      .select('*')
      .eq('token', token)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .single();
    
    if (inviteError || !invitation) {
      return res.status(400).json({ error: 'Invalid or expired invitation token' });
    }
    
    const email = invitation.email;
    const role = invitation.role;
    
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        role,
        college_id: invitation.college_id
      }
    });
    
    if (authError) {
      return res.status(500).json({ error: authError.message });
    }
    
    await supabase
      .from('invitations')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('token', token);
    
    res.json({
      success: true,
      message: 'Account created successfully',
      user_id: authData.user.id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// NOTE: POST /api/auth/register-driver is defined later (line ~660) with full validation.
// The incomplete early duplicate has been removed.

app.post('/api/auth/login-admin', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Input validation
    if (!username || !password ||
        typeof username !== 'string' || typeof password !== 'string' ||
        username.length > 64 || password.length > 128) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    
    // Check credentials against the hashed password
    const { data: adminData, error: adminError } = await supabase
      .from('admins')
      .select('id, username, password_hash, institution_id')
      .eq('username', username)
      .single();

    if (adminError && adminError.code !== 'PGRST116') {
      console.error('[login-admin] DB Error:', adminError);
      return res.status(500).json({ error: 'Database connection failed. Please try again later.' });
    }

    if (!adminData) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const validPassword = await bcrypt.compare(password, adminData.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    if (!adminData.institution_id) {
      return res.status(403).json({ error: 'Admin account has no institution assigned' });
    }

    const { data: inst, error: instErr } = await supabase
      .from('institutions')
      .select('id, status')
      .eq('id', adminData.institution_id)
      .single();

    if (instErr || !inst || inst.status !== 'active') {
      return res.status(403).json({ error: 'Associated institution is inactive or suspended' });
    }

    const token = jwt.sign(
      { 
        user_id: adminData.id || username, 
        username, 
        role: 'admin',
        institution_id: adminData.institution_id 
      }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );
    res.json({ success: true, token, username });
  } catch (error) {
    console.error('[login-admin] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login-driver', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Input validation
    if (!username || !password ||
        typeof username !== 'string' || typeof password !== 'string' ||
        username.length > 64 || password.length > 128) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Check credentials against the hashed password
    const { data: driverData, error: driverError } = await supabase
      .from('drivers')
      .select('id, username, password_hash, assigned_bus, institution_id')
      .eq('username', username)
      .single();

    if (driverError && driverError.code !== 'PGRST116') {
      console.error('[login-driver] DB Error:', driverError);
      return res.status(500).json({ error: 'Database connection failed. Please try again later.' });
    }

    if (!driverData) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const validPassword = await bcrypt.compare(password, driverData.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!driverData.institution_id) {
      return res.status(403).json({ error: 'Driver account has no institution assigned' });
    }

    const { data: inst, error: instErr } = await supabase
      .from('institutions')
      .select('id, status')
      .eq('id', driverData.institution_id)
      .single();

    if (instErr || !inst || inst.status !== 'active') {
      return res.status(403).json({ error: 'Associated institution is inactive or suspended' });
    }

    const token = jwt.sign(
      { 
        user_id: driverData.id, 
        username, 
        role: 'driver', 
        assignedBus: driverData.assigned_bus,
        institution_id: driverData.institution_id 
      }, 
      JWT_SECRET, 
      { expiresIn: '5d' }
    );

    // Register driver session in realtime SECURELY on the backend
    if (driverData.assigned_bus) {
      await supabase.from('driver_sessions').upsert({
        bus_id: driverData.assigned_bus,
        driver_name: username,
        is_online: true,
        last_seen: new Date().toISOString()
      }, { onConflict: 'bus_id' });
    }

    res.json({ 
      success: true, 
      token, 
      driver: { id: driverData.id, username, assignedBus: driverData.assigned_bus } 
    });
  } catch (error) {
    console.error('[login-driver] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout-driver', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.assignedBus) {
      // 1. Mark driver session offline
      await supabase.from('driver_sessions').update({ is_online: false }).eq('bus_id', decoded.assignedBus);
      // 2. End any active trip for this bus
      await supabase.from('trips').update({ status: 'completed' })
        .eq('bus_id', decoded.assignedBus)
        .eq('status', 'active');
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[logout-driver] Error:', error);
    res.status(401).json({ success: false });
  }
});

app.get('/api/auth/verify', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ valid: false });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // ACTIVE DATABASE CHECK FOR HIGH SECURITY
    if (decoded.role === 'admin') {
      const { data } = await supabase.from('admins').select('id').eq('username', decoded.username).single();
      if (!data) return res.status(401).json({ valid: false });
    } else if (decoded.role === 'driver') {
      const { data } = await supabase.from('drivers').select('id').eq('id', decoded.user_id).single();
      if (!data) return res.status(401).json({ valid: false });
    }

    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ valid: false });
  }
});

// STUDENT / FACULTY LOGIN via GOOGLE
app.post('/api/auth/google', async (req, res) => {
  try {
    const { token: googleToken } = req.body;
    
    if (!googleToken) {
      return res.status(400).json({ error: 'Missing token' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: googleToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email.toLowerCase();

    // All verified Google users are allowed - no access restrictions
    // 2. Check Students table
    let { data: studentData, error: studentError } = await supabase
      .from('students')
      .select('id, email')
      .eq('email', email)
      .limit(1)
      .maybeSingle();

    if (studentError) {
      console.error('[auth-google] Error checking students table:', studentError);
      return res.status(500).json({ error: 'Database connection failed. Please try again later.' });
    }

    if (studentData) {
      const token = jwt.sign(
        { user_id: studentData.id, email, role: 'student' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      return res.json({ success: true, token, role: 'student', user: studentData });
    }

    // Check Faculty table
    let { data: facultyData, error: facultyError } = await supabase
      .from('faculty')
      .select('id, email')
      .eq('email', email)
      .limit(1)
      .maybeSingle();

    if (facultyError) {
      console.error('[auth-google] Error checking faculty table:', facultyError);
      return res.status(500).json({ error: 'Database connection failed. Please try again later.' });
    }

    if (facultyData) {
      const token = jwt.sign(
        { user_id: facultyData.id, email, role: 'faculty' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      return res.json({ success: true, token, role: 'faculty', user: facultyData });
    }

    // If not found in either student or faculty, auto-register as a student
    const { data: newStudent, error: insertError } = await supabase
      .from('students')
      .insert([{ id: crypto.randomUUID(), email }])
      .select('id, email')
      .single();

    if (insertError) {
      console.error('[auth-google] Auto-registration failed:', insertError);
      return res.status(500).json({ error: 'Failed to auto-register Google account' });
    }

    const token = jwt.sign(
      { user_id: newStudent.id, email, role: 'student' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.json({ success: true, token, role: 'student', user: newStudent });
  } catch (error) {
    console.error('[auth-google] Error:', error);
    res.status(500).json({ error: 'Internal server error during Google Sign-In' });
  }
});

// REGISTER / UPDATE DRIVER CREDENTIALS (Admin only)
app.post('/api/auth/register-driver', requireRole(['admin']), async (req, res) => {
  try {
    const { username, password, busId } = req.body;

    if (!username || !password || !busId) {
      return res.status(400).json({ error: 'username, password, and busId are required.' });
    }
    if (typeof username !== 'string' || username.length > 64) {
      return res.status(400).json({ error: 'Invalid username.' });
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be 6–128 characters.' });
    }

    const password_hash = await bcrypt.hash(password, 12);

    // Check if a driver for this bus already exists
    const { data: existing } = await supabase
      .from('drivers')
      .select('id')
      .eq('assigned_bus', busId)
      .single();

    let result;
    if (existing) {
      // Update existing driver's credentials
      result = await supabase
        .from('drivers')
        .update({ username, password_hash })
        .eq('assigned_bus', busId)
        .select();
    } else {
      // Insert new driver record
      result = await supabase
        .from('drivers')
        .insert({ username, password_hash, assigned_bus: busId })
        .select();
    }

    if (result.error) {
      console.error('[register-driver] Supabase error:', result.error);
      return res.status(500).json({ error: 'Internal server error' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[register-driver] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// VALIDATE INVITATION TOKEN
app.get('/api/auth/validate-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    const { data, error } = await supabase
      .from('invitations')
      .select('email, role, expires_at')
      .eq('token', token)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .single();
    
    if (error || !data) {
      return res.status(400).json({ valid: false, error: 'Invalid or expired token' });
    }
    
    res.json({
      valid: true,
      email: data.email,
      role: data.role,
      expires_at: data.expires_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PROTECTED ENDPOINTS - ROLE-BASED
// ============================================================================

app.post('/api/trip/start', requireRole(['driver']), async (req, res) => {
  try {
    const { bus_id, trip_type } = req.body;

    if (!bus_id) {
      return res.status(400).json({ error: 'bus_id is required' });
    }

    if (req.user.assignedBus) {
      const normAssigned = String(req.user.assignedBus).replace(/^Bus\s*/i, '').trim().toLowerCase();
      const normRequested = String(bus_id).replace(/^Bus\s*/i, '').trim().toLowerCase();
      if (normAssigned !== normRequested) {
        return res.status(403).json({ error: 'Forbidden: You can only start a trip for your assigned bus.' });
      }
    }
    const driver_id = req.user.user_id;

    if (!req.user.institution_id) {
      return res.status(403).json({ error: 'Driver has no valid institution assigned' });
    }

    // Verify bus belongs to the driver's institution
    const { data: busData, error: busError } = await supabase
      .from('buses')
      .select('id, driver_name, institution_id')
      .eq('id', bus_id)
      .single();

    if (busError || !busData) {
      return res.status(404).json({ error: 'Bus not found' });
    }

    if (busData.institution_id && busData.institution_id !== req.user.institution_id) {
      return res.status(403).json({ error: 'Forbidden: Bus does not belong to your institution' });
    }

    const { data, error } = await supabase
      .from('trips')
      .insert({
        bus_id,
        trip_type,
        driver_id,
        institution_id: req.user.institution_id,
        status: 'active',
        started_at: new Date().toISOString()
      })
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, trip: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/trip/end', requireRole(['driver']), async (req, res) => {
  try {
    const { trip_id } = req.body;
    const driver_id = req.user.user_id;

    const { data: tripData, error: tripError } = await supabase
      .from('trips')
      .select('*')
      .eq('id', trip_id)
      .eq('driver_id', driver_id)
      .single();

    if (tripError || !tripData) {
      return res.status(403).json({ error: 'You did not start this trip' });
    }

    const { data, error } = await supabase
      .from('trips')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', trip_id)
      .select();

    if (error) return res.status(500).json({ error: error.message });

    const updatedTrip = data && data[0];
    if (tripData?.bus_id) {
      const busNum = String(tripData.bus_id).replace(/\D/g, '');
      const searchId = busNum ? `Bus ${busNum}` : tripData.bus_id;
      await supabase
        .from('current_bus_locations')
        .update({ speed_kmh: 0, updated_at: new Date().toISOString() })
        .or(`bus_id.eq."${searchId}",bus_id.eq."Bus${busNum}",bus_id.eq."${tripData.bus_id}"`);
    }

    res.json({ success: true, trip: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ANALYTICS API
// ============================================================================
app.get('/api/analytics', requireRole(['admin']), async (req, res) => {
  try {
    const { data: history, error } = await supabase
      .from('trips')
      .select('id, bus_id, trip_type, status, started_at, completed_at, driver_id')
      .eq('status', 'completed')
      .order('started_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    // Enrich with bus route names
    const busIds = [...new Set(history.map(t => t.bus_id))];
    let buses = [];
    if (busIds.length > 0) {
      const { data } = await supabase.from('buses').select('id, route_name, driver_name').in('id', busIds);
      if (data) buses = data;
    }
    const busMap = {};
    buses.forEach(b => { busMap[b.id] = b; });

    const enriched = history.map(t => {
      let timeBasedRoute = 'Unknown';
      if (t.started_at) {
        const hour = new Date(t.started_at).getHours();
        timeBasedRoute = hour < 12 ? 'morning' : 'evening';
      }
      
      return {
        ...t,
        route_name: busMap[t.bus_id]?.route_name || timeBasedRoute,
        driver_name: busMap[t.bus_id]?.driver_name || 'Unknown',
        start_time: t.started_at,
        end_time: t.completed_at
      };
    });

    res.json({ success: true, history: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/analytics/clear', requireRole(['admin']), async (req, res) => {
  try {
    const { error } = await supabase
      .from('trips')
      .delete()
      .eq('status', 'completed');
      
    if (error) throw error;

    await supabase.from('admin_logs').insert({
      admin_username: req.user.username,
      action_text: 'Cleared trip analytics history'
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




app.get('/api/trip/:trip_id/info', requireRole(['student', 'faculty']), async (req, res) => {
    try {
      const { trip_id } = req.params;
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('id', trip_id)
        .single();
      if (error || !data) {
        return res.status(404).json({ error: 'Trip not found' });
      }
      res.json({ success: true, trip: data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.get('/api/admin/users', requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('auth.users')
      .select('id, email, user_metadata');
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, users: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PUBLIC ENDPOINTS FOR STUDENT PORTAL / LIVE MAPS
// ============================================================================

app.get('/api/trip/:bus_id', async (req, res) => {
  try {
    const { bus_id } = req.params;
    const busNum = String(bus_id).replace(/\D/g, '');
    const searchId = busNum ? `Bus ${busNum}` : bus_id;

    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .or(`bus_id.eq."${searchId}",bus_id.eq."Bus${busNum}",bus_id.eq."${bus_id}"`)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, trip: data && data.length > 0 ? data[0] : null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/location/bus/:bus_id', async (req, res) => {
  try {
    const { bus_id } = req.params;
    const busNum = String(bus_id).replace(/\D/g, '');
    const searchId = busNum ? `Bus ${busNum}` : bus_id;
    
    const { data, error } = await supabase
      .from('current_bus_locations')
      .select('*')
      .or(`bus_id.eq."${searchId}",bus_id.eq."Bus${busNum}",bus_id.eq."${bus_id}"`)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json({ success: true, location: (data && data.length > 0) ? data[0] : null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/public/buses', async (req, res) => {
  try {
    const institutionId = req.query.institution_id;
    if (!institutionId) {
      return res.status(400).json({ error: 'institution_id parameter is required' });
    }

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(institutionId)) {
      return res.status(400).json({ error: 'Invalid institution_id format' });
    }

    // Check institution is active
    const { data: inst, error: instErr } = await supabase
      .from('institutions')
      .select('id, status')
      .eq('id', institutionId)
      .single();

    if (instErr || !inst || inst.status !== 'active') {
      return res.status(404).json({ error: 'Institution not found or inactive' });
    }

    const [busesRes, sessionsRes, tripsRes] = await Promise.all([
      supabase.from('buses').select('*').eq('institution_id', institutionId).order('id'),
      supabase.from('driver_sessions').select('*').eq('institution_id', institutionId),
      supabase.from('trips').select('bus_id').eq('status', 'active').eq('institution_id', institutionId)
    ]);

    if (busesRes.error) {
      console.error('[public/buses] DB Error:', busesRes.error);
      return res.status(503).json({ error: 'Database service unavailable' });
    }

    res.json({
      success: true,
      buses: busesRes.data || [],
      sessions: sessionsRes.data || [],
      activeTrips: tripsRes.data || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/public/bus-status/:bus_id', async (req, res) => {
  try {
    const { bus_id } = req.params;
    const { trip_id } = req.query; // optional
    const busNum = String(bus_id).replace(/\D/g, '');
    const searchId = busNum ? `Bus ${busNum}` : bus_id;

    const [busRes, sessionRes, locRes] = await Promise.all([
      supabase.from('buses').select('driver_name').or(`id.eq."${searchId}",id.eq."Bus${busNum}",id.eq."${bus_id}"`).limit(1),
      supabase.from('driver_sessions').select('driver_name, is_online, last_seen').or(`bus_id.eq."${searchId}",bus_id.eq."Bus${busNum}",bus_id.eq."${bus_id}"`).order('last_seen', { ascending: false }).limit(1),
      supabase.from('current_bus_locations').select('*').or(`bus_id.eq."${searchId}",bus_id.eq."Bus${busNum}",bus_id.eq."${bus_id}"`).order('updated_at', { ascending: false }).limit(1)
    ]);

    let tripStatus = null;
    if (trip_id) {
      const { data } = await supabase.from('trips').select('status').eq('id', trip_id).limit(1);
      tripStatus = (data && data.length > 0) ? data[0].status : null;
    }

    const busData = busRes.data && busRes.data.length > 0 ? busRes.data[0] : null;
    const sessionData = sessionRes.data && sessionRes.data.length > 0 ? sessionRes.data[0] : null;
    const locData = locRes.data && locRes.data.length > 0 ? locRes.data[0] : null;

    // Server-computed online status & movement status
    const now = Date.now();
    const lastSeenTime = sessionData?.last_seen ? new Date(sessionData.last_seen).getTime() : 0;
    const isOnlineFresh = (now - lastSeenTime) < DRIVER_OFFLINE_THRESHOLD_MS;
    const isOnline = Boolean(sessionData?.is_online && isOnlineFresh);

    const locTime = locData?.updated_at ? new Date(locData.updated_at).getTime() : 0;
    const locAgeSec = locTime ? Math.round((now - locTime) / 1000) : null;
    const speed = locData?.speed_kmh || 0;

    let movementStatus = 'OFFLINE';
    if (isOnline || (locAgeSec !== null && locAgeSec < 120)) {
      movementStatus = (speed < 4) ? 'STOPPED' : 'MOVING';
    }

    res.json({
      success: true,
      bus_driver: busData ? busData.driver_name : null,
      session_driver: sessionData ? sessionData.driver_name : null,
      is_online: isOnline,
      trip_status: tripStatus,
      movement_status: movementStatus,
      speed_kmh: speed,
      last_location_age_seconds: locAgeSec,
      location: locData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SERVER-SIDE REVERSE GEOCODING PROXY WITH IN-MEMORY CACHE
// Eliminates browser-to-Nominatim direct calls, prevents CORS & campus IP bans
// ============================================================================
const geocodeProxyCache = new Map();
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

app.get('/api/geocode/reverse', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    const nLat = parseFloat(lat);
    const nLon = parseFloat(lon);
    if (isNaN(nLat) || isNaN(nLon) || nLat < -90 || nLat > 90 || nLon < -180 || nLon > 180) {
      return res.status(400).json({ error: 'Valid lat and lon coordinates are required.' });
    }

    // Cache key rounded to ~110m (3 decimal places)
    const key = `${nLat.toFixed(3)},${nLon.toFixed(3)}`;
    const cached = geocodeProxyCache.get(key);
    if (cached && (Date.now() - cached.timestamp < GEOCODE_CACHE_TTL_MS)) {
      return res.json({ success: true, displayName: cached.displayName, shortName: cached.shortName, cached: true });
    }

    const url = `https://nominatim.openstreetmap.org/reverse?lat=${nLat}&lon=${nLon}&format=json`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'WhereIsMyBus-Server/1.0 (campus-transit-tracking)'
      },
      signal: AbortSignal.timeout(4000)
    });

    if (!response.ok) {
      throw new Error(`Nominatim returned status ${response.status}`);
    }

    const data = await response.json();
    const displayName = data?.display_name || `${nLat.toFixed(4)}° N, ${nLon.toFixed(4)}° E`;
    const shortName = data?.display_name ? data.display_name.split(',').slice(0, 2).join(', ') : displayName;

    geocodeProxyCache.set(key, { displayName, shortName, timestamp: Date.now() });

    // Limit cache size to prevent memory leaks (max 3000 entries)
    if (geocodeProxyCache.size > 3000) {
      const oldestKey = geocodeProxyCache.keys().next().value;
      geocodeProxyCache.delete(oldestKey);
    }

    res.json({ success: true, displayName, shortName, cached: false });
  } catch (err) {
    console.warn('[Geocode Proxy] Fallback used:', err.message);
    const nLat = parseFloat(req.query.lat) || 0;
    const nLon = parseFloat(req.query.lon) || 0;
    const fallback = `${nLat.toFixed(4)}° N, ${nLon.toFixed(4)}° E`;
    res.json({ success: true, displayName: fallback, shortName: fallback, cached: false });
  }
});

// ============================================================================
// DRIVER-TO-BUS VALIDATION & LOCATION ENDPOINTS (WITH GPS SANITY & DELTA SPEED)
// ============================================================================

app.post('/api/location/submit', requireRole(['driver']), async (req, res) => {
  const { latitude, longitude, speed_kmh, trip_id, bus_id, source_role, source_user_id } = req.body;
  const driver_id = req.user.user_id;

  try {
    // 1. Coordinates validation
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Invalid GPS coordinates.' });
    }

    // 2. SECURITY CHECK: Verify this driver actually started this active trip
    const { data: tripData, error: tripError } = await supabase
      .from('trips')
      .select('id, status')
      .eq('id', trip_id)
      .eq('driver_id', driver_id)
      .eq('bus_id', bus_id)
      .single();

    if (tripError || !tripData) {
      return res.status(403).json({ error: 'Forbidden: You do not have ownership of this active trip or bus.' });
    }

    if (tripData.status !== 'active') {
      return res.status(400).json({ error: 'Trip is no longer active.' });
    }

    // 3. Existing location row check for delta computation & hot-table overwrite
    const { data: existingLoc } = await supabase
      .from('current_bus_locations')
      .select('bus_id, latitude, longitude, updated_at')
      .eq('bus_id', bus_id)
      .single();

    let verifiedSpeed = (typeof speed_kmh === 'number' && !isNaN(speed_kmh) && speed_kmh >= 0) ? speed_kmh : 0;
    
    // Server-side velocity validation & anti-teleportation check
    if (existingLoc && existingLoc.latitude && existingLoc.longitude && existingLoc.updated_at) {
      const prevLat = parseFloat(existingLoc.latitude);
      const prevLon = parseFloat(existingLoc.longitude);
      const prevTime = new Date(existingLoc.updated_at).getTime();
      const timeDeltaSec = (Date.now() - prevTime) / 1000;

      if (timeDeltaSec > 0 && timeDeltaSec < 120) {
        const distMeters = haversineMeters(prevLat, prevLon, lat, lon);
        const calculatedSpeedKmh = (distMeters / timeDeltaSec) * 3.6;

        // If distance jumped > 3km in < 10 seconds (teleportation/glitch), reject jump
        if (distMeters > 3000 && calculatedSpeedKmh > 180) {
          console.warn(`[GPS Sanity] Anomalous GPS teleport rejected for ${bus_id}: jumped ${distMeters.toFixed(0)}m in ${timeDeltaSec.toFixed(1)}s`);
          return res.status(400).json({ error: 'GPS anomaly detected: impossible position jump rejected.' });
        }

        // If client reported 0 or missing speed, use server-computed speed
        if (!speed_kmh || speed_kmh <= 0) {
          verifiedSpeed = Math.round(calculatedSpeedKmh);
        }
      }
    }

    // 4. Update driver session heartbeat automatically with location ping
    await supabase.from('driver_sessions').update({
      is_online: true,
      last_seen: new Date().toISOString()
    }).eq('bus_id', bus_id);

    // 5. Hot table overwrite
    let data, error;
    if (existingLoc) {
      ({ data, error } = await supabase.from('current_bus_locations').update({
        trip_id,
        source_role: 'driver',
        source_user_id: driver_id,
        latitude: lat,
        longitude: lon,
        speed_kmh: verifiedSpeed,
        updated_at: new Date().toISOString()
      })
      .eq('bus_id', bus_id)
      .select());
    } else {
      ({ data, error } = await supabase.from('current_bus_locations').insert({
        trip_id,
        bus_id,
        source_role: 'driver',
        source_user_id: driver_id,
        latitude: lat,
        longitude: lon,
        speed_kmh: verifiedSpeed,
        updated_at: new Date().toISOString()
      }).select());
    }

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, data: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// ADMIN MIGRATED ENDPOINTS (Replaces Direct Supabase Frontend Mutations)
// ============================================================================

app.post('/api/admin/buses', requireRole(['admin']), async (req, res) => {
  try {
    const { id, isNew, busPayload } = req.body;
    let data, error;
    if (isNew) {
      busPayload.id = id;
      ({ data, error } = await supabase.from('buses').insert(busPayload).select());
    } else {
      ({ data, error } = await supabase.from('buses').update(busPayload).eq('id', id).select());
    }
    if (error) {
      console.error('[Admin Buses Error]', error);
      return res.status(500).json({ error: `Database Error: ${error.message}` });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Admin Buses Exception]', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/buses/:id', requireRole(['admin']), async (req, res) => {
  try {
    const busId = req.params.id;
    // Handle cascading deletions securely via backend
    await supabase.from('driver_sessions').delete().eq('bus_id', busId);
    await supabase.from('drivers').update({ assigned_bus: null }).eq('assigned_bus', busId);
    const { data, error } = await supabase.from('buses').delete().eq('id', busId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/logs', requireRole(['admin']), async (req, res) => {
  try {
    const { action_text } = req.body;
    const admin_username = req.user.username;
    const { data, error } = await supabase.from('admin_logs').insert({ admin_username, action_text }).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/logs', requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabase.from('admin_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/dashboard-data', requireRole(['admin']), async (req, res) => {
  try {
    // Fetch all admin dashboard data in one go securely via Service Role
    const [busesRes, sessionsRes, logsRes, sosRes] = await Promise.all([
      supabase.from('buses').select('*').order('id').limit(100),
      supabase.from('driver_sessions').select('*').limit(100),
      supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('sos_alerts').select('*').eq('status', 'active')
    ]);

    if (busesRes.error) throw busesRes.error;

    res.json({
      success: true,
      buses: busesRes.data || [],
      sessions: sessionsRes.data || [],
      logs: logsRes.data || [],
      sosAlerts: sosRes.data || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// DRIVER MIGRATED ENDPOINTS (Replaces Direct Supabase Frontend Mutations)
// ============================================================================

app.post('/api/trip/heartbeat', requireRole(['driver']), async (req, res) => {
  try {
    const { bus_id } = req.body;

    // Ownership check: driver can only heartbeat their own assigned bus
    if (req.user.assignedBus && bus_id !== req.user.assignedBus) {
      return res.status(403).json({ error: 'Forbidden: Bus does not belong to this driver.' });
    }

    const { error } = await supabase.from('driver_sessions').update({ 
      is_online: true, 
      last_seen: new Date().toISOString() 
    }).eq('bus_id', bus_id);
    if (error) return res.status(500).json({ error: 'Internal server error' });
    res.json({ success: true });
  } catch (err) {
    console.error('[heartbeat] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/trip/sos', requireRole(['driver']), async (req, res) => {
  try {
    const { bus_id, latitude, longitude } = req.body;

    // Input validation on coordinates
    if (latitude !== null && latitude !== undefined && (typeof latitude !== 'number' || latitude < -90 || latitude > 90)) {
      return res.status(400).json({ error: 'Invalid latitude value.' });
    }
    if (longitude !== null && longitude !== undefined && (typeof longitude !== 'number' || longitude < -180 || longitude > 180)) {
      return res.status(400).json({ error: 'Invalid longitude value.' });
    }

    const driver_name = req.user.username;
    const { data, error } = await supabase.from('sos_alerts').insert({
      bus_id, driver_name, latitude, longitude, status: 'active'
    }).select();
    if (error) return res.status(500).json({ error: 'Internal server error' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[sos] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/admin/sos-alerts', requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sos_alerts')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/sos-alerts/:bus_id/resolve', requireRole(['admin']), async (req, res) => {
  try {
    const busId = req.params.bus_id;
    const { error } = await supabase
      .from('sos_alerts')
      .update({ status: 'resolved' })
      .eq('bus_id', busId)
      .eq('status', 'active');
      
    if (error) return res.status(500).json({ error: error.message });
    
    await supabase.from('admin_logs').insert({
      admin_username: req.user.username,
      action_text: `Resolved SOS alert for ${busId}`
    });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trip/stop-arrival', requireRole(['driver']), async (req, res) => {
  try {
    const { trip_id, stop_name, stop_index } = req.body;
    
    // Check if exists
    const { data: existing } = await supabase.from('stop_arrivals').select('id').eq('trip_id', trip_id).eq('stop_index', stop_index).single();
    if (existing) {
      return res.json({ success: true, message: 'Already recorded' });
    }

    const { data, error } = await supabase.from('stop_arrivals').insert({
      trip_id, stop_name, stop_index
    }).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/trip/stop-index', requireRole(['driver']), async (req, res) => {
  try {
    const { trip_id, stop_index } = req.body;
    const driver_id = req.user.user_id;
    
    // Check ownership
    const { data: trip } = await supabase.from('trips').select('id').eq('id', trip_id).eq('driver_id', driver_id).single();
    if (!trip) return res.status(403).json({ error: 'Not your trip' });

    const { data, error } = await supabase.from('trips').update({ current_stop_index: stop_index }).eq('id', trip_id).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ============================================================================
// CHAT API
// ============================================================================

// GET all messages for a bus (admin + driver can read)
app.get('/api/chat/:busId', requireRole(['admin', 'driver']), async (req, res) => {
  try {
    const { busId } = req.params;
    const { data: messages, error } = await supabase
      .from('driver_messages')
      .select('*')
      .eq('bus_id', busId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;

    // Check SOS status
    const { data: sosAlerts } = await supabase
      .from('sos_alerts')
      .select('id')
      .eq('bus_id', busId)
      .eq('status', 'active');

    const isSosActive = sosAlerts && sosAlerts.length > 0;
    res.json({ success: true, messages: messages || [], isSosActive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST send message — DRIVER ONLY (admin is read-only)
app.post('/api/chat/send', requireRole(['driver']), async (req, res) => {
  try {
    const { bus_id, message } = req.body;
    if (!bus_id || !message) return res.status(400).json({ error: 'bus_id and message required' });
    if (typeof message !== 'string' || message.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 chars)' });
    }

    const sender_role = req.user.role; // always 'driver'
    const { data, error } = await supabase
      .from('driver_messages')
      .insert([{ bus_id, message: message.trim(), sender_role }])
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST upload voice message — DRIVER & ADMIN
app.post('/api/chat/upload-voice', requireRole(['driver', 'admin']), async (req, res) => {
  try {
    const { bus_id, audio_base64, mime_type } = req.body;
    if (!bus_id || !audio_base64) {
      return res.status(400).json({ error: 'bus_id and audio_base64 are required' });
    }

    const mime = mime_type || 'audio/webm';
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : 'webm';
    const buffer = Buffer.from(audio_base64, 'base64');

    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Voice message exceeds 10MB limit' });
    }

    const fileName = `voice_${bus_id.replace(/\s+/g, '_')}_${Date.now()}.${ext}`;

    // Upload with service role key (bypasses RLS issues on chat-audio bucket)
    const { error: uploadErr } = await supabase.storage
      .from('chat-audio')
      .upload(fileName, buffer, {
        contentType: mime,
        upsert: false
      });

    if (uploadErr) {
      console.error('[Chat Voice] Supabase storage upload failed:', uploadErr);
      return res.status(500).json({ error: uploadErr.message });
    }

    const { data: { publicUrl } } = supabase.storage
      .from('chat-audio')
      .getPublicUrl(fileName);

    const sender_role = req.user.role;
    const { data, error } = await supabase
      .from('driver_messages')
      .insert([{ bus_id, message: `[VOICE]:${publicUrl}`, sender_role }])
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, publicUrl, data });
  } catch (err) {
    console.error('[Chat Voice] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE single message — driver can delete own messages, admin can delete any message
app.delete('/api/chat/message/:id', requireRole(['admin', 'driver']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Admin bypasses ownership check
    if (req.user.role === 'admin') {
      const { error } = await supabase.from('driver_messages').delete().eq('id', id);
      if (error) throw error;
      return res.json({ success: true });
    }

    // Driver ownership check
    const { data: msg, error: fetchErr } = await supabase
      .from('driver_messages')
      .select('id, bus_id, sender_role')
      .eq('id', id)
      .single();
    if (fetchErr || !msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.bus_id !== req.user.assignedBus) {
      return res.status(403).json({ error: 'Forbidden: not your bus' });
    }
    const { error } = await supabase.from('driver_messages').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE all messages for a bus — admin only (Clear Chat button)
app.delete('/api/chat/:busId', requireRole(['admin']), async (req, res) => {
  try {
    const { busId } = req.params;
    const { error } = await supabase
      .from('driver_messages')
      .delete()
      .eq('bus_id', busId);
    if (error) throw error;
    await supabase.from('admin_logs').insert({
      admin_username: req.user.username,
      action_text: `Cleared chat history for ${busId}`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE trip-end auto-clear — driver calls this when trip ends
app.delete('/api/chat/:busId/trip-end', requireRole(['driver']), async (req, res) => {
  try {
    const { busId } = req.params;
    // Only clear if driver owns this bus
    if (busId !== req.user.assignedBus) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { error } = await supabase
      .from('driver_messages')
      .delete()
      .eq('bus_id', busId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// DESTINATION MANAGEMENT (Admin sets it, students read it)
// ============================================================================

// GET current destination — public, no auth needed
app.get('/api/public/destination', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('destinations')
      .select('*')
      .eq('id', 1)
      .single();
    if (error || !data) {
      return res.json({ success: false, destination: null });
    }
    res.json({ success: true, destination: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET current destination — admin view
app.get('/api/admin/destination', requireRole(['admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('destinations')
      .select('*')
      .eq('id', 1)
      .single();
    if (error) throw error;
    res.json({ success: true, destination: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST save/update destination — admin only
app.post('/api/admin/destination', requireRole(['admin']), async (req, res) => {
  try {
    const { name, latitude, longitude } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Destination name must be at least 2 characters.' });
    }
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (isNaN(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'Invalid latitude. Must be between -90 and 90.' });
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Invalid longitude. Must be between -180 and 180.' });
    }

    const { data, error } = await supabase
      .from('destinations')
      .upsert({
        id: 1,
        name: name.trim(),
        latitude: lat,
        longitude: lon,
        updated_at: new Date().toISOString(),
        updated_by: req.user.username
      }, { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;

    // Log the action
    await supabase.from('admin_logs').insert({
      admin_username: req.user.username,
      action_text: `Set destination to: ${name.trim()} (${lat.toFixed(4)}, ${lon.toFixed(4)})`
    });

    // Invalidate routing cache for all buses when destination changes
    routeCache.clear();
    // Also invalidate the shared ETA cache and update in-memory destination
    await ETACache.invalidateAll();
    ETAPollerManager.setDestination(data);

    res.json({ success: true, destination: data });
  } catch (err) {
    console.error('[destination] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ORS ROUTING PROXY — Road-Based Distance & ETA
// ============================================================================
// Protects ORS API key server-side. 
// Caches results per bus for 30s to avoid hitting free tier limits.
// Only re-fetches when bus moves >150m or cache expires.
// ============================================================================

// In-memory route cache: key = "busId" → { result, timestamp, busLat, busLon }
const routeCache = new Map();
const inFlightRequests = new Map(); // Add this line to prevent cache stampedes!
const ROUTE_CACHE_TTL_MS = 30000;  // 30 seconds
const ROUTE_MIN_MOVE_M   = 150;    // Re-fetch only if bus moved this far

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// GET road route info: distance + duration from bus to destination
// INTERNAL USE ONLY — called by ETAPollerManager, NOT by student browsers.
// Students receive ETA via Supabase Realtime broadcast or GET /api/buses/:busId/eta.
app.get('/api/route/eta', async (req, res) => {
  try {
    const { fromLat, fromLon, toLat, toLon, busId } = req.query;

    const bLat = parseFloat(fromLat);
    const bLon = parseFloat(fromLon);
    const dLat = parseFloat(toLat);
    const dLon = parseFloat(toLon);

    if ([bLat, bLon, dLat, dLon].some(isNaN)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    const cacheKey = busId || `${bLat.toFixed(4)},${bLon.toFixed(4)}`;
    const cached = routeCache.get(cacheKey);
    const now = Date.now();

    // Return cached result if fresh AND bus hasn't moved significantly
    if (cached) {
      const age   = now - cached.timestamp;
      const moved = haversineMeters(cached.busLat, cached.busLon, bLat, bLon);
      if (age < ROUTE_CACHE_TTL_MS && moved < ROUTE_MIN_MOVE_M) {
        return res.json({ success: true, ...cached.result, cached: true });
      }
    }

    const ORS_KEY = process.env.ORS_API_KEY;
    if (!ORS_KEY || ORS_KEY === 'your_openrouteservice_api_key_here') {
      // Fallback: return haversine estimate so the UI still works
      const dist = haversineMeters(bLat, bLon, dLat, dLon);
      const fallback = {
        road_distance_m:  dist * 1.25,
        road_distance_km: ((dist * 1.25) / 1000).toFixed(1),
        duration_s:       (dist * 1.25) / (30 / 3.6),
        source: 'haversine_fallback'
      };
      routeCache.set(cacheKey, { result: fallback, timestamp: now, busLat: bLat, busLon: bLon });
      return res.json({ success: true, ...fallback, cached: false });
    }

    // --- CACHE STAMPEDE PREVENTION ---
    if (inFlightRequests.has(cacheKey)) {
      try {
        const inFlightResult = await inFlightRequests.get(cacheKey);
        return res.json({ success: true, ...inFlightResult, cached: true });
      } catch (e) {
        // Fallthrough on error
      }
    }

    const fetchPromise = (async () => {
      const orsUrl = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${ORS_KEY}&start=${bLon},${bLat}&end=${dLon},${dLat}`;
      const orsRes = await fetch(orsUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });

      if (!orsRes.ok) {
        const errText = await orsRes.text();
        throw new Error(`ORS ${orsRes.status}: ${errText.slice(0, 200)}`);
      }

      const orsData = await orsRes.json();
      const segment = orsData?.features?.[0]?.properties?.segments?.[0];
      const summary = orsData?.features?.[0]?.properties?.summary;

      const road_distance_m = summary?.distance || segment?.distance || 0;
      const duration_s      = summary?.duration  || segment?.duration  || 0;

      const result = {
        road_distance_m,
        road_distance_km: (road_distance_m / 1000).toFixed(1),
        duration_s,
        source: 'ors'
      };

      routeCache.set(cacheKey, { result, timestamp: now, busLat: bLat, busLon: bLon });
      return result;
    })();

    inFlightRequests.set(cacheKey, fetchPromise);
    
    try {
      const result = await fetchPromise;
      res.json({ success: true, ...result, cached: false });
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  } catch (err) {
    console.error('[route/eta] Error:', err.message);
    // Always return something so UI doesn't break
    const bLat = parseFloat(req.query.fromLat) || 0;
    const bLon = parseFloat(req.query.fromLon) || 0;
    const dLat = parseFloat(req.query.toLat)   || 0;
    const dLon = parseFloat(req.query.toLon)   || 0;
    const dist = haversineMeters(bLat, bLon, dLat, dLon);
    res.json({
      success: true,
      road_distance_m:  dist * 1.25,
      road_distance_km: ((dist * 1.25) / 1000).toFixed(1),
      duration_s:       (dist * 1.25) / (30 / 3.6),
      source: 'haversine_fallback',
      cached: false
    });
  }
});

// ============================================================================
// SHARED ETA VIEWER ENDPOINTS
// Students register as viewers, get heartbeat, and receive ETA via Realtime.
// This is the NEW architecture — replaces per-student /api/route/eta calls.
// ============================================================================

function formatETADuration(minutes) {
  if (minutes == null || isNaN(minutes) || minutes < 0) return '--';
  const totalMins = Math.round(minutes);
  if (totalMins <= 1) return '1 min';
  if (totalMins < 60) return `${totalMins} min`;
  const hours = Math.floor(totalMins / 60);
  const remainingMins = totalMins % 60;
  if (remainingMins === 0) return `${hours} hr`;
  return `${hours} hr ${remainingMins} min`;
}

// POST /api/buses/:busId/view — Register as an active viewer of a bus
// Returns sessionId the client must use for heartbeat and unregister calls.
app.post('/api/buses/:busId/view', verifyRole, (req, res) => {
  try {
    const busId = decodeURIComponent(req.params.busId);
    const studentId = req.user.user_id || req.user.email || 'anonymous';

    if (!busId || busId.length > 50) {
      return res.status(400).json({ error: 'Invalid busId' });
    }

    // After 12:00 PM in Indian Standard Time (IST), buses travel away from college.
    // Destination (college) ETA polling is completely disabled in afternoon/evening.
    const istHour = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();
    if (istHour >= 12) {
      return res.json({ success: true, sessionId: 'afternoon_disabled', busId, disabled: true, message: 'Destination ETA disabled after 12:00 PM IST' });
    }

    const sessionId = ViewerService.registerViewer(busId, studentId);
    res.json({ success: true, sessionId, busId });
  } catch (err) {
    console.error('[view-register] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/buses/:busId/view — Unregister viewer (authenticated clients)
app.delete('/api/buses/:busId/view', verifyRole, (req, res) => {
  try {
    const busId = decodeURIComponent(req.params.busId);
    const { sessionId } = req.body;
    if (sessionId) ViewerService.unregisterViewer(busId, sessionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/buses/:busId/leave — Unregister viewer via sendBeacon (no auth header possible).
// navigator.sendBeacon() always sends POST and cannot attach Authorization headers,
// so this endpoint does NOT use verifyRole. Security is maintained by the sessionId UUID:
// a random UUID that an attacker would need to guess to affect another student's session.
app.post('/api/buses/:busId/leave', (req, res) => {
  try {
    const busId = decodeURIComponent(req.params.busId);
    const { sessionId } = req.body || {};
    if (busId && busId.length <= 50 && sessionId) {
      ViewerService.unregisterViewer(busId, sessionId);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/buses/:busId/heartbeat — Refresh viewer TTL (called every 20s by client)
app.post('/api/buses/:busId/heartbeat', verifyRole, (req, res) => {
  try {
    const busId = decodeURIComponent(req.params.busId);
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    // Ignore heartbeats for disabled afternoon sessions
    if (sessionId === 'afternoon_disabled') {
      return res.json({ success: true, disabled: true });
    }

    const valid = ViewerService.heartbeat(busId, sessionId);
    if (!valid) {
      // Session expired — client should re-register
      return res.status(410).json({ error: 'Session expired', reregister: true });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/buses/:busId/eta — Get current shared ETA (instant, from cache)
// Students call this ONCE on page load to get the last computed ETA immediately.
// Subsequent updates arrive via Supabase Realtime (no polling).
app.get('/api/buses/:busId/eta', verifyRole, async (req, res) => {
  try {
    const busId = decodeURIComponent(req.params.busId);

    // After 12 PM in IST, destination ETA is disabled
    const istHour = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();
    if (istHour >= 12) {
      return res.json({
        success: true,
        status: 'AFTERNOON_DISABLED',
        eta_minutes: null,
        eta_formatted: null,
        message: 'Destination ETA disabled after 12:00 PM IST',
        viewer_count: 0
      });
    }

    // Try fresh cache first
    let cached = await ETACache.get(busId);
    let status = 'FRESH';

    if (!cached) {
      // Try stale cache as fallback
      cached = await ETACache.getStale(busId);
      status = cached ? 'STALE' : 'UNAVAILABLE';
    }

    if (!cached) {
      return res.json({
        success: true,
        status: 'UNAVAILABLE',
        eta_minutes: null,
        eta_formatted: '--',
        viewer_count: ViewerService.getViewerCount(busId)
      });
    }

    res.json({
      success: true,
      status,
      bus_id: busId,
      eta_seconds: cached.eta_seconds,
      eta_minutes: cached.eta_minutes,
      eta_formatted: formatETADuration(cached.eta_minutes),
      distance_meters: cached.distance_meters,
      provider: cached.provider,
      calculated_at: cached.calculated_at,
      viewer_count: ViewerService.getViewerCount(busId)
    });
  } catch (err) {
    console.error('[bus-eta] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/eta-monitor — Admin monitoring of ETA optimization metrics
app.get('/api/admin/eta-monitor', requireRole(['admin']), (req, res) => {
  try {
    const busData = ETAPollerManager.getMonitoringData();
    const viewerCounts = ViewerService.getAllViewerCounts();

    // Merge viewer counts in
    for (const bus of busData) {
      bus.viewer_count = viewerCounts[bus.bus_id] || bus.viewer_count;
    }

    const totalViewers    = busData.reduce((s, b) => s + b.viewer_count, 0);
    const totalApiCalls   = busData.reduce((s, b) => s + b.api_call_count_session, 0);
    const totalAvoided    = busData.reduce((s, b) => s + b.estimated_calls_avoided, 0);
    const activeBuses     = busData.filter(b => b.poller_status === 'ACTIVE').length;

    res.json({
      success: true,
      buses: busData,
      totals: {
        active_buses: activeBuses,
        total_viewers: totalViewers,
        total_api_calls_session: totalApiCalls,
        total_calls_avoided: totalAvoided,
        eta_poll_interval_ms: parseInt(process.env.ETA_POLL_INTERVAL_MS || '45000', 10),
        viewer_ttl_ms: parseInt(process.env.VIEWER_TTL_MS || '60000', 10),
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ============================================================================
// MULTI-TENANT SAAS & INSTITUTION ACCESS-CODE ENDPOINTS
// ============================================================================

// ============================================================================
// SUPER ADMIN ONE-TIME BOOTSTRAP INITIALIZATION
// ============================================================================
async function initializeSuperAdminBootstrap() {
  const bootstrapUser = process.env.SUPER_ADMIN_BOOTSTRAP_USER;
  const bootstrapPass = process.env.SUPER_ADMIN_BOOTSTRAP_PASS;
  
  if (!bootstrapUser || !bootstrapPass) {
    return;
  }

  try {
    const { count, error } = await supabase
      .from('platform_admins')
      .select('id', { count: 'exact', head: true });

    if (error) {
      // Schema may not be initialized yet
      return;
    }

    if (count > 0) {
      console.log('[Platform Security] Super Admin bootstrap disabled: Platform admin accounts already exist.');
      return;
    }

    const pwdCheck = validateStrongPassword(bootstrapPass);
    if (!pwdCheck.valid) {
      console.error('[Platform Security] Super Admin bootstrap aborted: Password does not meet security requirements -', pwdCheck.message);
      return;
    }

    const passwordHash = await bcrypt.hash(bootstrapPass, 12);
    const { error: insertErr } = await supabase.from('platform_admins').insert([{
      username: bootstrapUser,
      email: `${bootstrapUser}@whereismybus.internal`,
      password_hash: passwordHash,
      role: 'super_admin',
      status: 'active',
      created_at: new Date().toISOString()
    }]);

    if (insertErr) {
      console.error('[Platform Security] Failed to create initial super admin:', insertErr.message);
    } else {
      console.log(`[Platform Security] One-time Super Admin bootstrap completed for user '${bootstrapUser}'.`);
      await logPlatformAudit('bootstrap', 'system', 'PLATFORM_SUPERADMIN_BOOTSTRAP', null, { username: bootstrapUser });
    }
  } catch (err) {
    console.warn('[Platform Security] Bootstrap check exception:', err.message);
  }
}

// 1. PUBLIC INSTITUTION RESOLUTION (STRICT SUPABASE QUERIES, NO IN-MEMORY FALLBACK)
app.post('/api/institutions/resolve-code', resolveCodeLimiter, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ ok: false, error: 'Please enter a valid institution access code.' });
    }

    const cleanCode = code.trim().toUpperCase();
    if (cleanCode.length < 6 || cleanCode.length > 128) {
      return res.status(400).json({ ok: false, error: 'Invalid access code format.' });
    }

    const codeHash = hashAccessCode(cleanCode);

    const { data: codeRecord, error: codeErr } = await supabase
      .from('institution_access_codes')
      .select('id, institution_id, status, expires_at')
      .eq('code_hash', codeHash)
      .maybeSingle();

    if (codeErr) {
      console.error('[resolve-code] DB Error:', codeErr);
      return res.status(503).json({ ok: false, error: 'Database service unavailable. Please ensure migrations are applied.' });
    }

    if (!codeRecord) {
      return res.status(401).json({ ok: false, error: 'Invalid or inactive institution access code.' });
    }

    if (codeRecord.status !== 'active') {
      return res.status(401).json({ ok: false, error: 'This access code has been revoked or is inactive.' });
    }

    if (codeRecord.expires_at && new Date(codeRecord.expires_at) < new Date()) {
      return res.status(401).json({ ok: false, error: 'This institution access code has expired.' });
    }

    const { data: institution, error: instErr } = await supabase
      .from('institutions')
      .select('id, institution_name, institution_type, institution_code, status')
      .eq('id', codeRecord.institution_id)
      .maybeSingle();

    if (instErr) {
      console.error('[resolve-code] DB Error fetching institution:', instErr);
      return res.status(503).json({ ok: false, error: 'Database service unavailable. Please try again later.' });
    }

    if (!institution) {
      return res.status(404).json({ ok: false, error: 'Associated institution not found.' });
    }

    if (institution.status !== 'active') {
      return res.status(403).json({ ok: false, error: 'This institution is currently inactive or suspended.' });
    }

    return res.json({
      ok: true,
      institution: {
        id: institution.id,
        name: institution.institution_name,
        code: institution.institution_code,
        type: institution.institution_type
      }
    });
  } catch (err) {
    console.error('[resolve-code] Error:', err);
    res.status(500).json({ ok: false, error: 'Unable to verify access code. Please try again later.' });
  }
});

// 2. PLATFORM SUPER ADMIN (DEVELOPER) AUTHENTICATION & MFA
app.post('/api/platform/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const { data: admin, error: dbError } = await supabase
      .from('platform_admins')
      .select('id, username, email, password_hash, role, status, mfa_enabled, mfa_secret, mfa_backup_codes')
      .eq('username', username)
      .maybeSingle();

    if (dbError) {
      console.error('[platform-login] DB Error:', dbError);
      return res.status(503).json({ error: 'Database service unavailable. Ensure migrations are applied.' });
    }

    if (!admin) {
      return res.status(401).json({ error: 'Invalid platform credentials.' });
    }

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid platform credentials.' });
    }

    if (admin.status !== 'active') {
      return res.status(401).json({ error: 'Platform administrator account is inactive.' });
    }

    // Two-factor authentication check
    if (admin.mfa_enabled && admin.mfa_secret) {
      const mfaTempToken = jwt.sign(
        { user_id: admin.id, username: admin.username, role: 'mfa_pending' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({
        success: true,
        mfa_required: true,
        temp_token: mfaTempToken,
        message: 'Two-factor authentication code required.'
      });
    }

    const token = jwt.sign(
      { user_id: admin.id, username: admin.username, role: 'super_admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    await supabase.from('platform_admins').update({ last_login_at: new Date().toISOString() }).eq('id', admin.id);
    await logPlatformAudit(admin.username, 'super_admin', 'SUPER_ADMIN_LOGIN', null, {}, req);

    res.json({
      success: true,
      token,
      user: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: 'super_admin'
      }
    });
  } catch (err) {
    console.error('[platform-login] Error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Platform Super Admin MFA Login Verification
app.post('/api/platform/mfa/verify-login', authLimiter, async (req, res) => {
  try {
    const { temp_token, totp_code, backup_code } = req.body;
    if (!temp_token) return res.status(400).json({ error: 'MFA challenge token is required.' });

    let decoded;
    try {
      decoded = jwt.verify(temp_token, JWT_SECRET);
      if (decoded.role !== 'mfa_pending') throw new Error('Invalid token scope');
    } catch (e) {
      return res.status(401).json({ error: 'MFA challenge has expired or is invalid. Please log in again.' });
    }

    const { data: admin, error: dbError } = await supabase
      .from('platform_admins')
      .select('id, username, email, role, status, mfa_enabled, mfa_secret, mfa_backup_codes')
      .eq('id', decoded.user_id)
      .single();

    if (dbError || !admin || admin.status !== 'active' || !admin.mfa_enabled) {
      return res.status(401).json({ error: 'Platform admin not found or MFA not configured.' });
    }

    let authenticated = false;
    let usedBackupCodeIndex = -1;

    if (totp_code && verifyTOTP(admin.mfa_secret, totp_code)) {
      authenticated = true;
    } else if (backup_code && Array.isArray(admin.mfa_backup_codes)) {
      const cleanBackup = String(backup_code).trim().toUpperCase();
      const codeHash = crypto.createHash('sha256').update(cleanBackup).digest('hex');
      usedBackupCodeIndex = admin.mfa_backup_codes.indexOf(codeHash);
      if (usedBackupCodeIndex !== -1) {
        authenticated = true;
      }
    }

    if (!authenticated) {
      return res.status(401).json({ error: 'Invalid MFA verification code or backup code.' });
    }

    if (usedBackupCodeIndex !== -1) {
      const updatedBackupCodes = [...admin.mfa_backup_codes];
      updatedBackupCodes.splice(usedBackupCodeIndex, 1);
      await supabase.from('platform_admins').update({ mfa_backup_codes: updatedBackupCodes }).eq('id', admin.id);
      await logPlatformAudit(admin.username, 'super_admin', 'MFA_BACKUP_CODE_USED', null, { remaining: updatedBackupCodes.length }, req);
    }

    const token = jwt.sign(
      { user_id: admin.id, username: admin.username, role: 'super_admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    await supabase.from('platform_admins').update({ last_login_at: new Date().toISOString() }).eq('id', admin.id);
    await logPlatformAudit(admin.username, 'super_admin', 'SUPER_ADMIN_MFA_LOGIN', null, {}, req);

    res.json({
      success: true,
      token,
      user: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: 'super_admin'
      }
    });
  } catch (err) {
    console.error('[mfa-verify-login] Error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Setup MFA: Generate Base32 secret and 5 emergency backup codes
app.post('/api/platform/mfa/setup', requireSuperAdmin, async (req, res) => {
  try {
    const rawSecret = crypto.randomBytes(20);
    const secretBase32 = base32Encode(rawSecret);
    const otpauthUrl = `otpauth://totp/WhereIsMyBus:${encodeURIComponent(req.user.username)}?secret=${secretBase32}&issuer=WhereIsMyBus`;

    const plainBackupCodes = [];
    const hashedBackupCodes = [];
    for (let i = 0; i < 5; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars
      plainBackupCodes.push(code);
      hashedBackupCodes.push(crypto.createHash('sha256').update(code).digest('hex'));
    }

    res.json({
      success: true,
      secret: secretBase32,
      otpauth_url: otpauthUrl,
      backup_codes: plainBackupCodes,
      message: 'Scan the OTP URL or manually enter the secret into your Authenticator app. Save your emergency backup codes.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enable MFA after confirming a valid code
app.post('/api/platform/mfa/enable', requireSuperAdmin, async (req, res) => {
  try {
    const { secret, totp_code, backup_codes } = req.body;
    if (!secret || !totp_code) {
      return res.status(400).json({ error: 'Secret and verification code are required.' });
    }

    if (!verifyTOTP(secret, totp_code)) {
      return res.status(400).json({ error: 'Verification code is invalid or expired. Check your device clock.' });
    }

    const hashedCodes = Array.isArray(backup_codes)
      ? backup_codes.map(c => crypto.createHash('sha256').update(String(c).trim().toUpperCase()).digest('hex'))
      : [];

    const { error } = await supabase.from('platform_admins').update({
      mfa_enabled: true,
      mfa_secret: secret,
      mfa_backup_codes: hashedCodes,
      updated_at: new Date().toISOString()
    }).eq('id', req.user.user_id);

    if (error) {
      return res.status(503).json({ error: 'Failed to enable MFA in database.' });
    }

    await logPlatformAudit(req.user.username, 'super_admin', 'MFA_ENABLED', null, {}, req);
    res.json({ success: true, message: 'Two-Factor Authentication is now enabled.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disable MFA (requires password and current TOTP code)
app.post('/api/platform/mfa/disable', requireSuperAdmin, async (req, res) => {
  try {
    const { password, totp_code } = req.body;
    if (!password || !totp_code) {
      return res.status(400).json({ error: 'Password and current MFA code are required.' });
    }

    const { data: admin, error: dbErr } = await supabase
      .from('platform_admins')
      .select('id, password_hash, mfa_secret')
      .eq('id', req.user.user_id)
      .single();

    if (dbErr || !admin) return res.status(404).json({ error: 'Admin account not found.' });

    const validPwd = await bcrypt.compare(password, admin.password_hash);
    if (!validPwd) return res.status(401).json({ error: 'Incorrect password.' });

    if (!verifyTOTP(admin.mfa_secret, totp_code)) {
      return res.status(400).json({ error: 'Invalid MFA verification code.' });
    }

    await supabase.from('platform_admins').update({
      mfa_enabled: false,
      mfa_secret: null,
      mfa_backup_codes: [],
      updated_at: new Date().toISOString()
    }).eq('id', req.user.user_id);

    await logPlatformAudit(req.user.username, 'super_admin', 'MFA_DISABLED', null, {}, req);
    res.json({ success: true, message: 'Two-Factor Authentication has been disabled.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Password Rotation for Platform Super Admins
app.post('/api/platform/change-password', requireSuperAdmin, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }

    const { data: admin, error: dbErr } = await supabase
      .from('platform_admins')
      .select('id, password_hash')
      .eq('id', req.user.user_id)
      .single();

    if (dbErr || !admin) return res.status(404).json({ error: 'Admin account not found.' });

    const validPwd = await bcrypt.compare(current_password, admin.password_hash);
    if (!validPwd) return res.status(401).json({ error: 'Current password is incorrect.' });

    if (current_password === new_password) {
      return res.status(400).json({ error: 'New password cannot be identical to the current password.' });
    }

    const check = validateStrongPassword(new_password);
    if (!check.valid) {
      return res.status(400).json({ error: check.message });
    }

    const newHash = await bcrypt.hash(new_password, 12);
    const { error: updateErr } = await supabase.from('platform_admins').update({
      password_hash: newHash,
      password_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', admin.id);

    if (updateErr) return res.status(503).json({ error: 'Failed to update password in database.' });

    await logPlatformAudit(req.user.username, 'super_admin', 'PLATFORM_PASSWORD_ROTATED', null, {}, req);
    res.json({ success: true, message: 'Password rotated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Additional Platform Admins (Restricted strictly to existing Super Admins)
app.post('/api/platform/admins', requireSuperAdmin, platformLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const check = validateStrongPassword(password);
    if (!check.valid) {
      return res.status(400).json({ error: check.message });
    }

    const { data: existing } = await supabase
      .from('platform_admins')
      .select('id')
      .eq('username', username.trim())
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'A platform admin with this username already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const { data, error } = await supabase.from('platform_admins').insert([{
      username: username.trim(),
      email: email ? email.trim() : null,
      password_hash: passwordHash,
      role: 'super_admin',
      status: 'active',
      created_at: new Date().toISOString()
    }]).select('id, username, email, role, status, created_at').single();

    if (error) return res.status(503).json({ error: error.message });

    await logPlatformAudit(req.user.username, 'super_admin', 'PLATFORM_ADMIN_CREATED', null, { new_admin: username }, req);
    res.status(201).json({ success: true, admin: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. PLATFORM SUPER ADMIN DASHBOARD OVERVIEW STATS
app.get('/api/platform/dashboard-stats', requireSuperAdmin, async (req, res) => {
  try {
    const [instRes, busesRes, driversRes, tripsRes, logsRes] = await Promise.all([
      supabase.from('institutions').select('id, status'),
      supabase.from('buses').select('id'),
      supabase.from('drivers').select('id'),
      supabase.from('trips').select('id').eq('status', 'active'),
      supabase.from('platform_audit_logs').select('*').order('created_at', { ascending: false }).limit(10)
    ]);

    if (instRes.error) {
      return res.status(503).json({ error: 'Database service unavailable. Ensure migrations are applied.' });
    }

    const instList = instRes.data || [];
    const totalInstitutions = instList.length;
    const activeInstitutions = instList.filter(i => i.status === 'active').length;
    const inactiveInstitutions = totalInstitutions - activeInstitutions;

    res.json({
      success: true,
      stats: {
        totalInstitutions,
        activeInstitutions,
        inactiveInstitutions,
        totalBuses: busesRes.data ? busesRes.data.length : 0,
        totalDrivers: driversRes.data ? driversRes.data.length : 0,
        activeTrips: tripsRes.data ? tripsRes.data.length : 0,
        recentLogs: logsRes.data || []
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. PLATFORM SUPER ADMIN INSTITUTIONS LIST & REGISTRATION
app.get('/api/platform/institutions', requireSuperAdmin, async (req, res) => {
  try {
    const { data: institutions, error } = await supabase
      .from('institutions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(503).json({ error: 'Database service unavailable. Ensure migrations are applied.' });
    }

    res.json({ success: true, institutions: institutions || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/platform/institutions', requireSuperAdmin, platformLimiter, async (req, res) => {
  try {
    const {
      institution_name,
      institution_type = 'college',
      institution_code,
      address,
      district,
      state,
      contact_person,
      contact_email,
      contact_phone,
      allow_admin_code_rotation = false
    } = req.body;

    if (!institution_name || !institution_code) {
      return res.status(400).json({ error: 'Institution Name and Identifier Code are required.' });
    }

    const cleanCode = institution_code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');

    const { data: existing, error: checkErr } = await supabase
      .from('institutions')
      .select('id')
      .eq('institution_code', cleanCode)
      .maybeSingle();

    if (checkErr) {
      return res.status(503).json({ error: 'Database service unavailable.' });
    }

    if (existing) {
      return res.status(400).json({ error: `Institution Identifier '${cleanCode}' is already registered.` });
    }

    const { data: newInst, error: insertErr } = await supabase
      .from('institutions')
      .insert([{
        institution_name: institution_name.trim(),
        institution_type,
        institution_code: cleanCode,
        address,
        district,
        state,
        contact_person,
        contact_email,
        contact_phone,
        status: 'active',
        allow_admin_code_rotation: Boolean(allow_admin_code_rotation),
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (insertErr || !newInst) {
      return res.status(503).json({ error: insertErr ? insertErr.message : 'Failed to register institution in database.' });
    }

    // Generate 128-bit cryptographically secure access code
    const plainAccessCode = generateAccessCode(cleanCode);
    const codeHash = hashAccessCode(plainAccessCode);

    const { error: codeErr } = await supabase.from('institution_access_codes').insert([{
      institution_id: newInst.id,
      code_hash: codeHash,
      hash_key_version: 'v1',
      status: 'active',
      created_by: req.user.username,
      created_at: new Date().toISOString(),
      metadata: { initial: true }
    }]);

    if (codeErr) {
      return res.status(503).json({ error: 'Failed to record access code in database.' });
    }

    await logPlatformAudit(req.user.username, 'super_admin', 'INSTITUTION_REGISTERED', newInst.id, {
      name: newInst.institution_name,
      code: newInst.institution_code
    }, req);

    res.status(201).json({
      success: true,
      institution: newInst,
      accessCode: plainAccessCode,
      message: 'Institution registered successfully. Securely record this access code now; it will never be displayed again.'
    });
  } catch (err) {
    console.error('[platform-register-inst] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. PLATFORM GET, UPDATE & ROTATE ACCESS CODE FOR AN INSTITUTION
app.get('/api/platform/institutions/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { data: inst, error } = await supabase
      .from('institutions')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !inst) return res.status(404).json({ error: 'Institution not found.' });

    res.json({ success: true, institution: inst });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/platform/institutions/:id', requireSuperAdmin, platformLimiter, async (req, res) => {
  try {
    const allowed = ['institution_name', 'institution_type', 'address', 'district', 'state', 'contact_person', 'contact_email', 'contact_phone', 'status', 'allow_admin_code_rotation'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('institutions')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !updated) return res.status(503).json({ error: 'Failed to update institution.' });

    await logPlatformAudit(req.user.username, 'super_admin', 'INSTITUTION_UPDATED', req.params.id, updates, req);
    res.json({ success: true, institution: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Platform Super Admin: Rotate Institution Access Code
app.post('/api/platform/institutions/:id/access-code/rotate', requireSuperAdmin, platformLimiter, async (req, res) => {
  try {
    const { data: inst, error: instErr } = await supabase
      .from('institutions')
      .select('id, institution_code, institution_name')
      .eq('id', req.params.id)
      .single();

    if (instErr || !inst) return res.status(404).json({ error: 'Institution not found.' });

    const plainAccessCode = generateAccessCode(inst.institution_code);
    const newHash = hashAccessCode(plainAccessCode);

    // Atomically revoke current active code
    await supabase
      .from('institution_access_codes')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('institution_id', inst.id)
      .eq('status', 'active');

    // Insert new active code
    const { error: insertErr } = await supabase.from('institution_access_codes').insert([{
      institution_id: inst.id,
      code_hash: newHash,
      hash_key_version: 'v1',
      status: 'active',
      rotated_at: new Date().toISOString(),
      created_by: req.user.username
    }]);

    if (insertErr) {
      return res.status(503).json({ error: 'Failed to record rotated access code in database.' });
    }

    await logPlatformAudit(req.user.username, 'super_admin', 'ACCESS_CODE_ROTATED', inst.id, {}, req);

    res.json({
      success: true,
      accessCode: plainAccessCode,
      message: 'New access code generated successfully. Please securely share it with the institution.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Platform Super Admin: Revoke Access Code
app.post('/api/platform/institutions/:id/access-code/revoke', requireSuperAdmin, platformLimiter, async (req, res) => {
  try {
    const { error } = await supabase
      .from('institution_access_codes')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('institution_id', req.params.id)
      .eq('status', 'active');

    if (error) return res.status(503).json({ error: 'Failed to revoke access code in database.' });

    await logPlatformAudit(req.user.username, 'super_admin', 'ACCESS_CODE_REVOKED', req.params.id, {}, req);
    res.json({ success: true, message: 'Access code revoked successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Platform Super Admin: Toggle Administrator Code Rotation Setting
app.patch('/api/platform/institutions/:id/code-settings', requireSuperAdmin, platformLimiter, async (req, res) => {
  try {
    const { allow_admin_code_rotation } = req.body;
    const { error } = await supabase
      .from('institutions')
      .update({ allow_admin_code_rotation: Boolean(allow_admin_code_rotation), updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    if (error) return res.status(503).json({ error: 'Failed to update code settings in database.' });

    await logPlatformAudit(req.user.username, 'super_admin', 'CODE_SETTINGS_UPDATED', req.params.id, { allow_admin_code_rotation }, req);
    res.json({ success: true, allow_admin_code_rotation: Boolean(allow_admin_code_rotation) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Platform Super Admin: Audit Logs
app.get('/api/platform/audit-logs', requireSuperAdmin, async (req, res) => {
  try {
    const { data: logs, error } = await supabase
      .from('platform_audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return res.status(503).json({ error: 'Failed to retrieve audit logs from database.' });

    res.json({ success: true, logs: logs || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. INSTITUTION ADMINISTRATOR ENDPOINTS (Settings -> Institution)
app.get('/api/institution/access-code/status', requireRole(['admin']), async (req, res) => {
  try {
    const instId = req.user.institution_id;
    if (!instId) return res.status(403).json({ error: 'Admin has no institution assigned.' });

    const [instRes, codeRes] = await Promise.all([
      supabase.from('institutions').select('id, institution_name, institution_type, institution_code, status, allow_admin_code_rotation, created_at').eq('id', instId).single(),
      supabase.from('institution_access_codes').select('status, created_at, rotated_at, expires_at').eq('institution_id', instId).eq('status', 'active').maybeSingle()
    ]);

    if (instRes.error || !instRes.data) {
      return res.status(503).json({ error: 'Unable to retrieve institution profile.' });
    }

    res.json({
      success: true,
      institution: instRes.data,
      accessCode: codeRes.data || { status: 'none', created_at: null },
      allow_admin_code_rotation: Boolean(instRes.data.allow_admin_code_rotation)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/institution/access-code/rotate', requireRole(['admin']), platformLimiter, async (req, res) => {
  try {
    const instId = req.user.institution_id;
    if (!instId) return res.status(403).json({ error: 'Admin has no institution assigned.' });

    const { data: inst, error: instErr } = await supabase
      .from('institutions')
      .select('id, institution_code, allow_admin_code_rotation, status')
      .eq('id', instId)
      .single();

    if (instErr || !inst) return res.status(404).json({ error: 'Institution not found.' });

    if (!inst.allow_admin_code_rotation) {
      return res.status(403).json({ 
        error: 'Access code rotation by institution administrators is currently disabled. Please contact the platform developer.' 
      });
    }

    const plainAccessCode = generateAccessCode(inst.institution_code);
    const newHash = hashAccessCode(plainAccessCode);

    // Revoke old active code
    await supabase
      .from('institution_access_codes')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('institution_id', instId)
      .eq('status', 'active');

    // Insert new active code
    const { error: insertErr } = await supabase.from('institution_access_codes').insert([{
      institution_id: instId,
      code_hash: newHash,
      hash_key_version: 'v1',
      status: 'active',
      rotated_at: new Date().toISOString(),
      created_by: req.user.username
    }]);

    if (insertErr) return res.status(503).json({ error: 'Failed to record rotated access code in database.' });

    await logPlatformAudit(req.user.username, 'institution_admin', 'ADMIN_ROTATED_ACCESS_CODE', instId, {}, req);

    res.json({
      success: true,
      accessCode: plainAccessCode,
      message: 'New access code generated successfully. Please securely store and distribute this code.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/institution/settings', requireRole(['admin']), async (req, res) => {
  try {
    const instId = req.user.institution_id;
    if (!instId) return res.status(403).json({ error: 'Admin has no institution assigned.' });

    const { data: inst, error } = await supabase
      .from('institutions')
      .select('*')
      .eq('id', instId)
      .single();

    if (error || !inst) return res.status(503).json({ error: 'Unable to retrieve institution settings.' });

    res.json({ success: true, settings: inst });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Expose utilities on app.locals for test suite verification
app.locals.generateAccessCode = generateAccessCode;
app.locals.hashAccessCode = hashAccessCode;
app.locals.validateStrongPassword = validateStrongPassword;
app.locals.generateTOTP = generateTOTP;
app.locals.verifyTOTP = verifyTOTP;
app.locals.base32Encode = base32Encode;
app.locals.base32Decode = base32Decode;

// Run bootstrap check on initialization
initializeSuperAdminBootstrap().catch(err => {
  console.warn('[Bootstrap] Startup initialization error:', err.message);
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = {
  app,
  generateAccessCode,
  hashAccessCode,
  validateStrongPassword,
  generateTOTP,
  verifyTOTP,
  base32Encode,
  base32Decode,
  setSupabaseClient: (client) => { supabase = client; }
};
