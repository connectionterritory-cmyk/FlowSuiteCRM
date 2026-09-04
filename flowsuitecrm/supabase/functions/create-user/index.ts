import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type CreateUserPayload = {
  nombre: string | null
  apellido: string | null
  email: string | null
  telefono: string | null
  codigo_vendedor: string | null
  codigo_distribuidor: string | null
  reclutador_codigo: string | null
  rol: string | null
  activo: boolean | null
  organizacion?: string | null
}

type CallerProfile = {
  rol: string | null
  organizacion: string | null
}

type ExistingProfile = {
  id: string
  rol: string | null
  organizacion: string | null
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''

const supabaseClient = createClient(supabaseUrl, serviceRoleKey)

const allowedRoles = ['admin', 'distribuidor', 'vendedor', 'telemercadeo']
const distributorAllowedRoles = ['vendedor', 'telemercadeo']

const ALLOWED_ORIGINS = [
  'https://flowiadigital.com',
  'https://crm.flowiadigital.com',
  'https://flow-suite-crm-staging.vercel.app',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  const isAllowed = ALLOWED_ORIGINS.includes(origin) ||
                    origin.startsWith('http://localhost:') ||
                    origin === 'http://localhost'
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, X-Client-Info, x-client-info',
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
    .select('rol, organizacion')
    .eq('id', user.id)
    .single<CallerProfile>()

  if (profileError || (profile?.rol !== 'admin' && profile?.rol !== 'distribuidor')) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const payload = (await req.json()) as CreateUserPayload
  const callerRole = profile?.rol ?? null
  const callerOrg = profile?.organizacion ?? null

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

  if (callerRole === 'distribuidor' && !distributorAllowedRoles.includes(payload.rol)) {
    return new Response(JSON.stringify({ error: 'Forbidden role assignment' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const organizacion = callerRole === 'distribuidor'
    ? callerOrg
    : payload.organizacion || 'Royal Prestige'

  if (!organizacion) {
    return new Response(JSON.stringify({ error: 'Caller organization is required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const userProfile = {
    nombre: payload.nombre,
    apellido: payload.apellido,
    email: payload.email,
    telefono: payload.telefono,
    codigo_vendedor: payload.codigo_vendedor,
    codigo_distribuidor: payload.codigo_distribuidor,
    reclutador_codigo: payload.reclutador_codigo,
    rol: payload.rol,
    activo: payload.activo ?? true,
    organizacion,
  }

  const { data: existingProfile, error: existingProfileError } = await supabaseClient
    .from('usuarios')
    .select('id, rol, organizacion')
    .eq('email', payload.email)
    .maybeSingle<ExistingProfile>()

  if (existingProfileError) {
    return new Response(JSON.stringify({ error: existingProfileError.message }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  if (existingProfile?.id) {
    if (callerRole === 'distribuidor') {
      const sameOrg = existingProfile.organizacion === callerOrg
      const targetRoleAllowed = !existingProfile.rol || distributorAllowedRoles.includes(existingProfile.rol)
      if (!sameOrg || !targetRoleAllowed) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
        })
      }
    }

    const { error: updateError } = await supabaseClient
      .from('usuarios')
      .update(userProfile)
      .eq('id', existingProfile.id)

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
      })
    }

    return new Response(JSON.stringify({ userId: existingProfile.id, updated: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const { data: authData, error: inviteError } = await supabaseClient.auth.admin.inviteUserByEmail(
    payload.email,
    { data: { organizacion } }
  )

  if (inviteError || !authData.user) {
    return new Response(JSON.stringify({ error: inviteError?.message ?? 'Auth error' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const { error: insertError } = await supabaseClient.from('usuarios').insert({
    ...userProfile,
    id: authData.user.id,
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
