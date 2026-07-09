import { jsx as _jsx, jsxs as _jsxs } from 'https://esm.sh/react@18.3.1/jsx-runtime'
import { Document, Page, View, Text, StyleSheet } from 'https://esm.sh/@react-pdf/renderer@4.5.1?deps=react@18.3.1'
import { CWG, COLORS, FONTS, LINE_TYPE_LABEL } from './pdfConstants.js'

function label(es, en) {
  return `${es} / ${en}`
}

function splitBilingualLabel(value) {
  const parts = value.split(' / ')
  if (parts.length >= 2) {
    return {
      primary: parts[0].trim(),
      secondary: parts.slice(1).join(' / ').trim(),
    }
  }

  return {
    primary: value,
    secondary: '',
  }
}

function keepWordTogether(word) {
  return [word]
}

function fmtMoney(n) {
  if (n == null) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(Number(n)))
}

function fmtReduction(n) {
  const value = Number(n ?? 0)
  return value > 0 ? `-${fmtMoney(value)}` : '$0.00'
}

function fmtDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`
}

function fmtPercent(n, digits = 2) {
  if (n == null) return '—'
  return `${(Number(n) * 100).toFixed(digits)}%`
}

function movementColor(line) {
  if (line.type === 'pago' || line.type === 'credito' || line.type === 'ajuste') return COLORS.green
  if (line.type === 'cargo_interes' || line.type === 'cargo_fee') return COLORS.red
  return COLORS.text
}

function movementAmount(line) {
  if (line.type === 'pago' || line.type === 'credito' || line.type === 'ajuste') {
    return fmtReduction(line.amount)
  }
  if (line.type === 'cargo_interes' || line.type === 'cargo_fee') {
    return `+${fmtMoney(line.amount)}`
  }
  return fmtMoney(line.amount)
}

function paymentMethods(methodsText) {
  if (!methodsText || !methodsText.trim()) {
    return [
      'Telefono / Phone: 786-291-3042',
      'Email: info@connectionworldwidegroup.com',
      'Horario / Hours: Lunes a Sabado, 9:00 AM - 8:00 PM',
    ]
  }

  return methodsText
    .split(/\r?\n+/)
    .map(line => line.trim())
    .filter(Boolean)
}

function accountStatusBadge(status) {
  const value = (status || '').toLowerCase()
  if (value.includes('acuerdo') || value.includes('pagando')) {
    return { bg: COLORS.greenLight, color: COLORS.green, text: status.toUpperCase() }
  }
  if (value.includes('moroso') || value.includes('vencido') || value.includes('abierto')) {
    return { bg: COLORS.redLight, color: COLORS.red, text: status.toUpperCase() }
  }
  return { bg: COLORS.blueLight, color: COLORS.blue, text: (status || 'ACTIVA').toUpperCase() }
}

function buildClientNotice(data) {
  if (data.paymentMessage) return data.paymentMessage
  if (data.agreedMonthlyPayment != null) {
    return `Tu pago minimo actual es ${fmtMoney(data.agreedMonthlyPayment)} con vencimiento ${fmtDate(data.dueDate || data.nextPaymentDate)}. / Your current minimum payment is ${fmtMoney(data.agreedMonthlyPayment)} due on ${fmtDate(data.dueDate || data.nextPaymentDate)}.`
  }
  return `Comunicate con nuestro equipo si necesitas ayuda con tu cuenta. / Contact our team if you need help with your account.`
}

const HEADER_SUBTITLE = splitBilingualLabel('Resumen de tu cuenta / Summary of your account')

const s = StyleSheet.create({
  page: { fontFamily: FONTS.regular, fontSize: 8, color: COLORS.text, paddingBottom: 18 },
  header: { backgroundColor: COLORS.navy, padding: '22 18 20 18' },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { flex: 1.05 },
  brandName: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.white, letterSpacing: 0.4 },
  brandTag: { fontSize: 6.8, color: '#bfdbfe', marginTop: 2 },
  titleBlock: { flex: 1.55, alignItems: 'center', paddingHorizontal: 10 },
  title: { fontSize: 16.4, fontFamily: FONTS.bold, color: COLORS.white, textAlign: 'center', lineHeight: 1.12 },
  subtitleWrap: { marginTop: 4, alignItems: 'center' },
  subtitle: { fontSize: 7.1, color: '#dbeafe', textAlign: 'center', lineHeight: 1.22 },
  subtitleSecondLine: { marginTop: 1.5 },
  meta: { flex: 0.92, alignItems: 'flex-end', paddingLeft: 6 },
  metaLabel: { fontSize: 6, color: '#93c5fd', marginBottom: 1 },
  metaValue: { fontSize: 7.4, fontFamily: FONTS.bold, color: COLORS.white, marginBottom: 5 },
  refBar: { marginTop: 14, padding: '8 12', backgroundColor: '#16356a', borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between' },
  refText: { fontSize: 7.5, color: COLORS.white, fontFamily: FONTS.bold },
  section: { margin: '10 18 0 18' },
  grid: { flexDirection: 'row', gap: 8 },
  col: { flex: 1, border: `1 solid ${COLORS.border}`, borderRadius: 10, padding: '10 10' },
  colHeader: { fontSize: 6.5, fontFamily: FONTS.bold, color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  clientName: { fontSize: 9.5, fontFamily: FONTS.bold, color: COLORS.text, marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, gap: 6 },
  rowLabel: { flex: 1, fontSize: 6.8, color: COLORS.textMuted },
  rowValue: { width: '34%', textAlign: 'right', fontSize: 6.9, color: COLORS.text, fontFamily: FONTS.bold },
  highlightBox: { backgroundColor: '#eff6ff', border: `1 solid #bfdbfe`, borderRadius: 10, padding: '10 10', marginBottom: 6 },
  highlightLabel: { fontSize: 6.5, color: COLORS.blue, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 },
  highlightValue: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.navy },
  balanceBox: { backgroundColor: COLORS.navy, borderRadius: 10, padding: '10 10', marginTop: 6 },
  balanceLabel: { fontSize: 6.5, color: '#bfdbfe', textTransform: 'uppercase', letterSpacing: 0.5 },
  balanceValue: { fontSize: 17, fontFamily: FONTS.bold, color: '#fbbf24', marginTop: 3 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  tableWrap: { margin: '10 18 0 18', border: `1 solid ${COLORS.border}`, borderRadius: 10, overflow: 'hidden' },
  tableTitle: { backgroundColor: COLORS.navy, padding: '6 10' },
  tableTitleText: { fontSize: 7.2, fontFamily: FONTS.bold, color: COLORS.white, textTransform: 'uppercase', letterSpacing: 0.5 },
  tableHead: { flexDirection: 'row', backgroundColor: '#e2e8f0', padding: '5 8' },
  tableHeadCell: { fontSize: 6.1, fontFamily: FONTS.bold, color: COLORS.navy, textTransform: 'uppercase' },
  tableRow: { flexDirection: 'row', padding: '6 8', borderTop: `0.5 solid ${COLORS.border}` },
  tableRowAlt: { flexDirection: 'row', padding: '6 8', borderTop: `0.5 solid ${COLORS.border}`, backgroundColor: '#f8fafc' },
  tableCell: { fontSize: 6.8, color: COLORS.text },
  noticeWrap: { margin: '10 18 0 18', flexDirection: 'row', gap: 8 },
  noticeBox: { flex: 1.2, border: `1 solid ${COLORS.border}`, borderRadius: 10, padding: '10 10' },
  methodsBox: { flex: 1, border: `1 solid ${COLORS.border}`, borderRadius: 10, padding: '10 10' },
  amountBox: { flex: 0.82, border: `1.5 dashed ${COLORS.blueMid}`, borderRadius: 10, padding: '10 10' },
  boxTitle: { fontSize: 6.8, fontFamily: FONTS.bold, color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 },
  bodyText: { fontSize: 6.7, color: COLORS.text, lineHeight: 1.6 },
  amountLabel: { fontSize: 5.7, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  amountValue: { fontSize: 14, color: COLORS.red, fontFamily: FONTS.bold, marginBottom: 6 },
  footer: { margin: '10 18 0 18', paddingTop: 8, borderTop: `1 solid ${COLORS.border}` },
  footerText: { fontSize: 6.2, color: COLORS.textMuted, lineHeight: 1.5, textAlign: 'center' },
  page2Header: { backgroundColor: COLORS.navy, padding: '16 18 14 18' },
  page2Title: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.white, textAlign: 'center' },
  page2Subtitle: { fontSize: 7, color: '#bfdbfe', textAlign: 'center', marginTop: 3 },
  page2Grid: { margin: '10 18 0 18', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  page2Card: { width: '48%', border: `1 solid ${COLORS.border}`, borderRadius: 10, padding: '10 10' },
  page2CardTitle: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.navy, marginBottom: 4 },
  page2CardBody: { fontSize: 6.6, color: COLORS.text, lineHeight: 1.6 },
})

