import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { MobileRecordCard } from './MobileRecordCard'
import type { MobileRecordDetailItem, MobileRecordMetaItem } from './MobileRecordCard'

export type DataTableColumn = string | {
  key?: string
  label: string
  hideOnMobile?: boolean
  hideOnTablet?: boolean
  priority?: number
}

export type DataTableMobileConfig = {
  titleColumn?: number
  subtitleColumn?: number
  metaColumns?: number[]
  badgeColumns?: number[]
  detailColumns?: number[]
  actionColumn?: number
  hiddenColumns?: number[]
}

export type DataTableRow = {
  id: string
  cells: React.ReactNode[]
  detail?: { label: string; value: React.ReactNode }[]
  expandedContent?: React.ReactNode
  isExpanded?: boolean
}

type DataTableProps = {
  columns: DataTableColumn[]
  rows?: DataTableRow[]
  pageSize?: number
  onRowClick?: (row: DataTableRow) => void
  emptyLabel?: string
  loading?: boolean
  error?: React.ReactNode
  sortableColumns?: number[]
  sortColIndex?: number
  sortDir?: 'asc' | 'desc'
  onSort?: (colIndex: number) => void
  mobileConfig?: DataTableMobileConfig
  renderMobileCard?: (row: DataTableRow, context: {
    columns: NormalizedDataTableColumn[]
    onRowClick?: (row: DataTableRow) => void
  }) => React.ReactNode
}

type NormalizedDataTableColumn = {
  key: string
  label: string
  index: number
  hideOnMobile: boolean
  hideOnTablet: boolean
  priority: number
}

const normalizeColumn = (column: DataTableColumn, index: number): NormalizedDataTableColumn => {
  if (typeof column === 'string') {
    return {
      key: `${index}-${column}`,
      label: column,
      index,
      hideOnMobile: false,
      hideOnTablet: false,
      priority: index + 1,
    }
  }

  return {
    key: column.key ?? `${index}-${column.label}`,
    label: column.label,
    index,
    hideOnMobile: Boolean(column.hideOnMobile),
    hideOnTablet: Boolean(column.hideOnTablet),
    priority: column.priority ?? index + 1,
  }
}

const hasContent = (value: React.ReactNode) => value !== null && value !== undefined && value !== ''

