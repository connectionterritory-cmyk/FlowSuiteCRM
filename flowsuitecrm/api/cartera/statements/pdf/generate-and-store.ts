import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'
import { StatementPdfTemplate } from '../../../../src/modules/cartera/pdf/StatementPdfTemplate'
import {
  cvResumenToStatementData,
  dfpStatementToStatementData,
  type ClienteSnap,
  type CvResumenLineRaw,
  type CvResumenRaw,
  type DfpStatementLineRaw,
  type DfpStatementRaw,
} from '../../../../src/modules/cartera/pdf/statementAdapters'
import type { StatementPdfData } from '../../../../src/modules/cartera/pdf/statementPdfTypes'

type DocumentType = 'dfp_statement' | 'cv_resumen'

type GeneratePayload = {
  document_type?: DocumentType
  document_id?: string
  force_regenerate?: boolean
}

type DeliveryLogRow = {
  id: string
  org_id: string
  document_type: DocumentType
  document_id: string
  case_id: string | null
  cliente_id: string | null
  pdf_storage_path: string | null
  pdf_generated_at: string | null
  pdf_hash: string | null
  pdf_version: number
  source_hash: string | null
}

type DfpStatementRow = DfpStatementRaw & {
  org_id: string
  cliente_id: string
}

type CvResumenRow = CvResumenRaw & {
  org_id: string
}

type DocumentContext = {
  orgId: string
  documentType: DocumentType
  documentId: string
  caseId: string | null
  clienteId: string | null
  pdfData: StatementPdfData
}

type JsonRecord = Record<string, unknown>

const BUCKET = 'statement_pdfs'
const PREVIEW_TTL_SECONDS = 60 * 10
const ALLOWED_ROLES = new Set(['admin', 'distribuidor', 'supervisor_telemercadeo', 'telemercadeo'])
const ALLOWED_ORIGINS = [
  'https://flowiadigital.com',
  'https://crm.flowiadigital.com',
  'https://flow-suite-crm-staging.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
]

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.CUSTOM_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ''

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  ''

const serviceSupabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function getCorsHeaders(origin?: string) {
  const safeOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': safeOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function json(res: { status: (code: number) => { json: (body: JsonRecord) => void }; setHeader: (name: string, value: string) => void }, origin: string | undefined, status: number, body: JsonRecord) {
  const headers = getCorsHeaders(origin)
  res.setHeader('Content-Type', 'application/json')
  Object.entries(headers).forEach(([key, value]) => {
    if (value) res.setHeader(key, value)
  })
  res.status(status).json(body)
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

async function parseBody(req: { body?: unknown }): Promise<GeneratePayload> {
  if (typeof req.body === 'string') return JSON.parse(req.body) as GeneratePayload
  if (req.body && typeof req.body === 'object') return req.body as GeneratePayload
  return {}
}

async function requireAuthorizedUser(authHeader: string | undefined) {
  if (!authHeader) throw new Error('AUTH_REQUIRED')
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new Error('AUTH_REQUIRED')

  const { data, error } = await serviceSupabase.auth.getUser(token)
  if (error || !data.user) throw new Error('AUTH_INVALID')

  const { data: profile, error: profileError } = await serviceSupabase
    .from('usuarios')
    .select('id, org_id, rol')
    .eq('id', data.user.id)
    .single()

  if (profileError || !profile?.org_id || !profile?.rol) throw new Error('AUTH_FORBIDDEN')
  if (!ALLOWED_ROLES.has(profile.rol)) throw new Error('AUTH_FORBIDDEN')

  return {
    userId: data.user.id,
    orgId: profile.org_id as string,
    role: profile.rol as string,
  }
}

async function fetchClienteSnapshot(
  supabase: SupabaseClient,
  clienteId: string,
): Promise<ClienteSnap> {
  const { data, error } = await supabase
    .from('clientes')
    .select('nombre,apellido,hycite_id,telefono,email,direccion,ciudad,estado_region,codigo_postal')
    .eq('id', clienteId)
    .single()

  if (error) {
    throw new Error(`CLIENTE_LOAD_FAILED: ${error.message}`)
  }

  return (data ?? {}) as ClienteSnap
}

async function fetchCaseStatus(
  supabase: SupabaseClient,
  caseId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('cargo_vuelta_cases')
    .select('estado')
    .eq('id', caseId)
    .single()

  if (error) {
    throw new Error(`CASE_LOAD_FAILED: ${error.message}`)
  }

  return (data?.estado as string | null) ?? 'Sin estado'
}

async function loadDfpContext(
  supabase: SupabaseClient,
  documentId: string,
): Promise<DocumentContext> {
  const { data: statement, error } = await supabase
    .from('cob_statements')
    .select('id,org_id,cliente_id,case_id,revolving_account_id,periodo_inicio,periodo_fin,fecha_corte,fecha_vencimiento,balance_previo,compras_periodo,cargos_interes_periodo,pagos_periodo,nuevo_balance,pago_minimo,apr_tae,status')
    .eq('id', documentId)
    .single()

  if (error || !statement) {
    throw new Error(`DFP_STATEMENT_NOT_FOUND: ${error?.message ?? documentId}`)
  }

  const typedStatement = statement as DfpStatementRow
  const [linesRes, cliente, caseEstado] = await Promise.all([
    supabase
      .from('cob_statement_lines')
      .select('id,transaction_date,posting_date,entry_type,description,amount')
      .eq('statement_id', documentId)
      .order('line_order', { ascending: true })
      .order('created_at', { ascending: true }),
    fetchClienteSnapshot(supabase, typedStatement.cliente_id),
    fetchCaseStatus(supabase, typedStatement.case_id),
  ])

  if (linesRes.error) {
    throw new Error(`DFP_LINES_LOAD_FAILED: ${linesRes.error.message}`)
  }

  return {
    orgId: typedStatement.org_id,
    documentType: 'dfp_statement',
    documentId: typedStatement.id,
    caseId: typedStatement.case_id,
    clienteId: typedStatement.cliente_id,
    pdfData: dfpStatementToStatementData(
      typedStatement,
      (linesRes.data ?? []) as DfpStatementLineRaw[],
      cliente,
      caseEstado,
    ),
  }
}

async function loadCvContext(
  supabase: SupabaseClient,
  documentId: string,
): Promise<DocumentContext> {
  const { data: resumen, error } = await supabase
    .from('cob_cv_resumenes')
    .select('id,org_id,case_id,cliente_id,periodo_inicio,periodo_fin,fecha_corte,approval_date_snapshot,statement_date_snapshot,due_date_snapshot,interest_period_start_snapshot,interest_period_end_snapshot,interest_days_snapshot,interest_apr_snapshot,interest_amount_periodo,balance_proyectado_due_date,monto_original,saldo_apertura_periodo,pagos_periodo,pagos_acumulados,fee_plataforma_periodo,creditos_periodo,ajustes_periodo,saldo_pendiente_corte,proximo_pago_esperado,fecha_proximo_pago,status')
    .eq('id', documentId)
    .single()

  if (error || !resumen) {
    throw new Error(`CV_RESUMEN_NOT_FOUND: ${error?.message ?? documentId}`)
  }

  const typedResumen = resumen as CvResumenRow
  const [linesRes, cliente, caseEstado] = await Promise.all([
    supabase
      .from('cob_cv_resumen_lines')
      .select('id,line_number,line_type,event_date,description,monto_aplicado_balance,fee_plataforma,monto_total_cobrado_cliente,running_balance_after')
      .eq('resumen_id', documentId)
      .order('line_number', { ascending: true }),
    fetchClienteSnapshot(supabase, typedResumen.cliente_id),
    fetchCaseStatus(supabase, typedResumen.case_id),
  ])

  if (linesRes.error) {
    throw new Error(`CV_LINES_LOAD_FAILED: ${linesRes.error.message}`)
  }

  return {
    orgId: typedResumen.org_id,
    documentType: 'cv_resumen',
    documentId: typedResumen.id,
    caseId: typedResumen.case_id,
    clienteId: typedResumen.cliente_id,
    pdfData: cvResumenToStatementData(
      typedResumen,
      (linesRes.data ?? []) as CvResumenLineRaw[],
      cliente,
      typedResumen.case_id,
      caseEstado,
    ),
  }
}

async function loadDocumentContext(
  supabase: SupabaseClient,
  documentType: DocumentType,
  documentId: string,
): Promise<DocumentContext> {
  if (documentType === 'dfp_statement') return loadDfpContext(supabase, documentId)
  return loadCvContext(supabase, documentId)
}

// ── Stable hash del contenido fuente ─────────────────────────────────────────
// Produce una cadena determinista del contenido del statement data, ordenando
// las claves de objetos recursivamente y preservando el orden de arrays.
// El PDF binario NO es determinista (metadata interna del renderer cambia),
// pero el source_hash sí lo es: mismo contenido → mismo hash.
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + (value as unknown[]).map(stableStringify).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const pairs = Object.keys(obj)
    .sort()
    .map(k => JSON.stringify(k) + ':' + stableStringify(obj[k]))
  return '{' + pairs.join(',') + '}'
}

function computeSourceHash(pdfData: StatementPdfData): string {
  return createHash('sha256').update(stableStringify(pdfData)).digest('hex')
}

async function renderPdfBuffer(pdfData: StatementPdfData): Promise<Buffer> {
  const element = createElement(StatementPdfTemplate, { data: pdfData }) as unknown as ReactElement
  const buffer = await (renderToBuffer as unknown as (value: ReactElement) => Promise<Buffer>)(element)
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}

async function getExistingLogs(
  supabase: SupabaseClient,
  documentType: DocumentType,
  documentId: string,
): Promise<DeliveryLogRow[]> {
  const { data, error } = await supabase
    .from('statement_delivery_logs')
    .select('id,org_id,document_type,document_id,case_id,cliente_id,pdf_storage_path,pdf_generated_at,pdf_hash,pdf_version,source_hash')
    .eq('document_type', documentType)
    .eq('document_id', documentId)
    .order('pdf_version', { ascending: false })

  if (error) {
    throw new Error(`DELIVERY_LOG_LOAD_FAILED: ${error.message}`)
  }

  return (data ?? []) as DeliveryLogRow[]
}