function Header({ data, pageLabel }) {
  return _jsxs(View, { style: s.header, children: [
    _jsxs(View, { style: s.headerTop, children: [
      _jsxs(View, { style: s.brand, children: [
        _jsx(Text, { style: s.brandName, children: CWG.name }),
        _jsx(Text, { style: s.brandTag, children: 'Distribuidor autorizado de Royal Prestige' }),
      ] }),
      _jsxs(View, { style: s.titleBlock, children: [
        _jsx(Text, { hyphenationCallback: keepWordTogether, style: s.title, children: 'Estado de cuenta / Statement' }),
        _jsxs(View, { style: s.subtitleWrap, children: [
          _jsx(Text, { hyphenationCallback: keepWordTogether, style: s.subtitle, children: HEADER_SUBTITLE.primary }),
          HEADER_SUBTITLE.secondary
            ? _jsx(Text, { hyphenationCallback: keepWordTogether, style: [s.subtitle, s.subtitleSecondLine], children: HEADER_SUBTITLE.secondary })
            : null,
        ] }),
      ] }),
      _jsxs(View, { style: s.meta, children: [
        _jsx(Text, { style: s.metaLabel, children: pageLabel }),
        _jsx(Text, { style: s.metaLabel, children: label('Fecha de corte', 'Statement date') }),
        _jsx(Text, { style: s.metaValue, children: fmtDate(data.statementDate || data.emissionDate) }),
        _jsx(Text, { style: s.metaLabel, children: label('Periodo', 'Period') }),
        _jsxs(Text, { style: s.metaValue, children: [fmtDate(data.periodStart), ' - ', fmtDate(data.periodEnd)] }),
      ] }),
    ] }),
    _jsxs(View, { style: s.refBar, children: [
      _jsxs(Text, { style: s.refText, children: [label('Referencia', 'Reference'), ': ', data.statementReference] }),
      _jsxs(Text, { style: s.refText, children: [label('Número de cuenta', 'Account number'), ': ', data.accountNumber] }),
    ] }),
  ] })
}

