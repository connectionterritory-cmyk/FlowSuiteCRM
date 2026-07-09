import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2'
import { createElement } from 'https://esm.sh/react@18.3.1'
import { renderToBuffer } from 'https://esm.sh/@react-pdf/renderer@4.5.1?deps=react@18.3.1'
import { StatementPdfTemplate } from './_lib/StatementPdfTemplate.js'

const WORKER_SECRET = 'c93f0788596c831e23020e23971924b84d91b1fe4ade27c0bb8a2cb4243bd1ea'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
const resendFrom = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Royal Prestige <cobranza@flowiadigital.com>'

const supabase = createClient(supabaseUrl, serviceRoleKey)

const ALLOWED_ORIGINS = [
  'https://flowiadigital.com',
  'https://crm.flowiadigital.com',
  'https://flow-suite-crm-staging.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
]

const PRIVILEGED_ROLES = new Set([
  'admin',
  'distribuidor',
  'telemercadeo',
  'supervisor_tele',
  'supervisor_telemercadeo',
])

type UserProfile = {
  id: string
  org_id: string | null
  rol: string | null
}

type AuthorizedRequester =
  | { mode: 'worker' }
  | { mode: 'user'; userId: string; orgId: string; role: string }

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, X-Client-Info, x-client-info, x-worker-secret',
    'Access-Control-Max-Age': '86400',
  }
}

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(req) },
  })
}

function normalizeToken(header: string | null): string | null {
  if (!header) return null
  return header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim()
}

async function authorizeRequest(req: Request): Promise<AuthorizedRequester | Response> {
  const secretHeader = req.headers.get('x-worker-secret') ?? ''
  if (secretHeader === WORKER_SECRET) return { mode: 'worker' }

  const token = normalizeToken(req.headers.get('Authorization'))
  if (!token) {
    return jsonResponse(req, { error: 'Missing authorization' }, 401)
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return jsonResponse(req, { error: 'Invalid token' }, 401)
  }

  const { data: profileData, error: profileError } = await supabase
    .from('usuarios')
    .select('id, org_id, rol')
    .eq('id', user.id)
    .maybeSingle()

  const profile = (profileData as UserProfile | null) ?? null
  if (profileError || !profile?.org_id || !profile?.rol) {
    return jsonResponse(req, { error: 'User profile not found' }, 403)
  }

  if (!PRIVILEGED_ROLES.has(profile.rol)) {
    return jsonResponse(req, { error: 'Forbidden' }, 403)
  }

  return {
    mode: 'user',
    userId: user.id,
    orgId: profile.org_id,
    role: profile.rol,
  }
}

