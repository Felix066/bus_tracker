import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { username, password } = await req.json()

    // 1. Initialize Supabase client with SERVICE_ROLE key to bypass RLS
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 2. Query driver securely
    const { data: driver, error } = await supabaseClient
      .from('drivers')
      .select('id, username, password_hash, assigned_bus')
      .eq('username', username)
      .single()

    if (error || !driver) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid username or password' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // 3. Compare passwords (Plain text as requested)
    if (password !== driver.password_hash) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid username or password' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // 4. Return success session data (excluding password)
    return new Response(JSON.stringify({
      success: true,
      driver: {
        driverId: driver.id,
        username: driver.username,
        assignedBus: driver.assigned_bus
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