function ClientCard({ data }) {
  return _jsxs(View, { style: s.col, children: [
    _jsx(Text, { style: s.colHeader, children: label('Datos del cliente', 'Customer details') }),
    _jsx(Text, { style: s.clientName, children: data.clientName }),
    data.address && _jsx(Text, { style: s.bodyText, children: data.address }),
    (data.city || data.state || data.zip) && _jsx(Text, { style: s.bodyText, children: [data.city, data.state, data.zip].filter(Boolean).join(', ') }),
    data.phone && _jsxs(Text, { style: s.bodyText, children: [label('Telefono', 'Phone'), ': ', data.phone] }),
    data.email && _jsxs(Text, { style: s.bodyText, children: [label('Email', 'Email'), ': ', data.email] }),
  ] })
}

function SummaryCard({ data }) {
  return _jsxs(View, { style: s.col, children: [
    _jsx(Text, { style: s.colHeader, children: label('Resumen de cuenta', 'Account summary') }),
    _jsxs(View, { style: s.row, children: [
      _jsx(Text, { style: s.rowLabel, children: label('Balance anterior', 'Previous balance') }),
      _jsx(Text, { style: s.rowValue, children: fmtMoney(data.previousBalance) }),
    ] }),
    _jsxs(View, { style: s.row, children: [
      _jsx(Text, { style: s.rowLabel, children: label('Cargos del periodo', 'Charges this period') }),
      _jsx(Text, { style: s.rowValue, children: fmtMoney(data.originalAmount) }),
    ] }),
    _jsxs(View, { style: s.row, children: [
      _jsx(Text, { style: s.rowLabel, children: label('Pagos recibidos', 'Payments received') }),
      _jsx(Text, { style: [s.rowValue, { color: COLORS.green }], children: fmtReduction(data.paymentsPeriod) }),
    ] }),
    _jsxs(View, { style: s.row, children: [
      _jsx(Text, { style: s.rowLabel, children: label('Otros creditos', 'Other credits') }),
      _jsx(Text, { style: [s.rowValue, { color: COLORS.green }], children: fmtReduction(data.creditsPeriod) }),
    ] }),
    _jsxs(View, { style: s.row, children: [
      _jsx(Text, { style: s.rowLabel, children: label('Cargo por interes', 'Interest charge') }),
      _jsx(Text, { style: [s.rowValue, { color: COLORS.red }], children: fmtMoney(data.interestCharges) }),
    ] }),
    _jsx(View, { style: s.balanceBox, children: _jsxs(View, { children: [
      _jsx(Text, { style: s.balanceLabel, children: label('Nuevo balance', 'New balance') }),
      _jsx(Text, { style: s.balanceValue, children: fmtMoney(data.pendingBalance) }),
    ] }) }),
  ] })
}