async function signPreviewUrl(
  supabase: SupabaseClient,
  path: string | null,
): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, PREVIEW_TTL_SECONDS)

  if (error) return null
  return data?.signedUrl ?? null
}

function nextPdfVersion(existingLogs: DeliveryLogRow[]): number {
  const highest = existingLogs.reduce((max, row) => Math.max(max, row.pdf_version || 0), 0)
  return highest + 1
}

export default async function handler(req: { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }, res: { status: (code: number) => { json: (body: JsonRecord) => void }; setHeader: (name: string, value: string) => void }) {
  const originHeader = req.headers.origin
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader

  if (req.method === 'OPTIONS') {
    return json(res, origin, 200, { ok: true })
  }

  if (req.method !== 'POST') {
    return json(res, origin, 405, { ok: false, error: 'Method not allowed' })
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return json(res, origin, 500, { ok: false, error: 'Missing service role configuration' })
  }

  try {
    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization
    const actor = await requireAuthorizedUser(authHeader)
    const body = await parseBody(req)
    const documentType = body.document_type
    const documentId = body.document_id
    const forceRegenerate = Boolean(body.force_regenerate)

    if (documentType !== 'dfp_statement' && documentType !== 'cv_resumen') {
      return json(res, origin, 400, { ok: false, error: 'Invalid document_type' })
    }
    if (!isUuid(documentId)) {
      return json(res, origin, 400, { ok: false, error: 'Invalid document_id' })
    }

    const context = await loadDocumentContext(serviceSupabase, documentType, documentId)
    if (context.orgId !== actor.orgId) {
      return json(res, origin, 403, { ok: false, error: 'Forbidden for this organization' })
    }

    // source_hash: hash del contenido fuente normalizado, estable entre renders.
    // Criterio principal de deduplicación. El pdf_hash (binario) no es estable.
    const sourceHash = computeSourceHash(context.pdfData)
    const existingLogs = await getExistingLogs(serviceSupabase, documentType, documentId)

    const sameSourceLog = existingLogs.find(
      row => row.source_hash === sourceHash && row.pdf_storage_path,
    )

    if (sameSourceLog && !forceRegenerate) {
      const signedPreviewUrl = await signPreviewUrl(serviceSupabase, sameSourceLog.pdf_storage_path)
      return json(res, origin, 200, {
        ok: true,
        reused_existing: true,
        delivery_log_id: sameSourceLog.id,
        pdf_storage_path: sameSourceLog.pdf_storage_path,
        pdf_version: sameSourceLog.pdf_version,
        source_hash: sameSourceLog.source_hash,
        pdf_hash: sameSourceLog.pdf_hash,
        signed_preview_url: signedPreviewUrl,
      })
    }

    // Nuevo render: source_hash no encontrado o force_regenerate=true
    const pdfBuffer = await renderPdfBuffer(context.pdfData)
    const pdfHash = createHash('sha256').update(pdfBuffer).digest('hex')
    const pdfVersion = nextPdfVersion(existingLogs)
    const pdfStoragePath = `org/${context.orgId}/${documentType}/${documentId}/v${pdfVersion}/statement.pdf`

    const uploadResult = await serviceSupabase.storage
      .from(BUCKET)
      .upload(pdfStoragePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false,
      })

    if (uploadResult.error) {
      throw new Error(`PDF_UPLOAD_FAILED: ${uploadResult.error.message}`)
    }

    const { data: insertedLog, error: insertError } = await serviceSupabase
      .from('statement_delivery_logs')
      .insert({
        org_id: context.orgId,
        document_type: documentType,
        document_id: documentId,
        case_id: context.caseId,
        cliente_id: context.clienteId,
        pdf_storage_path: pdfStoragePath,
        pdf_generated_at: new Date().toISOString(),
        source_hash: sourceHash,
        pdf_hash: pdfHash,
        pdf_version: pdfVersion,
        email_status: 'pdf_generated',
        metadata: {
          generated_by: actor.userId,
          generated_role: actor.role,
          source: 'vercel_function',
        },
      })
      .select('id')
      .single()

    if (insertError || !insertedLog) {
      throw new Error(`DELIVERY_LOG_INSERT_FAILED: ${insertError?.message ?? 'No log row returned'}`)
    }

    const signedPreviewUrl = await signPreviewUrl(serviceSupabase, pdfStoragePath)

    return json(res, origin, 200, {
      ok: true,
      reused_existing: false,
      delivery_log_id: insertedLog.id,
      pdf_storage_path: pdfStoragePath,
      pdf_version: pdfVersion,
      source_hash: sourceHash,
      pdf_hash: pdfHash,
      signed_preview_url: signedPreviewUrl,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    const status =
      message === 'AUTH_REQUIRED' || message === 'AUTH_INVALID'
        ? 401
        : message === 'AUTH_FORBIDDEN'
          ? 403
          : 500

    return json(res, origin, status, {
      ok: false,
      error: message,
    })
  }
}
