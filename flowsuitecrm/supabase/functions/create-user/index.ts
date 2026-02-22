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

const supabaseClient = createClient(supabaseUrl, serviceRoleKey)

const allowedRoles = ['admin', 'distribuidor', 'vendedor', 'telemercadeo']

const ALLOWED_ORIGINS = [
  'https://flowiadigital.com',
  'https://crm.flowiadigital.com',
  'https://flow-suite-crm-staging.vercel.app',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Missing service role configuration' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const { data: profile, error: profileError } = await supabaseClient
    .from('usuarios')
    .select('rol')
    .eq('id', user.id)
    .single()

  if (profileError || profile?.rol !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const payload = (await req.json()) as CreateUserPayload

  if (!payload.email) {
    return new Response(JSON.stringify({ error: 'Email is required' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  if (!payload.nombre || !payload.apellido || !payload.rol) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  if (!allowedRoles.includes(payload.rol)) {
    return new Response(JSON.stringify({ error: 'Invalid role' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const organizacion = (payload as any).organizacion || 'Royal Prestige'

  const { data: authData, error: authError } = await supabaseClient.auth.admin.inviteUserByEmail(
    payload.email,
    { data: { organizacion } }
  )

  if (authError || !authData.user) {
    return new Response(JSON.stringify({ error: authError?.message ?? 'Auth error' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const { error: insertError } = await supabaseClient.from('usuarios').insert({
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
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  return new Response(JSON.stringify({ userId: authData.user.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
  })
})
