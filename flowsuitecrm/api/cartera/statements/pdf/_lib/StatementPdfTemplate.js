import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Document, Page, View, Text, StyleSheet, } from '@react-pdf/renderer';
import { CWG, COLORS, FONTS, ACCOUNT_TYPE_LABEL, LINE_TYPE_LABEL } from './pdfConstants.js';
function fmtMoney(n) {
    if (n == null)
        return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function fmtDate(iso) {
    if (!iso)
        return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}
function fmtPercentDecimal(n) {
    if (n == null)
        return 'APR pendiente';
    return `${(n * 100).toFixed(2)}%`;
}
function lineIsDebit(line) {
    return line.type === 'saldo_apertura' || line.type === 'cargo_interes' || line.type === 'cargo_fee';
}
function lineColor(line) {
    if (line.type === 'pago' || line.type === 'credito' || line.type === 'ajuste')
        return COLORS.green;
    if (line.type === 'cargo_interes' || line.type === 'cargo_fee')
        return COLORS.red;
    return COLORS.text;
}
function accountStatusBadge(status) {
    const s = status.toLowerCase();
    if (s.includes('acuerdo') || s.includes('pagando') || s.includes('negociación')) {
        return { label: status.toUpperCase(), bg: COLORS.greenLight, color: COLORS.green };
    }
    if (s.includes('abierto') || s.includes('moroso') || s.includes('vencido')) {
        return { label: status.toUpperCase(), bg: COLORS.redLight, color: COLORS.red };
    }
    return { label: status.toUpperCase(), bg: COLORS.blueLight, color: COLORS.blue };
}
function buildClientMessage(data) {
    const { pendingBalance, agreedMonthlyPayment, nextPaymentDate, accountStatus } = data;
    const s = accountStatus.toLowerCase();
    const hasAgreement = s.includes('acuerdo') || s.includes('negociación');
    const isDelinquent = s.includes('moroso') || s.includes('vencido') || s.includes('abierto');
    if (isDelinquent) {
        return {
            icon: '!',
            title: 'Su cuenta tiene saldo vencido',
            body: `Tiene un saldo pendiente de ${fmtMoney(pendingBalance)}. Por favor, contáctenos hoy mismo para ponerse al día o establecer un acuerdo de pago. Llámenos al ${CWG.phone}.`,
        };
    }
    if (hasAgreement && agreedMonthlyPayment) {
        const dateStr = nextPaymentDate ? fmtDate(nextPaymentDate) : 'por confirmar';
        return {
            icon: '✓',
            title: '¡Gracias por su pago!',
            body: `Su cuenta se encuentra al día con el acuerdo establecido. Su próximo pago de ${fmtMoney(agreedMonthlyPayment)} está programado para el ${dateStr}.`,
        };
    }
    return {
        icon: '✓',
        title: '¡Gracias por confiar en nosotros!',
        body: `Tiene un saldo pendiente de ${fmtMoney(pendingBalance)}. Si tiene preguntas sobre su cuenta, contáctenos al ${CWG.phone}.`,
    };
}
const s = StyleSheet.create({
    page: { fontFamily: FONTS.regular, fontSize: 8, color: COLORS.text, paddingBottom: 20 },
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
    sectionHeader: { backgroundColor: COLORS.navy, padding: '4 8', flexDirection: 'row', alignItems: 'center' },
    sectionHeaderText: { fontSize: 7.5, fontFamily: FONTS.bold, color: COLORS.white, letterSpacing: 0.6, textTransform: 'uppercase' },
    infoZone: { flexDirection: 'row', borderBottom: `1 solid ${COLORS.border}` },
    infoCol: { flex: 1, padding: '8 10', borderRight: `1 solid ${COLORS.border}` },
    infoColLast: { flex: 1, padding: '8 10' },
    infoColHeader: { fontSize: 6.5, fontFamily: FONTS.bold, color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, borderBottom: `1 solid ${COLORS.navy}`, paddingBottom: 3 },
    clientName: { fontSize: 9, fontFamily: FONTS.bold, color: COLORS.navy, marginBottom: 4 },
    clientRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2.5 },
    clientIcon: { fontSize: 7, color: COLORS.gray, width: 10 },
    clientText: { fontSize: 7, color: COLORS.text, flex: 1 },
    summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3, paddingBottom: 3 },
    summaryLabel: { fontSize: 7, color: COLORS.text, flex: 1 },
    summaryValue: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.text, textAlign: 'right' },
    summaryValueGreen: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.green, textAlign: 'right' },
    summaryDivider: { borderBottom: `0.5 solid ${COLORS.border}`, marginBottom: 3 },
    summaryTotal: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2, padding: '4 6', backgroundColor: COLORS.navy, borderRadius: 3 },
    summaryTotalLabel: { fontSize: 7.5, fontFamily: FONTS.bold, color: COLORS.white },
    summaryTotalValue: { fontSize: 9, fontFamily: FONTS.bold, color: '#fbbf24' },
    paymentCard: { marginBottom: 6, padding: '5 8', backgroundColor: COLORS.grayLight, borderRadius: 3, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    paymentCardLabel: { fontSize: 6, color: COLORS.gray, textTransform: 'uppercase', letterSpacing: 0.3 },
    paymentCardValue: { fontSize: 9, fontFamily: FONTS.bold, color: COLORS.navy },
    paymentCardValueRed: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.red },
    paymentCardValueGreen: { fontSize: 7.5, fontFamily: FONTS.bold },
    statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
    tableZone: { margin: '0 14', marginBottom: 8 },
    tableHeader: { flexDirection: 'row', backgroundColor: COLORS.navyMid, padding: '4 6' },
    tableHeaderCell: { fontSize: 6.5, fontFamily: FONTS.bold, color: COLORS.white, textTransform: 'uppercase' },
    tableRow: { flexDirection: 'row', padding: '4 6', borderBottom: `0.5 solid ${COLORS.border}` },
    tableRowAlt: { flexDirection: 'row', padding: '4 6', borderBottom: `0.5 solid ${COLORS.border}`, backgroundColor: COLORS.grayLight },
    tableCell: { fontSize: 7, color: COLORS.text },
    tableCellGreen: { fontSize: 7, color: COLORS.green, fontFamily: FONTS.bold },
    tableCellRed: { fontSize: 7, color: COLORS.red },
    tableEmpty: { padding: '10 6', fontSize: 7.5, color: COLORS.gray, textAlign: 'center' },
    msgZone: { margin: '0 14', marginBottom: 8, flexDirection: 'row', gap: 8 },
    msgBox: { flex: 1.4, padding: '8 10', border: `1 solid ${COLORS.border}`, borderRadius: 4 },
    msgBoxHeader: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
    msgIconRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
    msgIcon: { fontSize: 10, marginRight: 5, color: COLORS.green },
    msgTitle: { fontSize: 7.5, fontFamily: FONTS.bold, color: COLORS.navy, marginBottom: 2 },
    msgBody: { fontSize: 6.5, color: COLORS.text, lineHeight: 1.5 },
    optionsBox: { flex: 1, padding: '8 10', border: `1 solid ${COLORS.border}`, borderRadius: 4 },
    optionsHeader: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
    optionRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 5 },
    optionIcon: { fontSize: 8, marginRight: 5, color: COLORS.blue },
    optionLabel: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.navy, marginBottom: 1 },
    optionValue: { fontSize: 6.5, color: COLORS.text },
    couponBox: { flex: 0.9, padding: '8 10', border: `1.5 dashed ${COLORS.navyMid}`, borderRadius: 4 },
    couponHeader: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.navy, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
    couponLabel: { fontSize: 5.5, color: COLORS.gray, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 1 },
    couponAmount: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.red, marginBottom: 5 },
    couponValue: { fontSize: 7.5, fontFamily: FONTS.bold, color: COLORS.navy, marginBottom: 4 },
    footerBar: { backgroundColor: COLORS.grayLight, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', padding: '6 14', borderTop: `1 solid ${COLORS.border}` },
    footerItem: { flexDirection: 'row', alignItems: 'center' },
    footerIcon: { fontSize: 8, marginRight: 4, color: COLORS.blue },
    footerText: { fontSize: 6.5, color: COLORS.text },
    footerTextBold: { fontSize: 7, fontFamily: FONTS.bold, color: COLORS.navy },
    footerCopyright: { backgroundColor: COLORS.navy, padding: '4 14', flexDirection: 'row', justifyContent: 'space-between' },
    footerCopyrightText: { fontSize: 5.5, color: '#94a3b8' },
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
});
function PageHeader({ data, pageNum }) {
    const isCv = data.accountType === 'cargo_vuelta';
    return (_jsxs(View, { style: s.headerBar, children: [_jsxs(View, { style: s.headerLeft, children: [_jsx(Text, { style: s.companyName, children: CWG.name }), _jsx(Text, { style: s.companyTagline, children: CWG.tagline })] }), _jsxs(View, { style: s.headerCenter, children: [_jsx(Text, { style: s.pageNum, children: pageNum }), _jsx(Text, { style: s.statementTitle, children: "Estado de Cuenta" }), _jsx(Text, { style: s.statementSubtitle, children: "Gracias por confiar en Connection Worldwide Group." }), _jsxs(Text, { style: s.accountTypeTag, children: ["Tipo de cuenta: ", ACCOUNT_TYPE_LABEL[data.accountType] ?? data.accountType] })] }), _jsxs(View, { style: s.headerRight, children: [_jsxs(View, { style: s.headerMetaRow, children: [_jsx(Text, { style: s.headerMetaLabel, children: "FECHA DE EMISIÓN" }), _jsx(Text, { style: s.headerMetaValue, children: fmtDate(data.emissionDate) })] }), _jsxs(View, { style: s.headerMetaRow, children: [_jsx(Text, { style: s.headerMetaLabel, children: "PERÍODO DEL ESTADO" }), _jsxs(Text, { style: s.headerMetaValue, children: [fmtDate(data.periodStart), " – ", fmtDate(data.periodEnd)] })] }), isCv && (_jsxs(_Fragment, { children: [_jsxs(View, { style: s.headerMetaRow, children: [_jsx(Text, { style: s.headerMetaLabel, children: "FECHA DE APROBACIÓN" }), _jsx(Text, { style: s.headerMetaValue, children: fmtDate(data.approvalDate) })] }), _jsxs(View, { style: s.headerMetaRow, children: [_jsx(Text, { style: s.headerMetaLabel, children: "STATEMENT DATE" }), _jsx(Text, { style: s.headerMetaValue, children: fmtDate(data.statementDate) })] }), _jsxs(View, { style: s.headerMetaRow, children: [_jsx(Text, { style: s.headerMetaLabel, children: "DUE DATE" }), _jsx(Text, { style: s.headerMetaValue, children: fmtDate(data.dueDate) })] })] })), _jsxs(View, { children: [_jsx(Text, { style: s.headerMetaLabel, children: "NÚMERO DE CUENTA / CASO" }), _jsx(Text, { style: s.headerMetaValue, children: data.accountNumber })] })] })] }));
}
function ClientInfoCol({ data }) {
    return (_jsxs(View, { style: s.infoCol, children: [_jsx(Text, { style: s.infoColHeader, children: "Datos del Cliente" }), _jsx(Text, { style: s.clientName, children: data.clientName }), data.address && (_jsxs(View, { style: s.clientRow, children: [_jsx(Text, { style: s.clientIcon, children: "@" }), _jsx(Text, { style: s.clientText, children: data.address })] })), (data.city || data.state) && (_jsxs(View, { style: s.clientRow, children: [_jsx(Text, { style: s.clientIcon, children: " " }), _jsx(Text, { style: s.clientText, children: [data.city, data.state, data.zip].filter(Boolean).join(', ') })] })), data.phone && (_jsxs(View, { style: s.clientRow, children: [_jsx(Text, { style: s.clientIcon, children: "T" }), _jsx(Text, { style: s.clientText, children: data.phone })] })), data.email && (_jsxs(View, { style: s.clientRow, children: [_jsx(Text, { style: s.clientIcon, children: "E" }), _jsx(Text, { style: s.clientText, children: data.email })] }))] }));
}
function AccountSummaryCol({ data }) {
    const isDfp = data.accountType === 'dfp';
    return (_jsxs(View, { style: s.infoCol, children: [_jsx(Text, { style: s.infoColHeader, children: "Resumen de Cuenta" }), isDfp ? (_jsxs(_Fragment, { children: [_jsxs(View, { style: s.summaryRow, children: [_jsx(Text, { style: s.summaryLabel, children: "Balance previo" }), _jsx(Text, { style: s.summaryValue, children: fmtMoney(data.previousBalance) })] }), data.interestCharges > 0 && (_jsxs(View, { style: s.summaryRow, children: [_jsxs(Text, { style: s.summaryLabel, children: ["Cargo de interés (", data.apr != null ? `${(data.apr * 100).toFixed(2)}% APR` : '', ")"] }), _jsx(Text, { style: s.summaryValue, children: fmtMoney(data.interestCharges) })] })), data.feesPeriod > 0 && (_jsxs(View, { style: s.summaryRow, children: [_jsx(Text, { style: s.summaryLabel, children: "Cargos / fees" }), _jsx(Text, { style: s.summaryValue, children: fmtMoney(data.feesPeriod) })] }))] })) : (_jsxs(_Fragment, { children: [_jsxs(View, { style: s.summaryRow, children: [_jsx(Text, { style: s.summaryLabel, children: "Monto original del cargo de vuelta" }), _jsx(Text, { style: s.summaryValue, children: fmtMoney(data.originalAmount) })] }), _jsxs(View, { style: s.summaryRow, children: [_jsx(Text, { style: s.summaryLabel, children: "Pagos acumulados (anteriores al período)" }), _jsxs(Text, { style: s.summaryValueGreen, children: ["-", fmtMoney(data.paymentsAccumulated - data.paymentsPeriod)] })] }), _jsxs(View, { style: s.summaryRow, children: [_jsx(Text, { style: s.summaryLabel, children: "APR acordado" }), _jsx(Text, { style: s.summaryValue, children: fmtPercentDecimal(data.interestApr) })] }), _jsxs(View, { style: s.summaryRow, children: [_jsx(Text, { style: s.summaryLabel, children: "Período de interés" }), _jsx(Text, { style: s.summaryValue, children: data.interestPeriodStart && data.interestPeriodEnd
                                    ? `${fmtDate(data.interestPeriodStart)} – ${fmtDate(data.interestPeriodEnd)}`
                                    : 'Pendiente' })] })] })), data.paymentsPeriod > 0 && (_jsxs(View, { style: s.summaryRow, children: [_jsx(Text, { style: s.summaryLabel, children: "Pagos recibidos en este período" }), _jsxs(Text, { style: s.summaryValueGreen, children: ["-", fmtMoney(data.paymentsPeriod)] })] })), data.creditsPeriod > 0 && (_jsxs(View, { style: s.summaryRow, children: [_jsx(Text, { style: s.summaryLabel, children: "Créditos / Ajustes por devolución de mercancía" }), _jsxs(Text, { style: s.summaryValueGreen, children: ["-", fmtMoney(data.creditsPeriod)] })] })), data.feesPeriod > 0 && !isDfp && (_jsxs(View, { style: s.summaryRow, children: [_jsx(Text, { style: s.summaryLabel, children: "Fee de plataforma (no reduce balance)" }), _jsx(Text, { style: s.summaryValue, children: fmtMoney(data.feesPeriod) })] })), !isDfp && (_jsxs(View, { style: s.summaryRow, children: [_jsx(Text, { style: s.summaryLabel, children: "Interés del período del statement" }), _jsx(Text, { style: s.summaryValue, children: fmtMoney(data.interestCharges) })] })), _jsx(View, { style: s.summaryDivider }), _jsxs(View, { style: s.summaryTotal, children: [_jsx(Text, { style: s.summaryTotalLabel, children: isDfp ? `Saldo Pendiente al ${fmtDate(data.emissionDate)}` : `Saldo al statement (${fmtDate(data.statementDate ?? data.emissionDate)})` }), _jsx(Text, { style: s.summaryTotalValue, children: fmtMoney(data.pendingBalance) })] }), !isDfp && (_jsxs(View, { style: [s.summaryTotal, { marginTop: 6, backgroundColor: COLORS.blueMid }], children: [_jsx(Text, { style: s.summaryTotalLabel, children: "Total estimado a pagar antes del due date" }), _jsx(Text, { style: s.summaryTotalValue, children: fmtMoney(data.projectedDueBalance) })] }))] }));
}
function PaymentInfoCol({ data }) {
    const isCv = data.accountType === 'cargo_vuelta';
    const badge = accountStatusBadge(data.accountStatus);
    return (_jsxs(View, { style: s.infoColLast, children: [_jsx(Text, { style: s.infoColHeader, children: "Información de Pagos" }), _jsx(View, { style: s.paymentCard, children: _jsxs(View, { children: [_jsx(Text, { style: s.paymentCardLabel, children: "Pago acordado mensual" }), _jsx(Text, { style: s.paymentCardValue, children: data.agreedMonthlyPayment != null ? fmtMoney(data.agreedMonthlyPayment) : '—' })] }) }), _jsx(View, { style: s.paymentCard, children: _jsxs(View, { children: [_jsx(Text, { style: s.paymentCardLabel, children: isCv ? 'Due date / fecha límite' : 'Fecha de próximo pago' }), _jsx(Text, { style: s.paymentCardValue, children: isCv
                                ? fmtDate(data.dueDate ?? data.nextPaymentDate)
                                : data.nextPaymentDate ? fmtDate(data.nextPaymentDate) : 'Por confirmar' })] }) }), _jsxs(View, { style: [s.paymentCard, { flexDirection: 'column', alignItems: 'flex-start' }], children: [_jsx(Text, { style: s.paymentCardLabel, children: isCv ? 'Saldo al statement' : 'Saldo pendiente' }), _jsx(Text, { style: s.paymentCardValueRed, children: fmtMoney(data.pendingBalance) })] }), isCv && (_jsxs(_Fragment, { children: [_jsxs(View, { style: [s.paymentCard, { flexDirection: 'column', alignItems: 'flex-start' }], children: [_jsx(Text, { style: s.paymentCardLabel, children: "Total estimado a pagar antes del due date" }), _jsx(Text, { style: s.paymentCardValue, children: fmtMoney(data.projectedDueBalance) })] }), _jsx(View, { style: s.paymentCard, children: _jsxs(View, { children: [_jsx(Text, { style: s.paymentCardLabel, children: "APR acordado" }), _jsx(Text, { style: s.paymentCardValue, children: fmtPercentDecimal(data.interestApr) })] }) })] })), _jsxs(View, { style: s.paymentCard, children: [_jsx(View, { style: { flex: 1 }, children: _jsx(Text, { style: s.paymentCardLabel, children: "Estado de la cuenta" }) }), _jsx(View, { style: [s.statusBadge, { backgroundColor: badge.bg }], children: _jsx(Text, { style: [s.paymentCardValueGreen, { color: badge.color }], children: badge.label }) })] }), data.accountType === 'dfp' && data.apr != null && (_jsx(View, { style: s.paymentCard, children: _jsxs(View, { children: [_jsx(Text, { style: s.paymentCardLabel, children: "Tasa Anual (APR/TAE)" }), _jsxs(Text, { style: s.paymentCardValue, children: [(data.apr * 100).toFixed(2), "%"] })] }) }))] }));
}
function TransactionsTable({ lines }) {
    const dataLines = lines.filter(l => l.type !== 'saldo_cierre' && l.type !== 'proximo_pago');
    return (_jsxs(View, { style: s.tableZone, children: [_jsx(View, { style: s.sectionHeader, children: _jsx(Text, { style: s.sectionHeaderText, children: "Detalle de Transacciones" }) }), _jsxs(View, { style: s.tableHeader, children: [_jsx(Text, { style: [s.tableHeaderCell, { width: '13%' }], children: "Fecha" }), _jsx(Text, { style: [s.tableHeaderCell, { flex: 1 }], children: "Descripción" }), _jsx(Text, { style: [s.tableHeaderCell, { width: '14%' }], children: "Tipo" }), _jsx(Text, { style: [s.tableHeaderCell, { width: '13%', textAlign: 'right' }], children: "Monto" }), _jsx(Text, { style: [s.tableHeaderCell, { width: '16%', textAlign: 'right' }], children: "Balance" })] }), dataLines.length === 0 ? (_jsx(Text, { style: s.tableEmpty, children: "Sin transacciones en este período." })) : (dataLines.map((line, i) => {
                const isAlt = i % 2 === 1;
                const isCredit = !lineIsDebit(line);
                const color = lineColor(line);
                return (_jsxs(View, { style: isAlt ? s.tableRowAlt : s.tableRow, children: [_jsx(Text, { style: [s.tableCell, { width: '13%' }], children: fmtDate(line.date) }), _jsx(Text, { style: [s.tableCell, { flex: 1 }], children: line.description }), _jsx(Text, { style: [s.tableCell, { width: '14%', color }], children: LINE_TYPE_LABEL[line.type] ?? line.type }), _jsxs(Text, { style: [s.tableCell, { width: '13%', textAlign: 'right', color, fontFamily: isCredit ? FONTS.bold : FONTS.regular }], children: [isCredit ? '-' : '', fmtMoney(line.amount)] }), _jsx(Text, { style: [s.tableCell, { width: '16%', textAlign: 'right' }], children: line.runningBalance != null ? fmtMoney(line.runningBalance) : '—' })] }, i));
            }))] }));
}
function ClientMessageZone({ data }) {
    const msg = buildClientMessage(data);
    const isPositive = msg.icon === '✓';
    const hasPaymentUrl = Boolean(CWG.paymentUrl);
    return (_jsxs(View, { style: s.msgZone, children: [_jsxs(View, { style: s.msgBox, children: [_jsx(Text, { style: s.msgBoxHeader, children: "Mensaje para Usted" }), _jsxs(View, { style: s.msgIconRow, children: [_jsx(Text, { style: [s.msgIcon, { color: isPositive ? COLORS.green : COLORS.red }], children: msg.icon }), _jsxs(View, { style: { flex: 1 }, children: [_jsx(Text, { style: s.msgTitle, children: msg.title }), _jsx(Text, { style: s.msgBody, children: msg.body })] })] })] }), _jsxs(View, { style: s.optionsBox, children: [_jsx(Text, { style: s.optionsHeader, children: "Opciones de Pago" }), hasPaymentUrl && (_jsxs(View, { style: s.optionRow, children: [_jsx(Text, { style: s.optionIcon, children: "$" }), _jsxs(View, { children: [_jsx(Text, { style: s.optionLabel, children: "Pague en Línea" }), _jsx(Text, { style: s.optionValue, children: CWG.paymentUrl })] })] })), _jsxs(View, { style: s.optionRow, children: [_jsx(Text, { style: s.optionIcon, children: "T" }), _jsxs(View, { children: [_jsx(Text, { style: s.optionLabel, children: "Pago por Teléfono" }), _jsx(Text, { style: s.optionValue, children: CWG.phone })] })] }), _jsxs(View, { style: s.optionRow, children: [_jsx(Text, { style: s.optionIcon, children: "@" }), _jsxs(View, { children: [_jsx(Text, { style: s.optionLabel, children: "Solicite Instrucciones de Pago" }), _jsx(Text, { style: s.optionValue, children: CWG.email })] })] }), _jsxs(View, { style: s.optionRow, children: [_jsx(Text, { style: s.optionIcon, children: "H" }), _jsxs(View, { children: [_jsx(Text, { style: s.optionLabel, children: "Horario de Atención" }), _jsx(Text, { style: s.optionValue, children: CWG.hours })] })] })] }), _jsxs(View, { style: s.couponBox, children: [_jsx(Text, { style: s.couponHeader, children: "Cupón de Pago" }), _jsx(Text, { style: s.couponLabel, children: data.accountType === 'cargo_vuelta' ? 'Total proyectado a pagar' : 'Cantidad a pagar' }), _jsx(Text, { style: s.couponAmount, children: data.accountType === 'cargo_vuelta'
                            ? fmtMoney(data.projectedDueBalance ?? data.pendingBalance)
                            : data.agreedMonthlyPayment != null ? fmtMoney(data.agreedMonthlyPayment) : fmtMoney(data.pendingBalance) }), _jsx(Text, { style: s.couponLabel, children: data.accountType === 'cargo_vuelta' ? 'Due date' : 'Fecha de vencimiento' }), _jsx(Text, { style: s.couponValue, children: data.accountType === 'cargo_vuelta'
                            ? fmtDate(data.dueDate ?? data.nextPaymentDate)
                            : data.nextPaymentDate ? fmtDate(data.nextPaymentDate) : 'Por confirmar' }), _jsx(Text, { style: s.couponLabel, children: "Número de cuenta / caso" }), _jsx(Text, { style: [s.couponValue, { fontSize: 7 }], children: data.accountNumber }), _jsx(Text, { style: s.couponLabel, children: "Teléfono de contacto" }), _jsx(Text, { style: s.couponValue, children: CWG.phone })] })] }));
}
function FooterBar() {
    return (_jsxs(_Fragment, { children: [_jsxs(View, { style: s.footerBar, children: [_jsxs(View, { style: s.footerItem, children: [_jsx(Text, { style: s.footerIcon, children: "?" }), _jsxs(View, { children: [_jsx(Text, { style: s.footerTextBold, children: "¿Preguntas? Servicio al Cliente:" }), _jsx(Text, { style: [s.footerTextBold, { color: COLORS.blue }], children: CWG.phone })] })] }), _jsxs(View, { style: s.footerItem, children: [_jsx(Text, { style: s.footerIcon, children: "@" }), _jsx(Text, { style: s.footerText, children: CWG.email })] }), _jsxs(View, { style: s.footerItem, children: [_jsx(Text, { style: s.footerIcon, children: "H" }), _jsx(Text, { style: s.footerText, children: CWG.hours })] })] }), _jsxs(View, { style: s.footerCopyright, children: [_jsx(Text, { style: s.footerCopyrightText, children: "Esta información es solo un estado de cuenta. No constituye aviso legal." }), _jsx(Text, { style: s.footerCopyrightText, children: CWG.copyright })] })] }));
}
const PAGE2_SECTIONS = [
    {
        num: '1',
        title: '¿Hay un error en su estado de cuenta?',
        body: `Si usted piensa que hay un error en su estado de cuenta, escríbanos dentro de los 60 días posteriores a la fecha de emisión. Incluya su nombre, número de cuenta, descripción del error y la razón por la que lo considera incorrecto.\n\n${CWG.name}\nAtención: Servicio al Cliente\n${CWG.address}\nEmail: ${CWG.email}`,
    },
    {
        num: '2',
        title: 'Cómo Hacer Pagos',
        body: `Para realizar un pago o solicitar instrucciones de pago, comuníquese con nuestro equipo de atención al cliente.\n\nTeléfono: ${CWG.phone}\nEmail: ${CWG.email}\nHorario: ${CWG.hours}`,
    },
    {
        num: '3',
        title: 'Preguntas sobre el Producto / Garantía',
        body: `Para preguntas sobre el uso, garantía del producto o servicio, comuníquese con nuestro departamento de Soporte de Producto.\n\nTeléfono: ${CWG.phone}\nEmail: ${CWG.supportEmail}`,
    },
    {
        num: '4',
        title: 'Aviso Importante',
        body: `Si su cuenta presenta pagos atrasados, podríamos reportar información negativa a las Agencias Nacionales de Reporte de Crédito y/o referir su cuenta a un servicio de cobranza para su recuperación.\n\nQueremos evitarlo. Comuníquese con nosotros hoy mismo.\n\nServicio al Cliente: ${CWG.phone}`,
    },
    {
        num: '5',
        title: 'Cambio de Dirección o Información',
        body: `Si su dirección, número de teléfono o correo electrónico cambian, por favor notifíquenos para mantener su información actualizada.\n\n${CWG.email}\n${CWG.phone}`,
    },
    {
        num: '6',
        title: 'Su Privacidad es Importante',
        body: `Protegemos su información personal. Para conocer nuestras prácticas de privacidad, visite:\n${CWG.privacyUrl}`,
    },
];
function Page2({ data }) {
    const showIllustrativeDisclaimer = data.documentStatus === 'draft';
    return (_jsxs(Page, { size: "LETTER", style: s.page, children: [_jsxs(View, { style: s.p2Header, children: [_jsxs(View, { style: s.p2HeaderLeft, children: [_jsx(Text, { style: s.companyName, children: CWG.name }), _jsx(Text, { style: s.companyTagline, children: CWG.tagline })] }), _jsxs(View, { style: s.p2HeaderCenter, children: [_jsx(Text, { style: s.pageNum, children: "PÁGINA 2 DE 2" }), _jsxs(Text, { style: s.p2Title, children: ["Información Importante", '\n', "sobre su Cuenta"] })] }), _jsxs(View, { style: s.p2HeaderRight, children: [_jsx(Text, { style: s.headerMetaLabel, children: "Número de cuenta / caso" }), _jsx(Text, { style: s.headerMetaValue, children: data.accountNumber })] })] }), _jsx(View, { style: s.p2Grid, children: PAGE2_SECTIONS.map(sec => (_jsxs(View, { style: s.p2Card, children: [_jsxs(Text, { style: s.p2CardNum, children: [sec.num, "."] }), _jsx(Text, { style: s.p2CardTitle, children: sec.title }), _jsx(Text, { style: s.p2CardBody, children: sec.body })] }, sec.num))) }), _jsxs(View, { style: s.p2Footer, children: [showIllustrativeDisclaimer && (_jsx(Text, { style: s.p2FooterText, children: "Esta imagen es solo un ejemplo visual del formato deseado. Los datos mostrados son ilustrativos." })), _jsx(Text, { style: [s.p2FooterText, { marginTop: 2 }], children: CWG.copyright })] })] }));
}
export function StatementPdfTemplate({ data }) {
    return (_jsxs(Document, { title: `Estado de Cuenta – ${data.clientName} – ${data.accountNumber}`, author: CWG.name, subject: "Estado de Cuenta", children: [_jsxs(Page, { size: "LETTER", style: s.page, children: [_jsx(PageHeader, { data: data, pageNum: "PÁGINA 1 DE 2" }), _jsxs(View, { style: s.infoZone, children: [_jsx(ClientInfoCol, { data: data }), _jsx(AccountSummaryCol, { data: data }), _jsx(PaymentInfoCol, { data: data })] }), _jsx(TransactionsTable, { lines: data.lines }), _jsx(ClientMessageZone, { data: data }), _jsx(FooterBar, {})] }), _jsx(Page2, { data: data })] }));
}
