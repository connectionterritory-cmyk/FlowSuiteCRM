function resolveAccountNumber(caseId, hyciteId) {
    if (hyciteId)
        return hyciteId;
    return caseId.toUpperCase().slice(0, 8);
}
export function cvResumenToStatementData(resumen, lines, cliente, caseId, caseEstado) {
    const sortedLines = [...lines].sort((a, b) => a.line_number - b.line_number);
    const normalizedLines = sortedLines.map(l => ({
        date: l.event_date,
        description: l.description,
        type: mapCvLineType(l.line_type),
        amount: l.monto_aplicado_balance > 0
            ? l.monto_aplicado_balance
            : l.monto_total_cobrado_cliente,
        runningBalance: l.running_balance_after,
    }));
    const nombre = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || 'Cliente';
    return {
        accountType: 'cargo_vuelta',
        caseId,
        accountNumber: resolveAccountNumber(caseId, cliente.hycite_id),
        emissionDate: resumen.fecha_corte,
        periodStart: resumen.periodo_inicio,
        periodEnd: resumen.periodo_fin,
        clientName: nombre,
        address: cliente.direccion,
        city: cliente.ciudad,
        state: cliente.estado_region,
        zip: cliente.codigo_postal,
        phone: cliente.telefono,
        email: cliente.email,
        originalAmount: resumen.monto_original,
        previousBalance: resumen.saldo_apertura_periodo,
        paymentsAccumulated: resumen.pagos_acumulados,
        paymentsPeriod: resumen.pagos_periodo,
        creditsPeriod: resumen.creditos_periodo + resumen.ajustes_periodo,
        interestCharges: resumen.interest_amount_periodo,
        feesPeriod: resumen.fee_plataforma_periodo,
        pendingBalance: resumen.saldo_pendiente_corte,
        projectedDueBalance: resumen.balance_proyectado_due_date,
        agreedMonthlyPayment: resumen.proximo_pago_esperado,
        nextPaymentDate: resumen.fecha_proximo_pago,
        accountStatus: caseEstado,
        approvalDate: resumen.approval_date_snapshot,
        statementDate: resumen.statement_date_snapshot,
        dueDate: resumen.due_date_snapshot,
        interestPeriodStart: resumen.interest_period_start_snapshot,
        interestPeriodEnd: resumen.interest_period_end_snapshot,
        interestDays: resumen.interest_days_snapshot,
        apr: null,
        interestApr: resumen.interest_apr_snapshot,
        interestBasis: null,
        ytdInterest: null,
        ytdFees: null,
        lines: normalizedLines,
        documentStatus: resumen.status === 'enviado' ? 'enviado' : resumen.status === 'anulado' ? 'anulado' : 'draft',
    };
}
function mapCvLineType(raw) {
    const map = {
        saldo_apertura: 'saldo_apertura',
        pago: 'pago',
        credito: 'credito',
        ajuste: 'ajuste',
        cargo_interes: 'cargo_interes',
        saldo_cierre: 'saldo_cierre',
        proximo_pago: 'proximo_pago',
    };
    return map[raw] ?? 'ajuste';
}
export function dfpStatementToStatementData(statement, lines, cliente, caseEstado) {
    let runningBalance = Number(statement.balance_previo || 0);
    const normalizedLines = lines.map(line => {
        const signedAmount = Number(line.amount || 0);
        runningBalance += signedAmount;
        return {
            date: line.transaction_date ?? line.posting_date,
            description: line.description || line.entry_type || 'Movimiento',
            type: mapDfpLineType(line.entry_type, signedAmount),
            amount: Math.abs(signedAmount),
            runningBalance,
        };
    });
    const nombre = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || 'Cliente';
    return {
        accountType: 'dfp',
        caseId: statement.case_id,
        accountNumber: resolveAccountNumber(statement.case_id, cliente.hycite_id),
        emissionDate: statement.fecha_corte,
        periodStart: statement.periodo_inicio,
        periodEnd: statement.periodo_fin,
        clientName: nombre,
        address: cliente.direccion,
        city: cliente.ciudad,
        state: cliente.estado_region,
        zip: cliente.codigo_postal,
        phone: cliente.telefono,
        email: cliente.email,
        originalAmount: statement.compras_periodo,
        previousBalance: statement.balance_previo,
        paymentsAccumulated: 0,
        paymentsPeriod: statement.pagos_periodo,
        creditsPeriod: 0,
        interestCharges: statement.cargos_interes_periodo,
        feesPeriod: 0,
        pendingBalance: statement.nuevo_balance,
        projectedDueBalance: null,
        agreedMonthlyPayment: statement.pago_minimo,
        nextPaymentDate: statement.fecha_vencimiento,
        accountStatus: caseEstado,
        approvalDate: null,
        statementDate: statement.fecha_corte,
        dueDate: statement.fecha_vencimiento,
        interestPeriodStart: null,
        interestPeriodEnd: null,
        interestDays: null,
        apr: statement.apr_tae,
        interestApr: null,
        interestBasis: null,
        ytdInterest: null,
        ytdFees: null,
        lines: normalizedLines,
        documentStatus: mapDocumentStatus(statement.status),
    };
}
function mapDfpLineType(raw, amount) {
    const value = (raw ?? '').toLowerCase();
    if (value.includes('principal_initial') || value.includes('saldo_apertura') || value.includes('opening')) {
        return 'saldo_apertura';
    }
    if (value.includes('interest') || value.includes('interes')) {
        return 'cargo_interes';
    }
    if (value.includes('fee') || value.includes('cargo_fee') || value.includes('late')) {
        return 'cargo_fee';
    }
    if (value.includes('payment') || value.includes('pago')) {
        return 'pago';
    }
    if (value.includes('credit') || value.includes('credito') || value.includes('refund') || value.includes('reversal')) {
        return 'credito';
    }
    if (value.includes('adjust') || value.includes('ajuste')) {
        return 'ajuste';
    }
    return amount < 0 ? 'pago' : 'ajuste';
}
function mapDocumentStatus(status) {
    const value = status.toLowerCase();
    if (value.includes('anulad'))
        return 'anulado';
    if (value.includes('enviad'))
        return 'enviado';
    if (value.includes('final'))
        return 'final';
    return 'draft';
}
