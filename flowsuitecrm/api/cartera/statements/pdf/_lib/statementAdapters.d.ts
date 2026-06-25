import type {
  ClienteSnap,
  CvResumenLineRaw,
  CvResumenRaw,
  DfpStatementLineRaw,
  DfpStatementRaw,
} from '../../../../../src/modules/cartera/pdf/statementAdapters.js'
import type { StatementPdfData } from './StatementPdfTemplate.js'

export function cvResumenToStatementData(
  resumen: CvResumenRaw,
  lines: CvResumenLineRaw[],
  cliente: ClienteSnap,
  caseId: string,
  caseEstado: string,
): StatementPdfData

export function dfpStatementToStatementData(
  statement: DfpStatementRaw,
  lines: DfpStatementLineRaw[],
  cliente: ClienteSnap,
  caseEstado: string,
): StatementPdfData
