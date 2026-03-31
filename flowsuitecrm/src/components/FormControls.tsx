type ToggleSwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

export function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.65rem',
        border: '1px solid var(--color-input-border)',
        background: 'var(--color-surface-strong)',
        padding: '0.5rem 0.75rem',
        borderRadius: '999px',
        color: 'var(--color-text)',
        cursor: 'pointer',
      }}
    >
      <span
        style={{
          width: '2.5rem',
          height: '1.35rem',
          borderRadius: '999px',
          background: checked ? '#0f766e' : 'var(--color-input-border)',
          position: 'relative',
          transition: 'background 0.2s ease-in-out',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: '50%',
            left: checked ? 'calc(100% - 1.1rem)' : '0.15rem',
            transform: 'translateY(-50%)',
            width: '1rem',
            height: '1rem',
            background: '#fff',
            borderRadius: '50%',
            transition: 'left 0.2s ease-in-out',
            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
          }}
        />
      </span>
      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{label}</span>
    </button>
  )
}
