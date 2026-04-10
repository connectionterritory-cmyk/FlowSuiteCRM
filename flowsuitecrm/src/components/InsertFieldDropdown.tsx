import { useEffect, useRef, useState } from 'react'
import { PLACEHOLDER_OPTIONS } from '../lib/messagePlaceholders'

type Props = {
  onInsert: (token: string) => void
}

export function InsertFieldDropdown({ onInsert }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = search.trim()
    ? PLACEHOLDER_OPTIONS.filter(
        (opt) =>
          opt.label.toLowerCase().includes(search.toLowerCase()) ||
          opt.token.toLowerCase().includes(search.toLowerCase())
      )
    : PLACEHOLDER_OPTIONS

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus search on open
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  const handleInsert = (token: string) => {
    onInsert(token)
    setOpen(false)
    setSearch('')
  }

  // Group by group label
  const groups = filtered.reduce<Record<string, typeof PLACEHOLDER_OPTIONS>>((acc, opt) => {
    if (!acc[opt.group]) acc[opt.group] = []
    acc[opt.group].push(opt)
    return acc
  }, {})

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3rem',
          padding: '0.35rem 0.7rem',
          borderRadius: '0.45rem',
          border: '1px solid var(--color-border, #e5e7eb)',
          background: 'var(--color-surface, #f9fafb)',
          color: 'var(--color-text)',
          fontSize: '0.78rem',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'border-color 0.15s',
        }}
      >
        <span style={{ fontSize: '0.85rem' }}>{'{}'}</span>
        Insertar campo
        <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 200,
            width: '240px',
            background: 'var(--card-bg, #1e293b)',
            border: '1px solid var(--card-border, #334155)',
            borderRadius: '0.65rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            overflow: 'hidden',
          }}
        >
          {/* Search */}
          <div style={{ padding: '8px 8px 6px' }}>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar campo..."
              style={{
                width: '100%',
                padding: '0.3rem 0.55rem',
                borderRadius: '0.4rem',
                border: '1px solid var(--card-border, #334155)',
                background: 'var(--color-surface, rgba(255,255,255,0.05))',
                color: 'var(--color-text)',
                fontSize: '0.78rem',
                outline: 'none',
              }}
            />
          </div>

          {/* Options */}
          <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
            {Object.entries(groups).map(([groupLabel, opts]) => (
              <div key={groupLabel}>
                <div
                  style={{
                    padding: '4px 12px 2px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted, #6b7280)',
                    textTransform: 'uppercase',
                  }}
                >
                  {groupLabel}
                </div>
                {opts.map((opt) => (
                  <button
                    key={opt.token}
                    type="button"
                    onClick={() => handleInsert(opt.token)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '6px 12px',
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      textAlign: 'left',
                      gap: '8px',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(59,130,246,0.12)'
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'none'
                    }}
                  >
                    <span>{opt.label}</span>
                    <code
                      style={{
                        fontSize: '0.68rem',
                        color: '#60a5fa',
                        background: 'rgba(59,130,246,0.1)',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        flexShrink: 0,
                      }}
                    >
                      {opt.token}
                    </code>
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && (
              <div
                style={{
                  padding: '12px',
                  textAlign: 'center',
                  fontSize: '0.78rem',
                  color: 'var(--text-muted, #6b7280)',
                }}
              >
                Sin resultados
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div
            style={{
              padding: '6px 12px',
              borderTop: '1px solid var(--card-border, #334155)',
              fontSize: '0.65rem',
              color: 'var(--text-muted, #6b7280)',
            }}
          >
            Clic para insertar en el cursor
          </div>
        </div>
      )}
    </div>
  )
}
