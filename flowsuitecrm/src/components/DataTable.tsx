import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type DataTableRow = {
  id: string
  cells: React.ReactNode[]
  detail?: { label: string; value: React.ReactNode }[]
  expandedContent?: React.ReactNode
  isExpanded?: boolean
}

type DataTableProps = {
  columns: string[]
  rows?: DataTableRow[]
  pageSize?: number
  onRowClick?: (row: DataTableRow) => void
  emptyLabel?: string
}

export function DataTable({
  columns,
  rows = [],
  pageSize = 20,
  onRowClick,
  emptyLabel,
}: DataTableProps) {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)

  useEffect(() => {
    setPage(0)
  }, [rows.length, pageSize])

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const canPaginate = rows.length > pageSize

  const pageRows = useMemo(() => {
    const start = page * pageSize
    return rows.slice(start, start + pageSize)
  }, [page, pageSize, rows])

  const handlePrev = () => setPage((prev) => Math.max(0, prev - 1))
  const handleNext = () => setPage((prev) => Math.min(totalPages - 1, prev + 1))

  return (
    <div className="card table-card">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="table-empty">
                {emptyLabel ?? t('common.noData')}
              </td>
            </tr>
          ) : (
            pageRows.map((row) => (
              <Fragment key={row.id}>
                <tr
                  className={onRowClick ? 'data-row clickable' : 'data-row'}
                  onClick={() => onRowClick?.(row)}
                >
                  {row.cells.map((cell, cellIndex) => (
                    <td key={`${row.id}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
                {row.expandedContent && row.isExpanded && (
                  <tr className="data-row expanded-row">
                    <td colSpan={columns.length}>{row.expandedContent}</td>
                  </tr>
                )}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
      {canPaginate && (
        <div className="table-pagination">
          <button type="button" className="btn ghost" onClick={handlePrev} disabled={page === 0}>
            {t('common.previous')}
          </button>
          <span className="pagination-label">
            {t('common.page')} {page + 1} {t('common.of')} {totalPages}
          </span>
          <button
            type="button"
            className="btn ghost"
            onClick={handleNext}
            disabled={page + 1 >= totalPages}
          >
            {t('common.next')}
          </button>
        </div>
      )}
    </div>
  )
}