function escapeHtml(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '$0.00'
  return '$' + Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatShortDate(d: string | null | undefined): string {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function formatLongDate(d: string | null | undefined): string {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatReduction(n: number | null | undefined): string {
  const value = Number(n ?? 0)
  return value > 0 ? `-${formatMoney(value)}` : '$0.00'
}

type StatementLine = {
  transaction_date: string | null
  entry_type: string | null
  component_type: string | null
  description: string | null
  amount: number
  line_order?: number | null
  ledger_entry_id?: string | null
  debit_credit?: string | null
  ledger_metadata?: Record<string, unknown> | null
  client_description?: string | null
  client_type?: string | null
}

type StatementData = {
  statement_id: string
  org_id: string
  cliente_id: string
  cliente_nombre: string
  cliente_email: string | null
  case_id: string | null
  revolving_account_id: string | null
  periodo_inicio: string
  periodo_fin: string
  fecha_corte: string
  fecha_vencimiento: string | null
  balance_previo: number
  compras_periodo: number
  pagos_periodo: number
  otros_creditos: number
  cargos_interes_periodo: number
  cargos_totales_periodo: number
  apr_tae: number | null
  tasa_diaria: number | null
  balance_sujeto_interes: number
  nuevo_balance: number
  pago_minimo: number | null
  balance_atrasado: number | null
  dias_ciclo_facturacion: number | null
  ytd_cargos_atraso: number
  ytd_cargos_interes: number
  mensaje_pago: string | null
  metodos_pago: string | null
  status: string
  lines: StatementLine[]
}

type LedgerLineDetails = {
  id: string
  entry_type: string | null
  component_type: string | null
  description: string | null
  debit_credit: string | null
  metadata: Record<string, unknown> | null
  accrual_from: string | null
  accrual_to: string | null
  amount: number
}

type ClienteDetails = {
  hycite_id: string | null
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  codigo_postal: string | null
}

type TemplateLineType =
  | 'saldo_apertura'
  | 'pago'
  | 'credito'
  | 'ajuste'
  | 'cargo_interes'
  | 'cargo_fee'
  | 'saldo_cierre'
  | 'proximo_pago'

type StatementPdfTemplateData = {
  accountType: 'dfp'
  caseId: string
  accountNumber: string
  emissionDate: string
  periodStart: string
  periodEnd: string
  clientName: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  originalAmount: number
  previousBalance: number
  paymentsAccumulated: number
  paymentsPeriod: number
  creditsPeriod: number
  interestCharges: number
  feesPeriod: number
  pendingBalance: number
  projectedDueBalance: number | null
  agreedMonthlyPayment: number | null
  nextPaymentDate: string | null
  accountStatus: string
  approvalDate: string | null
  statementDate: string | null
  dueDate: string | null
  apr: number | null
  ytdInterest: number | null
  ytdFees: number | null
  paymentMethodsText: string | null
  statementReference: string
  paymentMessage: string | null
  lines: Array<{
    date: string | null
    description: string
    type: TemplateLineType
    amount: number
    runningBalance: number | null
  }>
  documentStatus: 'draft' | 'enviado' | 'final' | 'anulado'
}

type AggregatedTemplateLine = {
  date: string | null
  description: string
  type: TemplateLineType
  signedAmount: number
}

function mapDfpLineType(line: StatementLine, amount: number): TemplateLineType {
  const clientType = (line.client_type ?? '').toLowerCase()
  if (clientType === 'interest') return 'cargo_interes'
  if (clientType === 'fee') return 'cargo_fee'
  if (clientType === 'payment') return 'pago'
  if (clientType === 'credit') return 'credito'
  if (clientType === 'opening_balance') return 'saldo_apertura'

  const value = (line.entry_type ?? '').toLowerCase()
  const componentType = (line.component_type ?? '').toLowerCase()
  if (value.includes('principal_initial') || value.includes('saldo_apertura') || value.includes('opening')) return 'saldo_apertura'
  if (value.includes('finance_charge_accrual') || componentType.includes('interest') || value.includes('interest') || value.includes('interes')) return 'cargo_interes'
  if (componentType.includes('fee') || value.includes('fee') || value.includes('cargo_fee') || value.includes('late')) return 'cargo_fee'
  if (value.includes('payment') || value.includes('pago')) return 'pago'
  if (value.includes('credit') || value.includes('credito') || value.includes('refund') || value.includes('reversal')) return 'credito'
  if (value.includes('adjust') || value.includes('ajuste')) return 'ajuste'
  return amount < 0 ? 'pago' : 'ajuste'
}

function mapDocumentStatus(status: string): StatementPdfTemplateData['documentStatus'] {
  const value = status.toLowerCase()
  if (value.includes('anulad')) return 'anulado'
  if (value.includes('enviad')) return 'enviado'
  if (value.includes('final')) return 'final'
  return 'draft'
}

function buildClientLineDescription(entryType: string | null | undefined, componentType: string | null | undefined, fallback: string | null | undefined) {
  if (entryType === 'principal_initial' || entryType === 'saldo_apertura' || entryType === 'opening_balance') {
    return 'Saldo inicial / Opening balance'
  }
  if (entryType === 'finance_charge_accrual' && componentType === 'interest') {
    return 'Cargo por interés del período / Interest charge for this period'
  }
  if (entryType === 'payment_applied') {
    return 'Pago recibido / Payment received'
  }
  if (componentType === 'fee') {
    return 'Cargo del período / Period charge'
  }
  if ((entryType === 'adjustment' || entryType === 'reversal') && fallback && /credit|credito|refund|reembolso/i.test(fallback)) {
    return 'Crédito a la cuenta / Account credit'
  }
  if ((entryType === 'adjustment' || entryType === 'reversal')) {
    return 'Ajuste en la cuenta / Account adjustment'
  }
  if (fallback && /payment|pago/i.test(fallback)) {
    return 'Pago recibido / Payment received'
  }
  if (fallback && /interest|inter[eé]s/i.test(fallback)) {
    return 'Cargo por interés del período / Interest charge for this period'
  }
  return 'Movimiento en cuenta / Account activity'
}

function buildClientLineType(entryType: string | null | undefined, componentType: string | null | undefined, debitCredit: string | null | undefined) {
  if (entryType === 'finance_charge_accrual' && componentType === 'interest') return 'interest'
  if (entryType === 'payment_applied') return 'payment'
  if (componentType === 'fee') return 'fee'
  if ((entryType === 'adjustment' || entryType === 'reversal') && debitCredit === 'credit') return 'credit'
  if (entryType === 'principal_initial' || entryType === 'saldo_apertura' || entryType === 'opening_balance') return 'opening_balance'
  return 'adjustment'
}

function enrichStatementDataFromLedger(data: StatementData, statementLines: StatementLine[], ledgerRows: LedgerLineDetails[]) {
  const ledgerById = new Map(ledgerRows.map(row => [row.id, row]))

  data.lines = statementLines.map(line => {
    const ledger = line.ledger_entry_id ? ledgerById.get(line.ledger_entry_id) : undefined
    const entryType = ledger?.entry_type ?? line.entry_type
    const componentType = ledger?.component_type ?? line.component_type
    const debitCredit = ledger?.debit_credit ?? line.debit_credit ?? null
    const description = buildClientLineDescription(entryType, componentType, ledger?.description ?? line.description)
    const clientType = buildClientLineType(entryType, componentType, debitCredit)

    return {
      ...line,
      entry_type: entryType,
      component_type: componentType,
      debit_credit: debitCredit,
      ledger_metadata: ledger?.metadata ?? line.ledger_metadata ?? null,
      client_description: description,
      client_type: clientType,
    }
  })
}

function getLineSortValue(line: StatementLine) {
  return Number.isFinite(Number(line.line_order)) ? Number(line.line_order) : Number.MAX_SAFE_INTEGER
}

function getBatchId(metadata: Record<string, unknown> | null | undefined): string | null {
  const value = metadata?.batch_id
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function buildGroupedTemplateLines(data: StatementData): AggregatedTemplateLine[] {
  const sortedLines = [...data.lines].sort((a, b) => getLineSortValue(a) - getLineSortValue(b))
  const grouped: AggregatedTemplateLine[] = []
  const paymentBatchIndex = new Map<string, number>()
  let interestInsertIndex: number | null = null
  let lastInterestDate: string | null = null
  let hasInterestLine = false

  for (const line of sortedLines) {
    const signedAmount = Number(line.amount || 0)
    const lineType = mapDfpLineType(line, signedAmount)
    const lineDate = line.transaction_date
    const lineDescription = line.client_description || line.description || line.entry_type || 'Movimiento en cuenta / Account activity'

    if (lineType === 'cargo_interes') {
      hasInterestLine = true
      lastInterestDate = lineDate ?? lastInterestDate
      interestInsertIndex = grouped.length
      continue
    }

    if (lineType === 'pago') {
      const batchId = getBatchId(line.ledger_metadata)
      if (batchId) {
        const existingIndex = paymentBatchIndex.get(batchId)
        if (existingIndex != null) {
          grouped[existingIndex].signedAmount += signedAmount
          continue
        }

        paymentBatchIndex.set(batchId, grouped.length)
        grouped.push({
          date: lineDate,
          description: 'Pago recibido / Payment received',
          type: 'pago',
          signedAmount,
        })
        continue
      }
    }

    grouped.push({
      date: lineDate,
      description: lineDescription,
      type: lineType,
      signedAmount,
    })
  }

  const interestTotal = Number(data.cargos_interes_periodo || 0)
  if (hasInterestLine || interestTotal > 0) {
    const interestLine: AggregatedTemplateLine = {
      date: lastInterestDate ?? data.fecha_corte,
      description: 'Cargo por interés del período / Interest charge for this period',
      type: 'cargo_interes',
      signedAmount: interestTotal,
    }
    grouped.splice(interestInsertIndex ?? grouped.length, 0, interestLine)
  }

  return grouped
}

function toTemplateData(data: StatementData, cliente: ClienteDetails, caseEstado: string): StatementPdfTemplateData {
  let runningBalance = Number(data.balance_previo || 0)
  const lines = buildGroupedTemplateLines(data).map(line => {
    const signedAmount = Number(line.signedAmount || 0)
    runningBalance += signedAmount
    return {
      date: line.date,
      description: line.description,
      type: line.type,
      amount: Math.abs(signedAmount),
      runningBalance,
    }
  })

  return {
    accountType: 'dfp',
    caseId: data.case_id || data.statement_id,
    accountNumber: cliente.hycite_id || (data.case_id || data.statement_id).toUpperCase().slice(0, 8),
    emissionDate: data.fecha_corte,
    periodStart: data.periodo_inicio,
    periodEnd: data.periodo_fin,
    clientName: data.cliente_nombre || 'Cliente',
    address: cliente.direccion,
    city: cliente.ciudad,
    state: cliente.estado_region,
    zip: cliente.codigo_postal,
    phone: cliente.telefono,
    email: data.cliente_email,
    originalAmount: data.compras_periodo,
    previousBalance: data.balance_previo,
    paymentsAccumulated: 0,
    paymentsPeriod: data.pagos_periodo,
    creditsPeriod: data.otros_creditos,
    interestCharges: data.cargos_interes_periodo,
    feesPeriod: 0,
    pendingBalance: data.nuevo_balance,
    projectedDueBalance: null,
    agreedMonthlyPayment: data.pago_minimo,
    nextPaymentDate: data.fecha_vencimiento,
    accountStatus: caseEstado,
    approvalDate: null,
    statementDate: data.fecha_corte,
    dueDate: data.fecha_vencimiento,
    apr: data.apr_tae,
    ytdInterest: data.ytd_cargos_interes,
    ytdFees: data.ytd_cargos_atraso,
    paymentMethodsText: data.metodos_pago,
    statementReference: `STMT-${data.statement_id.slice(0, 8).toUpperCase()}`,
    paymentMessage: data.mensaje_pago,
    lines,
    documentStatus: mapDocumentStatus(data.status),
  }
}

async function buildStatementPdf(data: StatementPdfTemplateData): Promise<Uint8Array> {
  const element = createElement(StatementPdfTemplate, { data })
  const buffer = await renderToBuffer(element)
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
}

function renderPaymentMethods(methods: string | null | undefined): string {
  if (!methods?.trim()) {
    return 'Telefono / Phone: 786-291-3042<br />Email: info@connectionworldwidegroup.com'
  }

  return methods
    .split(/\r?\n+/)
    .map(line => escapeHtml(line.trim()))
    .filter(Boolean)
    .map(line => `${line}<br />`)
    .join('')
}

function buildEmailHtml(data: StatementData): string {
  const nombre = escapeHtml(data.cliente_nombre)
  const periodStart = escapeHtml(formatLongDate(data.periodo_inicio))
  const periodEnd = escapeHtml(formatLongDate(data.periodo_fin))
  const statementRef = escapeHtml(`STMT-${data.statement_id.slice(0, 8).toUpperCase()}`)
  return `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#1f2937;background:#f8fafc">
      <div style="background:linear-gradient(135deg,#0f2044 0%,#1d4ed8 100%);padding:24px 28px;border-radius:18px 18px 0 0;color:#ffffff">
        <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85">Connection Worldwide Group</div>
        <h1 style="margin:10px 0 6px;font-size:28px;line-height:1.1">Estado de cuenta / Monthly statement</h1>
        <div style="font-size:14px;opacity:0.92">Referencia / Reference: ${statementRef}</div>
      </div>
      <div style="background:#ffffff;padding:28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 18px 18px">
        <p style="margin:0 0 10px;font-size:16px;color:#0f172a">Hola ${nombre},</p>
        <p style="margin:0 0 18px;color:#475569;font-size:14px;line-height:1.7">
          Adjunto encontraras tu estado de cuenta completo del periodo ${periodStart} al ${periodEnd}, con el detalle de tu balance, pagos e intereses.<br />
          Attached you will find your complete account statement for the period from ${periodStart} to ${periodEnd}, with the detail of your balance, payments, and interest.
        </p>

        <p style="margin:18px 0 0;color:#64748b;font-size:13px;line-height:1.7">
          Este resumen es informativo y no reemplaza tu acuerdo original.<br />
          This summary is for informational purposes and does not replace your original agreement.
        </p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0" />
        <p style="color:#6b7280;font-size:12px;line-height:1.6;text-align:center;margin:0">
        Connection Worldwide Group<br />
        Distribuidor autorizado de Royal Prestige<br />
        Tel: 786-291-3042
      </p>
    </div>
  `
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) })
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405)

  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(req, { error: 'Missing service role configuration' }, 500)
  if (!resendKey) return jsonResponse(req, { error: 'Missing Resend API key' }, 500)

  const requester = await authorizeRequest(req)
  if (requester instanceof Response) return requester

  let payload: { statement_id?: string; test_email_override?: string }
  try {
    payload = await req.json()
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON body' }, 400)
  }

  const statementId = payload.statement_id
  if (!statementId) return jsonResponse(req, { error: 'statement_id is required' }, 400)

  const testOverride = payload.test_email_override?.trim() || null
  const isTestMode = !!testOverride

  if (!isTestMode) {
    const { data: existingLog } = await supabase
      .from('statement_delivery_logs')
      .select('id, email_status')
      .eq('document_type', 'dfp_statement')
      .eq('document_id', statementId)
      .eq('email_status', 'sent')
      .maybeSingle()

    if (existingLog) return jsonResponse(req, { ok: true, skipped: true, reason: 'already_sent' })
  }

  const { data: statementData, error: dataError } = await supabase.rpc('fn_cob_get_statement_data', { p_statement_id: statementId })

  if (dataError || !statementData) {
    return jsonResponse(req, { error: 'No se pudo obtener datos del statement', details: dataError?.message }, 404)
  }

  const data = statementData as StatementData
  if (requester.mode === 'user' && data.org_id !== requester.orgId) {
    return jsonResponse(req, { error: 'Forbidden for this organization' }, 403)
  }
  const emailTo = testOverride || data.cliente_email

  const [clienteRes, statementExtraRes, statementLinesRes, caseRes] = await Promise.all([
    supabase
      .from('clientes')
      .select('hycite_id,telefono,direccion,ciudad,estado_region,codigo_postal')
      .eq('id', data.cliente_id)
      .single(),
    supabase
      .from('cob_statements')
      .select('tasa_diaria,balance_sujeto_interes,dias_ciclo_facturacion,metodos_pago,mensaje_pago,ytd_cargos_atraso,ytd_cargos_interes')
      .eq('id', statementId)
      .single(),
    supabase
      .from('cob_statement_lines')
      .select('line_order,transaction_date,entry_type,component_type,description,amount,ledger_entry_id')
      .eq('statement_id', statementId)
      .order('line_order', { ascending: true }),
    data.case_id
      ? supabase.from('cargo_vuelta_cases').select('estado').eq('id', data.case_id).single()
      : Promise.resolve({ data: null, error: null }),
  ])

  const { data: clienteData, error: clienteError } = clienteRes
  const { data: statementExtra, error: statementExtraError } = statementExtraRes
  const { data: statementLinesData, error: statementLinesError } = statementLinesRes
  const { data: caseData, error: caseError } = caseRes

  if (clienteError || !clienteData) {
    return jsonResponse(req, { error: 'No se pudo obtener datos del cliente', details: clienteError?.message }, 500)
  }

  if (statementExtraError || !statementExtra) {
    return jsonResponse(req, { error: 'No se pudo obtener detalles extendidos del statement', details: statementExtraError?.message }, 500)
  }

  if (statementLinesError) {
    return jsonResponse(req, { error: 'No se pudo obtener líneas del statement', details: statementLinesError.message }, 500)
  }

  if (data.case_id && caseError) {
    return jsonResponse(req, { error: 'No se pudo obtener estado del caso', details: caseError.message }, 500)
  }

  Object.assign(data, statementExtra)

  const statementLines = ((statementLinesData ?? []) as StatementLine[])
  const ledgerIds = Array.from(new Set(statementLines.map(line => line.ledger_entry_id).filter((value): value is string => !!value)))

  if (ledgerIds.length > 0) {
    const { data: ledgerRowsData, error: ledgerRowsError } = await supabase
      .from('cob_financial_ledger')
      .select('id,entry_type,component_type,description,debit_credit,metadata,accrual_from,accrual_to,amount')
      .in('id', ledgerIds)

    if (ledgerRowsError) {
      return jsonResponse(req, { error: 'No se pudo obtener ledger del statement', details: ledgerRowsError.message }, 500)
    }

    enrichStatementDataFromLedger(data, statementLines, (ledgerRowsData ?? []) as LedgerLineDetails[])
  } else {
    data.lines = statementLines
  }

  if (!emailTo) {
    const { error: logError } = await supabase.from('statement_delivery_logs').insert({
      org_id: data.org_id,
      document_type: 'dfp_statement',
      document_id: statementId,
      case_id: data.case_id,
      cliente_id: data.cliente_id,
      email_to: null,
      email_status: 'failed',
      email_error: 'Cliente sin email registrado',
      delivery_attempt_count: 1,
      last_delivery_attempt_at: new Date().toISOString(),
      metadata: data,
    })
    if (logError) console.error('Fallo al escribir statement_delivery_logs:', logError)
    return jsonResponse(req, { ok: false, error: 'Cliente sin email registrado' }, 200)
  }

  const pdfData = toTemplateData(data, clienteData as ClienteDetails, (caseData?.estado as string | null) ?? 'Sin estado')

  let pdfBytes: Uint8Array
  try {
    pdfBytes = await buildStatementPdf(pdfData)
  } catch (e) {
    return jsonResponse(req, { error: 'Fallo al generar el PDF', details: String(e) }, 500)
  }

  const storagePath = isTestMode
    ? `_test/${statementId}-${Date.now()}.pdf`
    : `${data.org_id}/${data.cliente_id}/${statementId}.pdf`
  const { error: uploadError } = await supabase.storage
    .from('statement_pdfs')
    .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true })

  if (uploadError) {
    return jsonResponse(req, { error: 'Fallo al subir el PDF a Storage', details: uploadError.message }, 500)
  }

  const html = buildEmailHtml(data)
  const pdfBase64 = toBase64(pdfBytes)

  const resendPayload = {
    from: resendFrom,
    to: emailTo,
    subject: `Estado de cuenta / Statement - ${formatShortDate(data.periodo_fin)}`,
    html,
    text:
      `Estado de cuenta / Statement\n` +
      `Referencia / Reference: STMT-${data.statement_id.slice(0, 8).toUpperCase()}\n` +
      `Periodo / Period: ${formatLongDate(data.periodo_inicio)} - ${formatLongDate(data.periodo_fin)}\n` +
      `Nuevo balance / New balance: ${formatMoney(data.nuevo_balance)}\n` +
      `Pago minimo / Minimum payment: ${formatMoney(data.pago_minimo)}\n` +
      `Fecha de vencimiento / Due date: ${formatShortDate(data.fecha_vencimiento)}\n`,
    attachments: [
      {
        filename: `estado-de-cuenta-${data.periodo_fin}.pdf`,
        content: pdfBase64,
      },
    ],
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify(resendPayload),
  })

  const ok = res.ok
  const responseText = await res.text()
  let logError: { message: string } | null = null
  const deliveryStatus = ok ? (isTestMode ? 'test_sent' : 'sent') : 'failed'
  const logMetadata = {
    ...data,
    test_mode: isTestMode,
    test_email_override: testOverride,
  }

  const { error } = await supabase.from('statement_delivery_logs').insert({
    org_id: data.org_id,
    document_type: 'dfp_statement',
    document_id: statementId,
    case_id: data.case_id,
    cliente_id: data.cliente_id,
    pdf_storage_path: storagePath,
    pdf_generated_at: new Date().toISOString(),
    email_to: emailTo,
    email_status: deliveryStatus,
    email_sent_at: ok ? new Date().toISOString() : null,
    email_error: ok ? null : responseText,
    delivery_attempt_count: 1,
    last_delivery_attempt_at: new Date().toISOString(),
    metadata: logMetadata,
  })
  logError = error

  if (logError) console.error('Fallo al escribir statement_delivery_logs:', logError)

  if (ok && !isTestMode) {
    const { error: updateError } = await supabase
      .from('cob_statements')
      .update({ status: 'enviado', enviado_at: new Date().toISOString(), pdf_url: storagePath })
      .eq('id', statementId)
    if (updateError) console.error('Fallo al actualizar cob_statements:', updateError)
  }

  if (!ok) {
    return jsonResponse(req, {
      ok: false,
      error: 'Resend API error',
      details: responseText,
      test_mode: isTestMode,
      warning: logError ? 'Ademas fallo el log de idempotencia' : undefined,
    }, 502)
  }

  return jsonResponse(req, {
    ok: true,
    email_to: emailTo,
    pdf_storage_path: storagePath,
    test_mode: isTestMode,
    requested_by: requester.mode === 'user' ? requester.userId : 'worker',
    warning: logError ? 'Email enviado pero el log de idempotencia no se pudo escribir' : undefined,
  })
})
