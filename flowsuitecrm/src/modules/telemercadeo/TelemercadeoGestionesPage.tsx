import { useCallback, useEffect, useRef } from 'react'
import { Button } from '../../components/Button'
import { useToast } from '../../components/useToast'
import { useModalHost } from '../../modals/useModalHost'

export function TelemercadeoGestionesPage() {
  const { showToast } = useToast()
  const { openGestionModal } = useModalHost()
  const openedOnMountRef = useRef(false)

  const openGestion = useCallback(() => {
    openGestionModal({
      moduloOrigen: 'telemercadeo_gestiones',
      onSubmit: async (draft) => {
        showToast(`Gestión preparada: ${draft.resumen || draft.tipo}`)
      },
    })
  }, [openGestionModal, showToast])

  useEffect(() => {
    if (openedOnMountRef.current) return
    openedOnMountRef.current = true
    openGestion()
  }, [openGestion])

  return (
    <div
      style={{
        display: 'grid',
        gap: '1rem',
        padding: '1.25rem',
        borderRadius: '1rem',
        border: '1px solid var(--color-border, #1f2937)',
        background: 'var(--color-surface, rgba(15, 23, 42, 0.78))',
      }}
    >
      <div style={{ display: 'grid', gap: '0.35rem' }}>
        <h3 style={{ margin: 0 }}>Gestiones</h3>
        <p style={{ margin: 0, color: 'var(--color-text-muted, #94a3b8)' }}>
          Busca clientes o leads y registra una gestión desde un solo lugar.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <Button type="button" onClick={openGestion}>
          + Nueva gestión
        </Button>
      </div>
    </div>
  )
}