function PaymentCard({ data }) {
  const badge = accountStatusBadge(data.accountStatus)
  return _jsxs(View, { style: s.col, children: [
    _jsx(Text, { style: s.colHeader, children: label('Informacion de pago', 'Payment information') }),
    _jsxs(View, { style: s.highlightBox, children: [
      _jsx(Text, { style: s.highlightLabel, children: label('Pago minimo', 'Minimum payment') }),
      _jsx(Text, { style: s.highlightValue, children: fmtMoney(data.agreedMonthlyPayment) }),
    ] }),
    _jsxs(View, { style: s.highlightBox, children: [
      _jsx(Text, { style: s.highlightLabel, children: label('Fecha de vencimiento', 'Due date') }),
      _jsx(Text, { style: s.highlightValue, children: fmtDate(data.dueDate || data.nextPaymentDate) }),
    ] }),
    _jsxs(View, { style: s.row, children: [
      _jsx(Text, { style: s.rowLabel, children: label('Tasa de interés anual', 'Annual interest rate') }),
      _jsx(Text, { style: s.rowValue, children: fmtPercent(data.apr) }),
    ] }),
    _jsxs(View, { style: s.row, children: [
      _jsx(Text, { style: s.rowLabel, children: label('Interés acumulado este año', 'Interest accrued this year') }),
      _jsx(Text, { style: s.rowValue, children: fmtMoney(data.ytdInterest) }),
    ] }),
    _jsxs(View, { style: s.row, children: [
      _jsx(Text, { style: s.rowLabel, children: label('Cargos acumulados este año', 'Fees accrued this year') }),
      _jsx(Text, { style: s.rowValue, children: fmtMoney(data.ytdFees) }),
    ] }),
    _jsxs(View, { style: [s.row, { marginTop: 6, alignItems: 'center' }], children: [
      _jsx(Text, { style: s.rowLabel, children: label('Estado de la cuenta', 'Account status') }),
      _jsx(View, { style: [s.badge, { backgroundColor: badge.bg }], children: _jsx(Text, { style: { color: badge.color, fontSize: 6.6, fontFamily: FONTS.bold }, children: badge.text }) }),
    ] }),
  ] })
}

function TransactionsTable({ data }) {
  const lines = data.lines.filter(line => line.type !== 'saldo_cierre' && line.type !== 'proximo_pago')
  return _jsxs(View, { style: s.tableWrap, children: [
    _jsx(View, { style: s.tableTitle, children: _jsx(Text, { style: s.tableTitleText, children: label('Detalle de transacciones', 'Transaction detail') }) }),
    _jsxs(View, { style: s.tableHead, children: [
      _jsx(Text, { style: [s.tableHeadCell, { width: '15%' }], children: label('Fecha', 'Date') }),
      _jsx(Text, { style: [s.tableHeadCell, { flex: 1 }], children: label('Descripcion', 'Description') }),
      _jsx(Text, { style: [s.tableHeadCell, { width: '18%' }], children: label('Tipo', 'Type') }),
      _jsx(Text, { style: [s.tableHeadCell, { width: '15%', textAlign: 'right' }], children: label('Monto', 'Amount') }),
      _jsx(Text, { style: [s.tableHeadCell, { width: '18%', textAlign: 'right' }], children: label('Balance', 'Balance') }),
    ] }),
    lines.length === 0
      ? _jsx(Text, { style: { padding: 12, textAlign: 'center', fontSize: 7, color: COLORS.textMuted }, children: 'Sin transacciones / No transactions' })
      : lines.map((line, index) => _jsxs(View, { style: index % 2 ? s.tableRowAlt : s.tableRow, children: [
          _jsx(Text, { style: [s.tableCell, { width: '15%' }], children: fmtDate(line.date) }),
          _jsx(Text, { style: [s.tableCell, { flex: 1 }], children: line.description }),
          _jsx(Text, { style: [s.tableCell, { width: '18%', color: movementColor(line) }], children: LINE_TYPE_LABEL[line.type] ?? line.type }),
          _jsx(Text, { style: [s.tableCell, { width: '15%', textAlign: 'right', color: movementColor(line), fontFamily: FONTS.bold }], children: movementAmount(line) }),
          _jsx(Text, { style: [s.tableCell, { width: '18%', textAlign: 'right' }], children: fmtMoney(line.runningBalance) }),
        ] }, `${line.date ?? 'line'}-${index}`)),
  ] })
}

