import type { CSSProperties } from 'react'

export const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '0.7rem 0.85rem',
  borderRadius: '0.75rem',
  border: '1px solid var(--color-input-border)',
  background: 'var(--color-input)',
  color: 'var(--color-text)',
  fontSize: '0.95rem',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s, box-shadow 0.2s',
}

export const LABEL_STYLE: CSSProperties = {
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--color-text-muted, #6b7280)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}
