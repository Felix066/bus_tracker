const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qlzqymdeguhzlxnfawiq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsenF5bWRlZ3Voemx4bmZhd2lxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NjQ2NTUsImV4cCI6MjA5MTA0MDY1NX0.hK2Vnpn9nXu2oRA0N--sFS4zaquvGxKIRjPW4Q90rj4';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function test() {
  const { data, error } = await supabase.from('bus_locations').insert({
    trip_id: null,
    bus_id: 'Bus 1',
    source_role: 'driver',
    source_user_id: 'test',
    latitude: 9.15,
    longitude: 76.72,
    speed_kmh: 0,
    is_accepted: true,
    submitted_at: new Date().toISOString()
  });
  console.log('Insert with speed_kmh:', error ? error : 'Success');

  const { data2, error2 } = await supabase.from('bus_locations').insert({
    trip_id: null,
    bus_id: 'Bus 1',
    source_role: 'driver',
    source_user_id: 'test',
    latitude: 9.15,
    longitude: 76.72,
    is_accepted: true,
    submitted_at: new Date().toISOString()
  });
  console.log('Insert without speed_kmh:', error2 ? error2 : 'Success');
}

test();
