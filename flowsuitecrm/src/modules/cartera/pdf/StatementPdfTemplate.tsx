import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from '@react-pdf/renderer'
import type { StatementPdfData, StatementLine } from './statementPdfTypes'
import { CWG, COLORS, FONTS, ACCOUNT_TYPE_LABEL, LINE_TYPE_LABEL } from './pdfConstants'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`
}

function fmtPercentDecimal(n: number | null | undefined): string {
  if (n == null) return 'APR pendiente'
  return `${(n * 100).toFixed(2)}%`
}

function lineIsDebit(line: StatementLine): boolean {
  return line.type === 'saldo_apertura' || line.type === 'cargo_interes' || line.type === 'cargo_fee'
}

function lineColor(line: StatementLine): string {
  if (line.type === 'pago' || line.type === 'credito' || line.type === 'ajuste') return COLORS.green
  if (line.type === 'cargo_interes' || line.type === 'cargo_fee') return COLORS.red
  return COLORS.text
}

function accountStatusBadge(status: string): { label: string; bg: string; color: string } {
  const s = status.toLowerCase()
  if (s.includes('acuerdo') || s.includes('pagando') || s.includes('negociación')) {
    return { label: status.toUpperCase(), bg: COLORS.greenLight, color: COLORS.green }
  }
  if (s.includes('abierto') || s.includes('moroso') || s.includes('vencido')) {
    return { label: status.toUpperCase(), bg: COLORS.redLight, color: COLORS.red }
  }
  return { label: status.toUpperCase(), bg: COLORS.blueLight, color: COLORS.blue }
}

function buildClientMessage(data: StatementPdfData): { icon: string; title: string; body: string } {
  const { pendingBalance, agreedMonthlyPayment, nextPaymentDate, accountStatus } = data
  const s = accountStatus.toLowerCase()
  const hasAgreement = s.includes('acuerdo') || s.includes('negociación')
  const isDelinquent = s.includes('moroso') || s.includes('vencido') || s.includes('abierto')

  if (isDelinquent) {
    return {
      icon: '!',
      title: 'Su cuenta tiene saldo vencido',
      body: `Tiene un saldo pendiente de ${fmtMoney(pendingBalance)}. Por favor, contáctenos hoy mismo para ponerse al día o establecer un acuerdo de pago. Llámenos al ${CWG.phone}.`,
    }
  }
  if (hasAgreement && agreedMonthlyPayment) {
    const dateStr = nextPaymentDate ? fmtDate(nextPaymentDate) : 'por confirmar'
    return {
      icon: '✓',
      title: '¡Gracias por su pago!',
      body: `Su cuenta se encuentra al día con el acuerdo establecido. Su próximo pago de ${fmtMoney(agreedMonthlyPayment)} está programado para el ${dateStr}.`,
    }
  }
  return {
    icon: '✓',
    title: '¡Gracias por confiar en nosotros!',
    body: `Tiene un saldo pendiente de ${fmtMoney(pendingBalance)}. Si tiene preguntas sobre su cuenta, contáctenos al ${CWG.phone}.`,
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: { fontFamily: FONTS.regular, fontSize: 8, color: COLORS.text, paddingBottom: 20 },

  // Header
  headerBar: { backgroundColor: COLORS.navy, padding: '10 14', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flex: 1 },
  headerCenter: { flex: 1.4, alignItems: 'center' },
  headerRight: { flex: 1, alignItems: 'flex-end' },
  companyName: { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.white, letterSpacing: 0.5 },
  companyTagline: { fontSize: 6.5, color: '#94a3b8', marginTop: 2 },
  statementTitle: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.white, textTransform: 'uppercase', letterSpacing: 1 },
  statementSubtitle: { fontSize: 7, color: '#93c5fd', marginTop: 3, textAlign: 'center' },
  accountTypeTag: { fontSize: 6, color: '#fbbf24', marginTop: 5, textAlign: 'center', letterSpacing: 0.5 },
  pageNum: { fontSize: 6.5, color: '#94a3b8', marginBottom: 4, textAlign: 'right' },
  headerMetaLabel: { fontSize: 6, color: '#94a3b8', marginBottom: 1 },
  headerMetaValue: { fontSize: 7.5, fontFamily: FONTS.bold, color: COLORS.white },
  headerMetaRow: { marginBottom: 5 },

  // Section header
  sectionHeader: { backgroundColor: COLORS.navy, padding: '4 8', flexDirection: 'row', alignItems: 'center' },
  sectionHeaderText: { fontSize: 7.5, fontFamily: FONTS.bold, color: COLORS.white, letterSpacing: 0.6, textTransform: 'uppercase' },

  // 3-col info zone
  infoZone: { flexDirection: 'row', borderBottom: `1 solid ${COLORS.border}` },
  infoCol: { flex: 1, padding: '8 10', borderRight: `1 solid ${COLORS.border}` },
  infoColLast: { flex: 1, padding: '8 10' },
  infoColHeader: { fontSize: 6.5, fontFamily: FONTS.bold, color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, borderBottom: `1 solid ${COLORS.navy}`, paddingBottom: 3 },

  // Client data
  clientName: { fontSize: 9, fontFamily: FONTS.bold, color: COLORS.navy, marginBottom: 4 },
  clientRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2.5 },
  clientIcon: { fontSize: 7, color: COLORS.gray, width: 10 },
  clientText: { fontSize: 7, color: COLORS.text, flex: 1 },

  // Summary rows
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3, paddingBottom: 3 },
  summaryLabel: { fontSize: 7, color: COLORS.text, flex: 1 },
  summaryValue: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.text, textAlign: 'right' },
  summaryValueGreen: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.green, textAlign: 'right' },
  summaryDivider: { borderBottom: `0.5 solid ${COLORS.border}`, marginBottom: 3 },
  summaryTotal: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2, padding: '4 6', backgroundColor: COLORS.navy, borderRadius: 3 },
  summaryTotalLabel: { fontSize: 7.5, fontFamily: FONTS.bold, color: COLORS.white },
  summaryTotalValue: { fontSize: 9, fontFamily: FONTS.bold, color: '#fbbf24' },

  // Payment info card
  paymentCard: { marginBottom: 6, padding: '5 8', backgroundColor: COLORS.grayLight, borderRadius: 3, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paymentCardLabel: { fontSize: 6, color: COLORS.gray, textTransform: 'uppercase', letterSpacing: 0.3 },
  paymentCardValue: { fontSize: 9, fontFamily: FONTS.bold, color: COLORS.navy },
  paymentCardValueRed: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.red },
  paymentCardValueGreen: { fontSize: 7.5, fontFamily: FONTS.bold },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },

  // Transactions table
  tableZone: { margin: '0 14', marginBottom: 8 },
  tableHeader: { flexDirection: 'row', backgroundColor: COLORS.navyMid, padding: '4 6' },
  tableHeaderCell: { fontSize: 6.5, fontFamily: FONTS.bold, color: COLORS.white, textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', padding: '4 6', borderBottom: `0.5 solid ${COLORS.border}` },
  tableRowAlt: { flexDirection: 'row', padding: '4 6', borderBottom: `0.5 solid ${COLORS.border}`, backgroundColor: COLORS.grayLight },
  tableCell: { fontSize: 7, color: COLORS.text },
  tableCellGreen: { fontSize: 7, color: COLORS.green, fontFamily: FONTS.bold },
  tableCellRed: { fontSize: 7, color: COLORS.red },
  tableEmpty: { padding: '10 6', fontSize: 7.5, color: COLORS.gray, textAlign: 'center' },

  // Client message zone
  msgZone: { margin: '0 14', marginBottom: 8, flexDirection: 'row', gap: 8 },
  msgBox: { flex: 1.4, padding: '8 10', border: `1 solid ${COLORS.border}`, borderRadius: 4 },
  msgBoxHeader: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  msgIconRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  msgIcon: { fontSize: 10, marginRight: 5, color: COLORS.green },
  msgTitle: { fontSize: 7.5, fontFamily: FONTS.bold, color: COLORS.navy, marginBottom: 2 },
  msgBody: { fontSize: 6.5, color: COLORS.text, lineHeight: 1.5 },

  // Payment options
  optionsBox: { flex: 1, padding: '8 10', border: `1 solid ${COLORS.border}`, borderRadius: 4 },
  optionsHeader: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  optionRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 5 },
  optionIcon: { fontSize: 8, marginRight: 5, color: COLORS.blue },
  optionLabel: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.navy, marginBottom: 1 },
  optionValue: { fontSize: 6.5, color: COLORS.text },

  // Coupon
  couponBox: { flex: 0.9, padding: '8 10', border: `1.5 dashed ${COLORS.navyMid}`, borderRadius: 4 },
  couponHeader: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  couponLabel: { fontSize: 5.5, color: COLORS.gray, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 1 },
  couponAmount: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.red, marginBottom: 5 },
  couponValue: { fontSize: 7.5, fontFamily: FONTS.bold, color: COLORS.navy, marginBottom: 4 },

  // Footer bar
  footerBar: { backgroundColor: COLORS.grayLight, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', padding: '6 14', borderTop: `1 solid ${COLORS.border}` },
  footerItem: { flexDirection: 'row', alignItems: 'center' },
  footerIcon: { fontSize: 8, marginRight: 4, color: COLORS.blue },
  footerText: { fontSize: 6.5, color: COLORS.text },
  footerTextBold: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.navy },
  footerCopyright: { backgroundColor: COLORS.navy, padding: '4 14', flexDirection: 'row', justifyContent: 'space-between' },
  footerCopyrightText: { fontSize: 5.5, color: '#94a3b8' },

  // Page 2
  p2Header: { backgroundColor: COLORS.navy, padding: '10 14', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  p2HeaderLeft: { flex: 1 },
  p2HeaderCenter: { flex: 1.4, alignItems: 'center' },
  p2HeaderRight: { flex: 1, alignItems: 'flex-end' },
  p2Title: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.white, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.5 },
  p2Grid: { flexDirection: 'row', flexWrap: 'wrap', margin: '8 14', gap: 8 },
  p2Card: { width: '48%', padding: '8 10', border: `1 solid ${COLORS.border}`, borderRadius: 4 },
  p2CardNum: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.blueLight, marginBottom: 2 },
  p2CardTitle: { fontSize: 7.5, fontFamily: FONTS.bold, color: COLORS.navy, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 },
  p2CardBody: { fontSize: 6.5, color: COLORS.text, lineHeight: 1.6 },
  p2CardBold: { fontFamily: FONTS.bold, color: COLORS.navy },
  p2Footer: { backgroundColor: COLORS.navy, padding: '4 14', margin: '0' },
  p2FooterText: { fontSize: 5.5, color: '#94a3b8', textAlign: 'center' },
})

// ── Sub-components ────────────────────────────────────────────────────────────

function PageHeader({ data, pageNum }: { data: StatementPdfData; pageNum: string }) {
  const isCv = data.accountType === 'cargo_vuelta'
  return (
    <View style={s.headerBar}>
      <View style={s.headerLeft}>
        <Text style={s.companyName}>{CWG.name}</Text>
        <Text style={s.companyTagline}>{CWG.tagline}</Text>
      </View>
      <View style={s.headerCenter}>
        <Text style={s.pageNum}>{pageNum}</Text>
        <Text style={s.statementTitle}>Estado de Cuenta</Text>
        <Text style={s.statementSubtitle}>Gracias por confiar en Connection Worldwide Group.</Text>
        <Text style={s.accountTypeTag}>Tipo de cuenta: {ACCOUNT_TYPE_LABEL[data.accountType] ?? data.accountType}</Text>
      </View>
      <View style={s.headerRight}>
        <View style={s.headerMetaRow}>
          <Text style={s.headerMetaLabel}>FECHA DE EMISIÓN</Text>
          <Text style={s.headerMetaValue}>{fmtDate(data.emissionDate)}</Text>
        </View>
        <View style={s.headerMetaRow}>
          <Text style={s.headerMetaLabel}>PERÍODO DEL ESTADO</Text>
          <Text style={s.headerMetaValue}>{fmtDate(data.periodStart)} – {fmtDate(data.periodEnd)}</Text>
        </View>
        {isCv && (
          <>
            <View style={s.headerMetaRow}>
              <Text style={s.headerMetaLabel}>FECHA DE APROBACIÓN</Text>
              <Text style={s.headerMetaValue}>{fmtDate(data.approvalDate)}</Text>
            </View>
            <View style={s.headerMetaRow}>
              <Text style={s.headerMetaLabel}>STATEMENT DATE</Text>
              <Text style={s.headerMetaValue}>{fmtDate(data.statementDate)}</Text>
            </View>
            <View style={s.headerMetaRow}>
              <Text style={s.headerMetaLabel}>DUE DATE</Text>
              <Text style={s.headerMetaValue}>{fmtDate(data.dueDate)}</Text>
            </View>
          </>
        )}
        <View>
          <Text style={s.headerMetaLabel}>NÚMERO DE CUENTA / CASO</Text>
          <Text style={s.headerMetaValue}>{data.accountNumber}</Text>
        </View>
      </View>
    </View>
  )
}

function ClientInfoCol({ data }: { data: StatementPdfData }) {
  return (
    <View style={s.infoCol}>
      <Text style={s.infoColHeader}>Datos del Cliente</Text>
      <Text style={s.clientName}>{data.clientName}</Text>
      {data.address && (
        <View style={s.clientRow}>
          <Text style={s.clientIcon}>@</Text>
          <Text style={s.clientText}>{data.address}</Text>
        </View>
      )}
      {(data.city || data.state) && (
        <View style={s.clientRow}>
          <Text style={s.clientIcon}> </Text>
          <Text style={s.clientText}>{[data.city, data.state, data.zip].filter(Boolean).join(', ')}</Text>
        </View>
      )}
      {data.phone && (
        <View style={s.clientRow}>
          <Text style={s.clientIcon}>T</Text>
          <Text style={s.clientText}>{data.phone}</Text>
        </View>
      )}
      {data.email && (
        <View style={s.clientRow}>
          <Text style={s.clientIcon}>E</Text>
          <Text style={s.clientText}>{data.email}</Text>
        </View>
      )}
    </View>
  )
}

function AccountSummaryCol({ data }: { data: StatementPdfData }) {
  const isDfp = data.accountType === 'dfp'
  return (
    <View style={s.infoCol}>
      <Text style={s.infoColHeader}>Resumen de Cuenta</Text>

      {isDfp ? (
        <>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Balance previo</Text>
            <Text style={s.summaryValue}>{fmtMoney(data.previousBalance)}</Text>
          </View>
          {data.interestCharges > 0 && (
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Cargo de interés ({data.apr != null ? `${(data.apr * 100).toFixed(2)}% APR` : ''})</Text>
              <Text style={s.summaryValue}>{fmtMoney(data.interestCharges)}</Text>
            </View>
          )}
          {data.feesPeriod > 0 && (
            <View style={s.summaryRow}>
              <Text style={s.summaryLabel}>Cargos / fees</Text>
              <Text style={s.summaryValue}>{fmtMoney(data.feesPeriod)}</Text>
            </View>
          )}
        </>
      ) : (
        <>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Monto original del cargo de vuelta</Text>
            <Text style={s.summaryValue}>{fmtMoney(data.originalAmount)}</Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Pagos acumulados (anteriores al período)</Text>
            <Text style={s.summaryValueGreen}>-{fmtMoney(data.paymentsAccumulated - data.paymentsPeriod)}</Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>APR acordado</Text>
            <Text style={s.summaryValue}>{fmtPercentDecimal(data.interestApr)}</Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Período de interés</Text>
            <Text style={s.summaryValue}>
              {data.interestPeriodStart && data.interestPeriodEnd
                ? `${fmtDate(data.interestPeriodStart)} – ${fmtDate(data.interestPeriodEnd)}`
                : 'Pendiente'}
            </Text>
          </View>
        </>
      )}

      {data.paymentsPeriod > 0 && (
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>Pagos recibidos en este período</Text>
          <Text style={s.summaryValueGreen}>-{fmtMoney(data.paymentsPeriod)}</Text>
        </View>
      )}

      {data.creditsPeriod > 0 && (
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>Créditos / Ajustes por devolución de mercancía</Text>
          <Text style={s.summaryValueGreen}>-{fmtMoney(data.creditsPeriod)}</Text>
        </View>
      )}

      {data.feesPeriod > 0 && !isDfp && (
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>Fee de plataforma (no reduce balance)</Text>
          <Text style={s.summaryValue}>{fmtMoney(data.feesPeriod)}</Text>
        </View>
      )}

      {!isDfp && (
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>Interés proyectado</Text>
          <Text style={s.summaryValue}>{fmtMoney(data.interestCharges)}</Text>
        </View>
      )}

      <View style={s.summaryDivider} />
      <View style={s.summaryTotal}>
        <Text style={s.summaryTotalLabel}>
          {isDfp ? `Saldo Pendiente al ${fmtDate(data.emissionDate)}` : `Saldo al statement (${fmtDate(data.statementDate ?? data.emissionDate)})`}
        </Text>
        <Text style={s.summaryTotalValue}>{fmtMoney(data.pendingBalance)}</Text>
      </View>
      {!isDfp && (
        <View style={[s.summaryTotal, { marginTop: 6, backgroundColor: COLORS.blueMid }]}>
          <Text style={s.summaryTotalLabel}>Total proyectado al due date</Text>
          <Text style={s.summaryTotalValue}>{fmtMoney(data.projectedDueBalance)}</Text>
        </View>
      )}
    </View>
  )
}

function PaymentInfoCol({ data }: { data: StatementPdfData }) {
  const isCv = data.accountType === 'cargo_vuelta'
  const badge = accountStatusBadge(data.accountStatus)
  return (
    <View style={s.infoColLast}>
      <Text style={s.infoColHeader}>Información de Pagos</Text>

      <View style={s.paymentCard}>
        <View>
          <Text style={s.paymentCardLabel}>Pago acordado mensual</Text>
          <Text style={s.paymentCardValue}>
            {data.agreedMonthlyPayment != null ? fmtMoney(data.agreedMonthlyPayment) : '—'}
          </Text>
        </View>
      </View>

      <View style={s.paymentCard}>
        <View>
          <Text style={s.paymentCardLabel}>{isCv ? 'Due date' : 'Fecha de próximo pago'}</Text>
          <Text style={s.paymentCardValue}>
            {isCv
              ? fmtDate(data.dueDate ?? data.nextPaymentDate)
              : data.nextPaymentDate ? fmtDate(data.nextPaymentDate) : 'Por confirmar'}
          </Text>
        </View>
      </View>

      <View style={[s.paymentCard, { flexDirection: 'column', alignItems: 'flex-start' }]}>
        <Text style={s.paymentCardLabel}>{isCv ? 'Saldo al statement' : 'Saldo pendiente'}</Text>
        <Text style={s.paymentCardValueRed}>{fmtMoney(data.pendingBalance)}</Text>
      </View>

      {isCv && (
        <>
          <View style={[s.paymentCard, { flexDirection: 'column', alignItems: 'flex-start' }]}>
            <Text style={s.paymentCardLabel}>Total proyectado al vencimiento</Text>
            <Text style={s.paymentCardValue}>{fmtMoney(data.projectedDueBalance)}</Text>
          </View>
          <View style={s.paymentCard}>
            <View>
              <Text style={s.paymentCardLabel}>APR acordado</Text>
              <Text style={s.paymentCardValue}>{fmtPercentDecimal(data.interestApr)}</Text>
            </View>
          </View>
        </>
      )}

      <View style={s.paymentCard}>
        <View style={{ flex: 1 }}>
          <Text style={s.paymentCardLabel}>Estado de la cuenta</Text>
        </View>
        <View style={[s.statusBadge, { backgroundColor: badge.bg }]}>
          <Text style={[s.paymentCardValueGreen, { color: badge.color }]}>{badge.label}</Text>
        </View>
      </View>

      {data.accountType === 'dfp' && data.apr != null && (
        <View style={s.paymentCard}>
          <View>
            <Text style={s.paymentCardLabel}>Tasa Anual (APR/TAE)</Text>
            <Text style={s.paymentCardValue}>{(data.apr * 100).toFixed(2)}%</Text>
          </View>
        </View>
      )}
    </View>
  )
}

function TransactionsTable({ lines }: { lines: StatementLine[] }) {
  const dataLines = lines.filter(l => l.type !== 'saldo_cierre' && l.type !== 'proximo_pago')
  return (
    <View style={s.tableZone}>
      <View style={s.sectionHeader}>
        <Text style={s.sectionHeaderText}>Detalle de Transacciones</Text>
      </View>
      <View style={s.tableHeader}>
        <Text style={[s.tableHeaderCell, { width: '13%' }]}>Fecha</Text>
        <Text style={[s.tableHeaderCell, { flex: 1 }]}>Descripción</Text>
        <Text style={[s.tableHeaderCell, { width: '14%' }]}>Tipo</Text>
        <Text style={[s.tableHeaderCell, { width: '13%', textAlign: 'right' }]}>Monto</Text>
        <Text style={[s.tableHeaderCell, { width: '16%', textAlign: 'right' }]}>Balance</Text>
      </View>
      {dataLines.length === 0 ? (
        <Text style={s.tableEmpty}>Sin transacciones en este período.</Text>
      ) : (
        dataLines.map((line, i) => {
          const isAlt = i % 2 === 1
          const isCredit = !lineIsDebit(line)
          const color = lineColor(line)
          return (
            <View key={i} style={isAlt ? s.tableRowAlt : s.tableRow}>
              <Text style={[s.tableCell, { width: '13%' }]}>{fmtDate(line.date)}</Text>
              <Text style={[s.tableCell, { flex: 1 }]}>{line.description}</Text>
              <Text style={[s.tableCell, { width: '14%', color }]}>{LINE_TYPE_LABEL[line.type] ?? line.type}</Text>
              <Text style={[s.tableCell, { width: '13%', textAlign: 'right', color, fontFamily: isCredit ? FONTS.bold : FONTS.regular }]}>
                {isCredit ? '-' : ''}{fmtMoney(line.amount)}
              </Text>
              <Text style={[s.tableCell, { width: '16%', textAlign: 'right' }]}>
                {line.runningBalance != null ? fmtMoney(line.runningBalance) : '—'}
              </Text>
            </View>
          )
        })
      )}
    </View>
  )
}

function ClientMessageZone({ data }: { data: StatementPdfData }) {
  const msg = buildClientMessage(data)
  const isPositive = msg.icon === '✓'
  return (
    <View style={s.msgZone}>
      {/* Message */}
      <View style={s.msgBox}>
        <Text style={s.msgBoxHeader}>Mensaje para Usted</Text>
        <View style={s.msgIconRow}>
          <Text style={[s.msgIcon, { color: isPositive ? COLORS.green : COLORS.red }]}>{msg.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.msgTitle}>{msg.title}</Text>
            <Text style={s.msgBody}>{msg.body}</Text>
          </View>
        </View>
      </View>

      {/* Payment options */}
      <View style={s.optionsBox}>
        <Text style={s.optionsHeader}>Opciones de Pago</Text>
        <View style={s.optionRow}>
          <Text style={s.optionIcon}>$</Text>
          <View>
            <Text style={s.optionLabel}>Pague en Línea</Text>
            <Text style={s.optionValue}>{CWG.paymentUrl}</Text>
          </View>
        </View>
        <View style={s.optionRow}>
          <Text style={s.optionIcon}>T</Text>
          <View>
            <Text style={s.optionLabel}>Pago por Teléfono</Text>
            <Text style={s.optionValue}>{CWG.phone}</Text>
          </View>
        </View>
        <View style={s.optionRow}>
          <Text style={s.optionIcon}>B</Text>
          <View>
            <Text style={s.optionLabel}>Transferencia Bancaria</Text>
            <Text style={s.optionValue}>Contáctenos para obtener instrucciones.</Text>
          </View>
        </View>
      </View>

      {/* Coupon */}
      <View style={s.couponBox}>
        <Text style={s.couponHeader}>Cupón de Pago</Text>

        <Text style={s.couponLabel}>{data.accountType === 'cargo_vuelta' ? 'Total proyectado a pagar' : 'Cantidad a pagar'}</Text>
        <Text style={s.couponAmount}>
          {data.accountType === 'cargo_vuelta'
            ? fmtMoney(data.projectedDueBalance ?? data.pendingBalance)
            : data.agreedMonthlyPayment != null ? fmtMoney(data.agreedMonthlyPayment) : fmtMoney(data.pendingBalance)}
        </Text>

        <Text style={s.couponLabel}>{data.accountType === 'cargo_vuelta' ? 'Due date' : 'Fecha de vencimiento'}</Text>
        <Text style={s.couponValue}>
          {data.accountType === 'cargo_vuelta'
            ? fmtDate(data.dueDate ?? data.nextPaymentDate)
            : data.nextPaymentDate ? fmtDate(data.nextPaymentDate) : 'Por confirmar'}
        </Text>

        <Text style={s.couponLabel}>Número de cuenta / caso</Text>
        <Text style={[s.couponValue, { fontSize: 7 }]}>{data.accountNumber}</Text>

        <Text style={s.couponLabel}>Teléfono de contacto</Text>
        <Text style={s.couponValue}>{CWG.phone}</Text>
      </View>
    </View>
  )
}

function FooterBar() {
  return (
    <>
      <View style={s.footerBar}>
        <View style={s.footerItem}>
          <Text style={s.footerIcon}>?</Text>
          <View>
            <Text style={s.footerTextBold}>¿Preguntas? Servicio al Cliente:</Text>
            <Text style={[s.footerTextBold, { color: COLORS.blue }]}>{CWG.phone}</Text>
          </View>
        </View>
        <View style={s.footerItem}>
          <Text style={s.footerIcon}>@</Text>
          <Text style={s.footerText}>{CWG.email}</Text>
        </View>
        <View style={s.footerItem}>
          <Text style={s.footerIcon}>H</Text>
          <Text style={s.footerText}>{CWG.hours}</Text>
        </View>
      </View>
      <View style={s.footerCopyright}>
        <Text style={s.footerCopyrightText}>
          Esta información es solo un estado de cuenta. No constituye aviso legal.
        </Text>
        <Text style={s.footerCopyrightText}>{CWG.copyright}</Text>
      </View>
    </>
  )
}

// ── Page 2 ────────────────────────────────────────────────────────────────────

const PAGE2_SECTIONS = [
  {
    num: '1',
    title: '¿Hay un error en su estado de cuenta?',
    body: `Si usted piensa que hay un error en su estado de cuenta, escríbanos dentro de los 60 días posteriores a la fecha de emisión. Incluya su nombre, número de cuenta, descripción del error y la razón por la que lo considera incorrecto.\n\nConnection Worldwide Group\nAtención: Servicio al Cliente\n23501 SW 115th Ave #386, Miami, FL 33170\nEmail: servicioalcliente@connectionww.com`,
  },
  {
    num: '2',
    title: 'Cómo Hacer Pagos',
    body: `• En línea: https://payments.connectionww.com\n• Por teléfono: (786) 291-3042\n• Por correo: Envíe su pago a Connection Worldwide Group, 23501 SW 115th Ave #386, Miami, FL 33170\n• Transferencia bancaria: Contáctenos para obtener instrucciones.`,
  },
  {
    num: '3',
    title: 'Preguntas sobre el Producto / Garantía',
    body: `Para preguntas sobre el uso, garantía del producto o servicio, comuníquese con nuestro departamento de Soporte de Producto.\n\nTeléfono: (786) 291-3042\nEmail: soporte@connectionww.com`,
  },
  {
    num: '4',
    title: 'Aviso Importante',
    body: `Si su cuenta presenta pagos atrasados, podríamos reportar información negativa a las Agencias Nacionales de Reporte de Crédito y/o referir su cuenta a un servicio de cobranza para su recuperación.\n\nQueremos evitarlo. Comuníquese con nosotros hoy mismo.\n\nServicio al Cliente: (786) 291-3042`,
  },
  {
    num: '5',
    title: 'Cambio de Dirección o Información',
    body: `Si su dirección, número de teléfono o correo electrónico cambian, por favor notifíquenos para mantener su información actualizada.\n\nservicioalcliente@connectionww.com\n(786) 291-3042`,
  },
  {
    num: '6',
    title: 'Su Privacidad es Importante',
    body: `Protegemos su información personal. Para conocer nuestras prácticas de privacidad, visite:\nhttps://www.connectionww.com/privacy-policy`,
  },
]

