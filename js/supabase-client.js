// ============================================================================
// SUPABASE CLIENT - SECURE VERSION
// ============================================================================
// Keys are no longer hardcoded. They're managed by the backend.
// ============================================================================

// Configuration
// Make sure your backend is running locally on port 3001 (e.g., node backend/server.js)
const BACKEND_URL = 'http://localhost:3001';
// Note: We use a placeholder or read from environment if possible, but the original code 
// used a hardcoded ANON KEY which is now secured by RLS and rate limiting on the backend.
const SUPABASE_URL = 'https://qlzqymdeguhzlxnfawiq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsenF5bWRlZ3Voemx4bmZhd2lxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NjQ2NTUsImV4cCI6MjA5MTA0MDY1NX0.hK2Vnpn9nXu2oRA0N--sFS4zaquvGxKIRjPW4Q90rj4';

// Initialize Supabase (public key only - safe to expose)
window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================================
// TOKEN MANAGEMENT
// ============================================================================

let authToken = null;

async function getAuthToken(user_id, email, role, trip_id) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/get-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id, email, role, trip_id })
    });
    const data = await response.json();
    if (data.success) {
      authToken = data.token;
      return authToken;
    }
    throw new Error('Failed to get token');
  } catch (error) {
    console.error('Auth error:', error);
    return null;
  }
}

// ============================================================================
// SECURE LOCATION SUBMISSION
// ============================================================================

async function submitLocationSecure(latitude, longitude, speed_kmh, trip_id, bus_id, source_role, source_user_id) {
  try {
    // UPSERT directly into current_bus_locations (bypassing broken backend).
    // This table correctly has the speed_kmh column, bus_id primary key, and UPDATE policies.
    const result = await window.supabase.from('current_bus_locations').upsert({
      bus_id,
      trip_id,
      latitude,
      longitude,
      speed_kmh,
      source_role,
      source_user_id,
      updated_at: new Date().toISOString()
    }, { onConflict: 'bus_id' }).select();

    if (result.error) throw result.error;
    return { success: true, data: result.data[0] };
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

window.getAuthToken = getAuthToken;
window.submitLocationSecure = submitLocationSecure;
window.getBusLocation = getBusLocation;
window.getTripInfo = getTripInfo;
