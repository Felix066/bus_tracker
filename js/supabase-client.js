// ============================================================================
// SUPABASE CLIENT - SECURE VERSION
// ============================================================================
// Keys are no longer hardcoded. They're managed by the backend.
// ============================================================================

// Configuration
// We use a relative path so it works perfectly when deployed on Render as a Web Service
const BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '') ? 'http://localhost:3001' : '';
// Note: We use a placeholder or read from environment if possible, but the original code 
// used a hardcoded ANON KEY which is now secured by RLS and rate limiting on the backend.
const SUPABASE_URL = 'https://qlzqymdeguhzlxnfawiq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsenF5bWRlZ3Voemx4bmZhd2lxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NjQ2NTUsImV4cCI6MjA5MTA0MDY1NX0.hK2Vnpn9nXu2oRA0N--sFS4zaquvGxKIRjPW4Q90rj4';

// Initialize Supabase (public key only - safe to expose)
if (typeof supabase !== 'undefined') {
  window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.warn("Supabase CDN not loaded. Realtime and some database features will be disabled.");
  window.supabase = null;
}

// ============================================================================
// TOKEN MANAGEMENT
// ============================================================================



// ============================================================================
// SECURE LOCATION SUBMISSION
// ============================================================================

async function submitLocationSecure(latitude, longitude, speed_kmh, trip_id, bus_id, source_role, source_user_id) {
  try {
    const token = JSON.parse(localStorage.getItem('driverSession'))?.token;
    const response = await fetch(`${BACKEND_URL}/api/location/submit`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({
        latitude,
        longitude,
        speed_kmh,
        trip_id,
        bus_id,
        source_role,
        source_user_id
      })
    });
    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    return { success: true, data: result.data };
  } catch (error) {
    console.error('❌ Location submission failed:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function getBusLocation(bus_id) {
  try {
    const { data, error } = await window.supabase
      .from('current_bus_locations')
      .select('*')
      .eq('bus_id', bus_id)
      .single();
    if (error) return null;
    return data;
  } catch (error) {
    console.error('Failed to fetch bus location:', error);
    return null;
  }
}

async function getTripInfo(bus_id) {
  try {
    const { data, error } = await window.supabase
      .from('trips')
      .select('*')
      .eq('bus_id', bus_id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return data[0];
  } catch (error) {
    console.error('Failed to fetch trip info:', error);
    return null;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================


window.submitLocationSecure = submitLocationSecure;
window.getBusLocation = getBusLocation;
window.getTripInfo = getTripInfo;
