import { useState } from 'react'
import { pdf } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import { supabase } from '../../../lib/supabase/client'
import { StatementPdfTemplate } from './StatementPdfTemplate'
import { cvResumenToStatementData } from './statementAdapters'
import type { CvResumenRaw, CvResumenLineRaw, ClienteSnap } from './statementAdapters'

type GenerateOpts = {
  resumenId: string
  caseId: string
  caseEstado: string
}

export function useCvResumenPdf() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchAndGenerate(opts: GenerateOpts): Promise<Blob | null> {
    setLoading(true)
    setError(null)

    try {
      const [resumenRes, linesRes] = await Promise.all([
        supabase
          .from('cob_cv_resumenes')
          .select(`
            id, case_id, cliente_id, periodo_inicio, periodo_fin, fecha_corte,
            approval_date_snapshot, statement_date_snapshot, due_date_snapshot,
            interest_period_start_snapshot, interest_period_end_snapshot,
            interest_days_snapshot, interest_apr_snapshot, interest_amount_periodo,
            balance_proyectado_due_date,
            monto_original, saldo_apertura_periodo, pagos_periodo, pagos_acumulados,
            fee_plataforma_periodo, creditos_periodo, ajustes_periodo,
            saldo_pendiente_corte, proximo_pago_esperado, fecha_proximo_pago, status,
            clientes (nombre, apellido, hycite_id, telefono, email, direccion, ciudad, estado_region, codigo_postal)
          `)
          .eq('id', opts.resumenId)
          .single(),
        supabase
          .from('cob_cv_resumen_lines')
          .select('id, line_number, line_type, event_date, description, monto_aplicado_balance, fee_plataforma, monto_total_cobrado_cliente, running_balance_after')
          .eq('resumen_id', opts.resumenId)
          .order('line_number', { ascending: true }),
      ])

      if (resumenRes.error) throw new Error(`Error cargando resumen: ${resumenRes.error.message}`)
      if (linesRes.error) throw new Error(`Error cargando líneas: ${linesRes.error.message}`)

      const raw = resumenRes.data as unknown as CvResumenRaw & { clientes: ClienteSnap }
      const lines = (linesRes.data ?? []) as CvResumenLineRaw[]
      const cliente: ClienteSnap = raw.clientes ?? {}

      const pdfData = cvResumenToStatementData(raw, lines, cliente, opts.caseId, opts.caseEstado)

      const doc = createElement(StatementPdfTemplate, { data: pdfData }) as ReactElement<DocumentProps>
      const blob = await pdf(doc).toBlob()
      return blob
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generando PDF')
      return null
    } finally {
      setLoading(false)
    }
  }

  async function downloadPdf(opts: GenerateOpts, filename?: string) {
    const blob = await fetchAndGenerate(opts)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename ?? `estado-cuenta-${opts.caseId.slice(0, 8)}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function getPreviewUrl(opts: GenerateOpts): Promise<string | null> {
    const blob = await fetchAndGenerate(opts)
    if (!blob) return null
    return URL.createObjectURL(blob)
  }

  return { loading, error, downloadPdf, getPreviewUrl }
}
