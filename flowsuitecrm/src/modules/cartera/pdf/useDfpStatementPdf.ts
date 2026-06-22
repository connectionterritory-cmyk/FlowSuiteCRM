import { useState } from 'react'
import { pdf } from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import { StatementPdfTemplate } from './StatementPdfTemplate'
import {
  dfpStatementToStatementData,
  type ClienteSnap,
  type DfpStatementLineRaw,
  type DfpStatementRaw,
} from './statementAdapters'

type GenerateOpts = {
  statement: DfpStatementRaw
  lines: DfpStatementLineRaw[]
  cliente: ClienteSnap
  caseEstado: string
}

function triggerPrint(url: string) {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.src = url

  const cleanup = () => {
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
      iframe.remove()
    }, 1000)
  }

  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) {
      cleanup()
      return
    }
    win.focus()
    win.print()
    cleanup()
  }

  document.body.appendChild(iframe)
}

export function useDfpStatementPdf() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchAndGenerate(opts: GenerateOpts): Promise<Blob | null> {
    setLoading(true)
    setError(null)

    try {
      const pdfData = dfpStatementToStatementData(opts.statement, opts.lines, opts.cliente, opts.caseEstado)
      const doc = createElement(StatementPdfTemplate, { data: pdfData }) as ReactElement<DocumentProps>
      return await pdf(doc).toBlob()
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
    a.download = filename ?? `statement-${opts.statement.id}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function getPreviewUrl(opts: GenerateOpts): Promise<string | null> {
    const blob = await fetchAndGenerate(opts)
    if (!blob) return null
    return URL.createObjectURL(blob)
  }

  async function printPdf(opts: GenerateOpts) {
    const blob = await fetchAndGenerate(opts)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    triggerPrint(url)
  }

  return { loading, error, downloadPdf, getPreviewUrl, printPdf }
}