function Page2({ data }: { data: StatementPdfData }) {
  const showIllustrativeDisclaimer = data.documentStatus === 'draft'

  return (
    <Page size="LETTER" style={s.page}>
      {/* Header */}
      <View style={s.p2Header}>
        <View style={s.p2HeaderLeft}>
          <Text style={s.companyName}>{CWG.name}</Text>
          <Text style={s.companyTagline}>{CWG.tagline}</Text>
        </View>
        <View style={s.p2HeaderCenter}>
          <Text style={s.pageNum}>PÁGINA 2 DE 2</Text>
          <Text style={s.p2Title}>Información Importante{'\n'}sobre su Cuenta</Text>
        </View>
        <View style={s.p2HeaderRight}>
          <Text style={s.headerMetaLabel}>Número de cuenta / caso</Text>
          <Text style={s.headerMetaValue}>{data.accountNumber}</Text>
        </View>
      </View>

      {/* 6-card grid */}
      <View style={s.p2Grid}>
        {PAGE2_SECTIONS.map(sec => (
          <View key={sec.num} style={s.p2Card}>
            <Text style={s.p2CardNum}>{sec.num}.</Text>
            <Text style={s.p2CardTitle}>{sec.title}</Text>
            <Text style={s.p2CardBody}>{sec.body}</Text>
          </View>
        ))}
      </View>

      {/* Footer */}
      <View style={s.p2Footer}>
        {showIllustrativeDisclaimer && (
          <Text style={s.p2FooterText}>
            Esta imagen es solo un ejemplo visual del formato deseado. Los datos mostrados son ilustrativos.
          </Text>
        )}
        <Text style={[s.p2FooterText, { marginTop: 2 }]}>{CWG.copyright}</Text>
      </View>
    </Page>
  )
}

// ── Main document ─────────────────────────────────────────────────────────────

export function StatementPdfTemplate({ data }: { data: StatementPdfData }) {
  return (
    <Document
      title={`Estado de Cuenta – ${data.clientName} – ${data.accountNumber}`}
      author={CWG.name}
      subject="Estado de Cuenta"
    >
      {/* PAGE 1 */}
      <Page size="LETTER" style={s.page}>
        <PageHeader data={data} pageNum="PÁGINA 1 DE 2" />

        {/* 3-col info zone */}
        <View style={s.infoZone}>
          <ClientInfoCol data={data} />
          <AccountSummaryCol data={data} />
          <PaymentInfoCol data={data} />
        </View>

        {/* Transactions */}
        <TransactionsTable lines={data.lines} />

        {/* Message + options + coupon */}
        <ClientMessageZone data={data} />

        {/* Footer */}
        <FooterBar />
      </Page>

      {/* PAGE 2 */}
      <Page2 data={data} />
    </Document>
  )
}
