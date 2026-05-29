require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  'http://127.0.0.1:3000'
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
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com", "https://unpkg.com"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://*.supabase.co", "https://unpkg.com"],
      connectSrc: ["'self'", "https://*.supabase.co", "wss://*.supabase.co", "https://nominatim.openstreetmap.org"],
      workerSrc: ["'self'", "blob:"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"]
    }
  }
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

app.use(express.json());

// Serve static frontend files from the parent directory
const path = require('path');
app.use(express.static(path.join(__dirname, '../')));

// ============================================================================
// AUTHORIZATION MIDDLEWARE
// ============================================================================
async function verifyRole(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
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

app.post('/api/auth/register-driver', requireRole(['admin']), async (req, res) => {
  try {
    const { username, password, busId } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const driverPayload = { username, password_hash, assigned_bus: busId };
    const { data, error } = await supabase.from('drivers').upsert(driverPayload, { onConflict: 'username' });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true, message: 'Driver registered successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login-admin', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Check credentials against the hashed password
    const { data: adminData, error: adminError } = await supabase
      .from('admins')
      .select('id, username, password_hash')
      .eq('username', username)
      .single();

    if (adminError || !adminData) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const validPassword = await bcrypt.compare(password, adminData.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const token = jwt.sign(
      { user_id: username, username, role: 'admin' }, 
      JWT_SECRET, 
      { expiresIn: '12h' }
    );
    res.json({ success: true, token, username });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login-driver', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Check credentials against the hashed password
    const { data: driverData, error: driverError } = await supabase
      .from('drivers')
      .select('id, username, password_hash, assigned_bus')
      .eq('username', username)
      .single();

    if (driverError || !driverData) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const validPassword = await bcrypt.compare(password, driverData.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { user_id: driverData.id, username, role: 'driver', assignedBus: driverData.assigned_bus }, 
      JWT_SECRET, 
      { expiresIn: '12h' }
    );

    res.json({ 
      success: true, 
      token, 
      driver: { id: driverData.id, username, assignedBus: driverData.assigned_bus } 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/verify', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ valid: false });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ valid: false });
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
    const driver_id = req.user.user_id;

    const { data, error } = await supabase
      .from('trips')
      .insert({
        bus_id,
        trip_type,
        driver_id,
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
        status: 'completed'
      })
      .eq('id', trip_id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, trip: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .eq('bus_id', bus_id)
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
    const { data, error } = await supabase
      .from('bus_locations')
      .select('*')
      .eq('bus_id', bus_id)
      .single();

    if (error && error.code !== 'PGRST116') {
      return res.status(500).json({ error: error.message });
    }
    res.json({ success: true, location: data || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// DRIVER-TO-BUS VALIDATION & LOCATION ENDPOINTS
// ============================================================================

app.post('/api/auth/get-token', async (req, res) => {
  const { user_id, email, role, trip_id } = req.body;
  
  if (!user_id || !email || !role) {
    return res.status(400).json({ error: 'Missing user context' });
  }

  // Issue a 1-hour JWT for the frontend to use
  const token = jwt.sign(
    { user_id, email, role, trip_id }, 
    JWT_SECRET, 
    { expiresIn: '1h' }
  );

  res.json({ success: true, token });
});

// 2. Driver-to-Bus Ownership Validation
app.post('/api/location/submit', requireRole(['driver']), async (req, res) => {
  const { latitude, longitude, speed_kmh, trip_id, bus_id, source_role, source_user_id } = req.body;
  const driver_id = req.user.user_id;

  try {
    // SECURITY CHECK: Verify this driver actually started this active trip
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

    // ---------------------------------------------------------
    // THE "HOT TABLE" ARCHITECTURE IMPLEMENTATION
    // We explicitly overwrite the current bus location rather 
    // than inserting a new row every 3 seconds to prevent DB bloat.
    // ---------------------------------------------------------

    // First check if a location row already exists for this bus
    const { data: existingLoc } = await supabase
      .from('bus_locations')
      .select('id')
      .eq('bus_id', bus_id)
      .single();

    let data, error;

    if (existingLoc) {
      // UPDATE (Overwrite) the existing row for this bus
      ({ data, error } = await supabase.from('bus_locations').update({
        trip_id,
        source_role: 'driver',
        source_user_id: driver_id,
        latitude,
        longitude,
        speed_kmh,
        is_accepted: true,
        submitted_at: new Date().toISOString()
      })
      .eq('id', existingLoc.id)
      .select());
    } else {
      // INSERT the very first row for this bus if it doesn't exist yet
      ({ data, error } = await supabase.from('bus_locations').insert({
        trip_id,
        bus_id,
        source_role: 'driver',
        source_user_id: driver_id,
        latitude,
        longitude,
        speed_kmh,
        is_accepted: true,
        submitted_at: new Date().toISOString()
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
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
  } catch (err) {
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

// ============================================================================
// DRIVER MIGRATED ENDPOINTS (Replaces Direct Supabase Frontend Mutations)
// ============================================================================

app.post('/api/trip/sos', requireRole(['driver']), async (req, res) => {
  try {
    const { bus_id, latitude, longitude } = req.body;
    const driver_name = req.user.username;
    const { data, error } = await supabase.from('sos_alerts').insert({
      bus_id, driver_name, latitude, longitude, status: 'active'
    }).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
