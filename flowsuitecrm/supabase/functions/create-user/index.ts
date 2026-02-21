import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type CreateUserPayload = {
  nombre: string | null
  apellido: string | null
  email: string | null
  codigo_vendedor: string | null
  codigo_distribuidor: string | null
  rol: string | null
  activo: boolean | null
}

const supabaseUrl = Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ?? ''

const adminClient = createClient(supabaseUrl, serviceRoleKey)

const allowedRoles = ['admin', 'distribuidor', 'vendedor', 'telemercadeo']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Missing service role configuration' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing authorization token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const payload = (await req.json()) as CreateUserPayload

  if (!payload.email) {
    return new Response(JSON.stringify({ error: 'Email is required' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  if (!payload.nombre || !payload.apellido || !payload.rol) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  if (!allowedRoles.includes(payload.rol)) {
    return new Response(JSON.stringify({ error: 'Invalid role' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const organizacion = (payload as any).organizacion || 'Royal Prestige'

  const { data: authData, error: authError } = await adminClient.auth.admin.inviteUserByEmail(
    payload.email,
    { data: { organizacion } }
  )

  if (authError || !authData.user) {
    return new Response(JSON.stringify({ error: authError?.message ?? 'Auth error' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  const { error: insertError } = await adminClient.from('usuarios').insert({
    id: authData.user.id,
    nombre: payload.nombre,
    apellido: payload.apellido,
    email: payload.email,
    codigo_vendedor: payload.codigo_vendedor,
    codigo_distribuidor: payload.codigo_distribuidor,
    rol: payload.rol,
    activo: payload.activo ?? true,
  })

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    })
  }

  return new Response(JSON.stringify({ userId: authData.user.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
})
