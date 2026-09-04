import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'

type ResendInvitePayload = {
  email: string | null
  organizacion?: string | null
}

type CallerProfile = {
  rol: string | null
  organizacion: string | null
}

type TargetProfile = {
  id: string
  rol: string | null
  organizacion: string | null
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('CUSTOM_SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''

const supabaseClient = createClient(supabaseUrl, serviceRoleKey)

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
      status: 405,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Missing service role configuration' }), {
      status: 500,
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

  const payload = (await req.json()) as ResendInvitePayload
  if (!payload.email) {
    return new Response(JSON.stringify({ error: 'Email is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const { data: targetProfile, error: targetError } = await supabaseClient
    .from('usuarios')
    .select('id, rol, organizacion')
    .eq('email', payload.email)
    .maybeSingle<TargetProfile>()

  if (targetError) {
    return new Response(JSON.stringify({ error: targetError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  if (profile?.rol === 'distribuidor') {
    const sameOrg = Boolean(profile.organizacion) && targetProfile?.organizacion === profile.organizacion
    const allowedTargetRole = !targetProfile?.rol || targetProfile.rol === 'vendedor' || targetProfile.rol === 'telemercadeo'
    if (!targetProfile || !sameOrg || !allowedTargetRole) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
      })
    }
  }

  const organizacion = profile?.rol === 'distribuidor'
    ? profile.organizacion
    : targetProfile?.organizacion || payload.organizacion || 'Royal Prestige'

  if (!organizacion) {
    return new Response(JSON.stringify({ error: 'Organization is required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  const { data: inviteData, error: inviteError } = await supabaseClient.auth.admin.inviteUserByEmail(
    payload.email,
    { data: { organizacion } }
  )

  if (inviteError || !inviteData.user) {
    return new Response(JSON.stringify({ error: inviteError?.message ?? 'Invite error' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
    })
  }

  return new Response(JSON.stringify({ userId: inviteData.user.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
  })
})
