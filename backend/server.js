const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const cors = require('cors');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-this';

const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 60;

const GEO_BOUNDS = {
  MIN_LAT: 8.0, MAX_LAT: 36.0,
  MIN_LON: 68.0, MAX_LON: 97.0
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

const locationLimiter = rateLimit({
  windowMs: 2500,
  max: 1,
  keyGenerator: (req, res) => req.body.source_user_id || req.ip,
  message: 'Location submission limit exceeded. Wait 2.5 seconds before next submission.',
});

async function verifyJWT(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token: ' + error.message });
  }
}

function validateLocationSubmission(req) {
  const { latitude, longitude, trip_id, bus_id } = req.body;
  if (!latitude || !longitude || !trip_id || !bus_id) return { valid: false, error: 'Missing required fields' };
  if (latitude < GEO_BOUNDS.MIN_LAT || latitude > GEO_BOUNDS.MAX_LAT) return { valid: false, error: 'Invalid latitude' };
  if (longitude < GEO_BOUNDS.MIN_LON || longitude > GEO_BOUNDS.MAX_LON) return { valid: false, error: 'Invalid longitude' };
  return { valid: true };
}

app.post('/api/auth/get-token', async (req, res) => {
  try {
    const { user_id, email, role, trip_id } = req.body;
    if (!user_id || !role) return res.status(400).json({ error: 'Missing user_id or role' });
    const token = jwt.sign(
      { user_id, email, role, trip_id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 },
      JWT_SECRET
    );
    res.json({ token, expires_in: 3600, message: 'Token issued successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/location/submit', verifyJWT, locationLimiter, async (req, res) => {
  try {
    const validation = validateLocationSubmission(req);
    if (!validation.valid) return res.status(400).json({ error: validation.error });
    
    const { latitude, longitude, trip_id, bus_id, source_role, source_user_id, speed_kmh } = req.body;

    // Use UPSERT for current_bus_locations to prevent DB bloat
    const { data, error } = await supabase
      .from('current_bus_locations')
      .upsert({
        bus_id,
        trip_id,
        latitude,
        longitude,
        speed_kmh: speed_kmh || 0,
        source_role: source_role || req.user.role,
        source_user_id: source_user_id || req.user.user_id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'bus_id' })
      .select();

    if (error) return res.status(500).json({ error: 'Failed to save location: ' + error.message });

    res.json({ success: true, message: 'Location submitted successfully', data: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/location/bus/:bus_id', globalLimiter, async (req, res) => {
  try {
    const { bus_id } = req.params;
    const { data, error } = await supabase
      .from('current_bus_locations')
      .select('latitude, longitude, speed_kmh, updated_at')
      .eq('bus_id', bus_id)
      .single();

    if (error) return res.status(404).json({ error: 'Bus not found' });
    res.json({ success: true, bus_id, location: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/trip/:bus_id', async (req, res) => {
  try {
    const { bus_id } = req.params;
    const { data, error } = await supabase
      .from('trips')
      .select('id, driver_id, trip_type, started_at, status, current_stop_index')
      .eq('bus_id', bus_id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (error) return res.status(404).json({ error: 'No active trip found' });
    res.json({ success: true, trip: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/submission-rate', async (req, res) => {
  try {
    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
    const { data, error } = await supabase
      .from('current_bus_locations')
      .select('updated_at')
      .gte('updated_at', oneMinuteAgo);

    if (error) return res.status(500).json({ error: error.message });
    
    // Note: since this is an UPSERT table now, submission rate estimation is slightly different 
    // but we can still count distinct active buses updating.
    const submissionsPerSecond = data.length / 60;
    const isUnderAttack = submissionsPerSecond > 100;

    res.json({
      submissions_per_second: submissionsPerSecond.toFixed(2),
      total_submissions_60s: data.length,
      under_attack: isUnderAttack,
      recommendation: isUnderAttack ? 'Block suspicious IPs' : 'All good'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 BusTrack Backend Server running on port ${PORT}`);
});
