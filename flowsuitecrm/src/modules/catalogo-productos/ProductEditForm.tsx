import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { ToggleSwitch } from '../../components/FormControls'
import { INPUT_STYLE, LABEL_STYLE } from '../../components/formControlStyles'

export type EditForm = {
  nombre: string
  estado: 'activo' | 'borrador' | 'descontinuado' | 'reemplazado'
  precio_publico: string
  cuota_minima: string
  con_financiamiento: boolean
  visible_catalogo: boolean
  descripcion_corta: string
  descripcion_larga: string
  beneficios: string
}

const ESTADO_OPTIONS = [
  { value: 'activo', label: 'Activo' },
  { value: 'borrador', label: 'Borrador' },
  { value: 'descontinuado', label: 'Descontinuado' },
  { value: 'reemplazado', label: 'Reemplazado' },
] as const

type ProductEditFormProps = {
  initialValues: EditForm
  onSave: (values: EditForm) => void
  onCancel: () => void
  saving: boolean
  error: string | null
}

export function ProductEditForm({ initialValues, onSave, onCancel, saving, error }: ProductEditFormProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<EditForm>(initialValues)

  return (
    <div style={{ display: 'grid', gap: '1.25rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1rem' }}>
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <span style={LABEL_STYLE}>{t('catalogo.fields.nombre')}</span>
          <input
            value={form.nombre}
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
            style={INPUT_STYLE}
          />
        </div>
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <span style={LABEL_STYLE}>{t('catalogo.fields.estado')}</span>
          <select
            value={form.estado}
            onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value as EditForm['estado'] }))}
            style={INPUT_STYLE}
          >
            {ESTADO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{t(`catalogo.status.${o.value}`)}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <span style={LABEL_STYLE}>{t('catalogo.fields.precioPublico')}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.precio_publico}
            onChange={(e) => setForm((f) => ({ ...f, precio_publico: e.target.value }))}
            style={INPUT_STYLE}
          />
        </div>
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <span style={LABEL_STYLE}>{t('catalogo.fields.cuotaMinima')}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.cuota_minima}
            onChange={(e) => setForm((f) => ({ ...f, cuota_minima: e.target.value }))}
            style={INPUT_STYLE}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem', background: 'var(--color-surface-strong)', borderRadius: '0.5rem' }}>
        <ToggleSwitch
          checked={form.con_financiamiento}
          onChange={(checked) => setForm((f) => ({ ...f, con_financiamiento: checked }))}
          label={t('catalogo.fields.conFinanciamiento')}
        />
        <ToggleSwitch
          checked={form.visible_catalogo}
          onChange={(checked) => setForm((f) => ({ ...f, visible_catalogo: checked }))}
          label={t('catalogo.fields.visibleCatalogo')}
        />
      </div>

      <div style={{ display: 'grid', gap: '0.4rem' }}>
        <span style={LABEL_STYLE}>{t('catalogo.fields.descripcionCorta')}</span>
        <textarea
          value={form.descripcion_corta}
          onChange={(e) => setForm((f) => ({ ...f, descripcion_corta: e.target.value }))}
          rows={2}
          style={{ ...INPUT_STYLE, resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'grid', gap: '0.4rem' }}>
        <span style={LABEL_STYLE}>{t('catalogo.fields.descripcionLarga')}</span>
        <textarea
          value={form.descripcion_larga}
          onChange={(e) => setForm((f) => ({ ...f, descripcion_larga: e.target.value }))}
          rows={4}
          style={{ ...INPUT_STYLE, resize: 'vertical' }}
        />
      </div>

      <div style={{ display: 'grid', gap: '0.4rem' }}>
        <span style={LABEL_STYLE}>{t('catalogo.fields.beneficios')}</span>
        <textarea
          value={form.beneficios}
          onChange={(e) => setForm((f) => ({ ...f, beneficios: e.target.value }))}
          rows={4}
          placeholder={t('catalogo.fields.beneficiosPlaceholder')}
          style={{ ...INPUT_STYLE, resize: 'vertical' }}
        />
      </div>

      {error && (
        <div style={{ color: '#dc2626', fontSize: '0.875rem', padding: '0.75rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '0.5rem' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="button" onClick={() => onSave(form)} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  )
}