export function DataTable({
  columns,
  rows = [],
  pageSize = 20,
  onRowClick,
  emptyLabel,
  loading = false,
  error,
  sortableColumns,
  sortColIndex,
  sortDir,
  onSort,
  mobileConfig,
  renderMobileCard,
}: DataTableProps) {
  const { t } = useTranslation()
  const { isMobile, isTablet } = useBreakpoint()
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const normalizedColumns = useMemo(
    () => columns.map((column, index) => normalizeColumn(column, index)),
    [columns],
  )

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setPage(0)
    }, 0)
    return () => window.clearTimeout(handle)
  }, [rows.length, pageSize])

  const canPaginate = rows.length > pageSize

  const pageRows = useMemo(() => {
    const start = safePage * pageSize
    return rows.slice(start, start + pageSize)
  }, [pageSize, rows, safePage])

  const handlePrev = () => setPage((prev) => Math.max(0, prev - 1))
  const handleNext = () => setPage((prev) => Math.min(totalPages - 1, prev + 1))

  const tableColumns = useMemo(
    () => normalizedColumns.filter((column) => !(isTablet && column.hideOnTablet)),
    [isTablet, normalizedColumns],
  )

  const mobileColumns = useMemo(() => {
    const hidden = new Set(mobileConfig?.hiddenColumns ?? [])
    return normalizedColumns
      .filter((column) => !column.hideOnMobile && !hidden.has(column.index))
      .sort((a, b) => a.priority - b.priority || a.index - b.index)
  }, [mobileConfig?.hiddenColumns, normalizedColumns])

  const renderPagination = () => {
    if (!canPaginate) return null

    return (
      <div className="table-pagination">
        <button type="button" className="btn ghost" onClick={handlePrev} disabled={page === 0}>
          {t('common.previous')}
        </button>
        <span className="pagination-label">
          {t('common.page')} {safePage + 1} {t('common.of')} {totalPages}
        </span>
        <button
          type="button"
          className="btn ghost"
          onClick={handleNext}
          disabled={safePage + 1 >= totalPages}
        >
          {t('common.next')}
        </button>
      </div>
    )
  }

  const renderAutomaticMobileCard = (row: DataTableRow) => {
    const preferredTitle = mobileConfig?.titleColumn
    const titleColumn = preferredTitle !== undefined
      ? normalizedColumns[preferredTitle]
      : mobileColumns[0]
    const preferredSubtitle = mobileConfig?.subtitleColumn
    const subtitleColumn = preferredSubtitle !== undefined
      ? normalizedColumns[preferredSubtitle]
      : mobileColumns.find((column) => column.index !== titleColumn?.index)

    const badgeColumns = (mobileConfig?.badgeColumns ?? [])
      .map((index) => normalizedColumns[index])
      .filter((column): column is NormalizedDataTableColumn => Boolean(column))
    const metaColumns = (mobileConfig?.metaColumns ?? [])
      .map((index) => normalizedColumns[index])
      .filter((column): column is NormalizedDataTableColumn => Boolean(column))
    const actionColumn = mobileConfig?.actionColumn !== undefined
      ? normalizedColumns[mobileConfig.actionColumn]
      : undefined

    const defaultMetaColumns = metaColumns.length > 0
      ? metaColumns
      : mobileColumns.filter((column) => (
          column.index !== titleColumn?.index &&
          column.index !== subtitleColumn?.index &&
          column.index !== actionColumn?.index &&
          !badgeColumns.some((badgeColumn) => badgeColumn.index === column.index)
        )).slice(0, 2)

    const detailColumns = mobileConfig?.detailColumns
      ? mobileConfig.detailColumns
          .map((index) => normalizedColumns[index])
          .filter((column): column is NormalizedDataTableColumn => Boolean(column))
      : mobileColumns.filter((column) => (
          column.index !== titleColumn?.index &&
          column.index !== subtitleColumn?.index &&
          column.index !== actionColumn?.index &&
          !defaultMetaColumns.some((metaColumn) => metaColumn.index === column.index) &&
          !badgeColumns.some((badgeColumn) => badgeColumn.index === column.index)
        ))

    const detailItems: MobileRecordDetailItem[] = row.detail
      ? row.detail.map((item) => ({ label: item.label, value: item.value }))
      : detailColumns.map((column) => ({
          label: column.label,
          value: row.cells[column.index],
        }))

    const meta: MobileRecordMetaItem[] = defaultMetaColumns
      .map((column) => ({ label: column.label, value: row.cells[column.index] }))
      .filter((item) => hasContent(item.value))

    const badges = badgeColumns
      .map((column) => row.cells[column.index])
      .filter(hasContent)

    return (
      <MobileRecordCard
        key={row.id}
        title={titleColumn ? row.cells[titleColumn.index] : row.id}
        subtitle={subtitleColumn ? row.cells[subtitleColumn.index] : undefined}
        meta={meta}
        badges={badges}
        details={detailItems}
        actions={actionColumn ? row.cells[actionColumn.index] : undefined}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
      >
        {row.expandedContent && row.isExpanded ? row.expandedContent : null}
      </MobileRecordCard>
    )
  }

  if (isMobile) {
    return (
      <div className="mobile-data-table">
        {error && <div className="form-error">{error}</div>}
        {loading && rows.length === 0 ? (
          <div className="mobile-record-list">
            {Array.from({ length: 3 }).map((_, index) => (
              <MobileRecordCard key={index} loading />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="mobile-table-empty">
            {emptyLabel ?? t('common.noData')}
          </div>
        ) : (
          <div className="mobile-record-list">
            {pageRows.map((row) => (
              <Fragment key={row.id}>
                {renderMobileCard
                  ? renderMobileCard(row, { columns: normalizedColumns, onRowClick })
                  : renderAutomaticMobileCard(row)}
              </Fragment>
            ))}
          </div>
        )}
        {renderPagination()}
      </div>
    )
  }

  return (
    <div className="card table-card">
      {error && <div className="form-error table-error">{error}</div>}
      <table className="data-table">
        <thead>
          <tr>
            {tableColumns.map((column) => {
              const isSortable = sortableColumns?.includes(column.index)
              const isActive = sortColIndex === column.index
              return (
                <th
                  key={column.key}
                  onClick={isSortable ? () => onSort?.(column.index) : undefined}
                  style={isSortable ? { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' } : undefined}
                >
                  {column.label}
                  {isSortable && (
                    <span style={{ marginLeft: '0.3rem', opacity: isActive ? 1 : 0.3, fontSize: '0.75rem' }}>
                      {isActive && sortDir === 'desc' ? '↓' : '↑'}
                    </span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 ? (
            <tr>
              <td colSpan={tableColumns.length} className="table-empty">
                {t('common.loading')}
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={tableColumns.length} className="table-empty">
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
                  {tableColumns.map((column) => (
                    <td key={`${row.id}-${column.index}`}>{row.cells[column.index]}</td>
                  ))}
                </tr>
                {row.expandedContent && row.isExpanded && (
                  <tr className="data-row expanded-row">
                    <td colSpan={tableColumns.length}>{row.expandedContent}</td>
                  </tr>
                )}
              </Fragment>
            ))
          )}
        </tbody>
      </table>
      {renderPagination()}
    </div>
  )
}