function NoticeSection({ data }) {
  const methods = paymentMethods(data.paymentMethodsText)
  return _jsxs(View, { style: s.noticeWrap, children: [
    _jsxs(View, { style: s.noticeBox, children: [
      _jsx(Text, { style: s.boxTitle, children: label('Mensaje importante', 'Important message') }),
      _jsx(Text, { style: s.bodyText, children: buildClientNotice(data) }),
    ] }),
    _jsxs(View, { style: s.methodsBox, children: [
      _jsx(Text, { style: s.boxTitle, children: label('Como pagar', 'How to pay') }),
      methods.map((line, index) => _jsx(Text, { style: s.bodyText, children: line }, `method-${index}`)),
    ] }),
    _jsxs(View, { style: s.amountBox, children: [
      _jsx(Text, { style: s.boxTitle, children: label('Referencia rapida', 'Quick reference') }),
      _jsx(Text, { style: s.amountLabel, children: label('Pago minimo', 'Minimum payment') }),
      _jsx(Text, { style: s.amountValue, children: fmtMoney(data.agreedMonthlyPayment) }),
      _jsx(Text, { style: s.amountLabel, children: label('Vence', 'Due') }),
      _jsx(Text, { style: s.bodyText, children: fmtDate(data.dueDate || data.nextPaymentDate) }),
      _jsx(Text, { style: s.amountLabel, children: label('Referencia', 'Reference') }),
      _jsx(Text, { style: s.bodyText, children: data.statementReference }),
    ] }),
  ] })
}

function Footer() {
  return _jsx(View, { style: s.footer, children: _jsxs(Text, { style: s.footerText, children: [
    'Este documento es un resumen informativo y no reemplaza tu contrato original. / ',
    'This document is an informational summary and does not replace your original agreement.',
    '\n',
    'Connection Worldwide Group | Tel: 786-291-3042 | Email: info@connectionworldwidegroup.com',
  ] }) })
}

const PAGE2_CARDS = [
  {
    title: label('Preguntas o errores', 'Questions or errors'),
    body: 'Si ves un error en tu estado de cuenta, contactanos dentro de 60 dias con tu referencia y una explicacion breve. / If you see an error on your statement, contact us within 60 days with your reference number and a short explanation.',
  },
  {
    title: label('Pagos', 'Payments'),
    body: 'Los pagos deben realizarse antes de la fecha de vencimiento para evitar cargos adicionales. / Payments should be made before the due date to avoid additional charges.',
  },
  {
    title: label('Atencion al cliente', 'Customer service'),
    body: 'Telefono: 786-291-3042\nEmail: info@connectionworldwidegroup.com\nHorario / Hours: Lunes a Sabado, 9:00 AM - 8:00 PM',
  },
  {
    title: label('Privacidad y acuerdo', 'Privacy and agreement'),
    body: 'Protegemos tu informacion y este resumen no modifica tu acuerdo original. / We protect your information and this summary does not modify your original agreement.',
  },
]

function Page2({ data }) {
  return _jsxs(Page, { size: 'LETTER', style: s.page, children: [
    _jsxs(View, { style: s.page2Header, children: [
      _jsx(Text, { style: s.page2Title, children: 'Informacion importante / Important information' }),
      _jsxs(Text, { style: s.page2Subtitle, children: [label('Referencia', 'Reference'), ': ', data.statementReference] }),
    ] }),
    _jsx(View, { style: s.page2Grid, children: PAGE2_CARDS.map((card, index) => _jsxs(View, { style: s.page2Card, children: [
      _jsx(Text, { style: s.page2CardTitle, children: card.title }),
      _jsx(Text, { style: s.page2CardBody, children: card.body }),
    ] }, `card-${index}`)) }),
    _jsx(Footer, {}),
  ] })
}

export function StatementPdfTemplate({ data }) {
  return _jsxs(Document, { title: `Statement - ${data.clientName} - ${data.statementReference}`, author: CWG.name, subject: 'Monthly statement', children: [
    _jsxs(Page, { size: 'LETTER', style: s.page, children: [
      _jsx(Header, { data, pageLabel: 'PAGE 1 / 2' }),
      _jsxs(View, { style: [s.section, s.grid], children: [
        _jsx(ClientCard, { data }),
        _jsx(SummaryCard, { data }),
        _jsx(PaymentCard, { data }),
      ] }),
      _jsx(TransactionsTable, { data }),
      _jsx(NoticeSection, { data }),
      _jsx(Footer, {}),
    ] }),
    _jsx(Page2, { data }),
  ] })
}
