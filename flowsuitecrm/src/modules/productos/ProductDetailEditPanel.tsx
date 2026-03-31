import type { ChangeEvent, Dispatch, ReactNode, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import { ToggleSwitch } from '../../components/FormControls'
import { INPUT_STYLE, LABEL_STYLE } from '../../components/formControlStyles'

type ProductoRecord = {
  codigo: string | null
  nombre: string | null
  categoria: string | null
  categoria_compra: string | null
  categoria_principal: string | null
  subcategoria: string | null
  linea_producto: string | null
  precio: number | null
  costo_n1: number | null
  costo_n2: number | null
  costo_n3: number | null
  costo_n4: number | null
  recargo_arancelario: number | null
  activo: boolean | null
  foto_url: string | null
}

type DetailValues = {
  nombre: string
  categoria_principal: string
  subcategoria: string
  linea_producto: string
  categoria_compra: string
  costo_n1: string
  costo_n2: string
  costo_n3: string
  costo_n4: string
  recargo_arancelario: string
  precio: string
  activo: boolean
}

type DetailItem = { label: string; value: ReactNode }

type ProductDetailEditPanelProps = {
  producto: ProductoRecord
  detailValues: DetailValues
  setDetailValues: Dispatch<SetStateAction<DetailValues>>
  canViewCostos: boolean
  categoriaCompraOptions: string[]
  handleDetailChange: (field: keyof DetailValues) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void
  handleDetailPhotoChange: (event: ChangeEvent<HTMLInputElement>) => void
  detailPhotoPreview: string | null
  t: TFunction
  gridStyle: React.CSSProperties
  mode?: 'edit' | 'create'
  showAdvancedFields?: boolean
  codigoValue?: string
  onCodigoChange?: (event: ChangeEvent<HTMLInputElement>) => void
}

export function ProductDetailEditPanel({
  producto,
  detailValues,
  setDetailValues,
  canViewCostos,
  categoriaCompraOptions,
  handleDetailChange,
  handleDetailPhotoChange,
  detailPhotoPreview,
  t,
  gridStyle,
  mode = 'edit',
  showAdvancedFields = true,
  codigoValue,
  onCodigoChange,
}: ProductDetailEditPanelProps): DetailItem[] {
  const renderInput = (value: string, onChange: (event: ChangeEvent<HTMLInputElement>) => void, placeholder?: string) => (
    <input value={value} onChange={onChange} placeholder={placeholder} style={INPUT_STYLE} />
  )

  const renderSelect = (value: string, options: string[], onChange: (event: ChangeEvent<HTMLSelectElement>) => void) => (
    <select value={value} onChange={onChange} style={INPUT_STYLE}>
      <option value="">{t('common.select')}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )

  const renderNumber = (value: string, onChange: (event: ChangeEvent<HTMLInputElement>) => void) => (
    <input type="number" value={value} onChange={onChange} style={INPUT_STYLE} />
  )

  const renderReadOnly = (value: string) => (
    <div
      style={{
        ...INPUT_STYLE,
        background: 'var(--color-surface-strong)',
        borderStyle: 'dashed',
      }}
    >
      {value || '-'}
    </div>
  )

  const renderField = (label: string, content: ReactNode) => (
    <div style={{ display: 'grid', gap: '0.4rem' }}>
      <span style={LABEL_STYLE}>{label}</span>
      {content}
    </div>
  )

  const photoValue = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input type="file" accept="image/*" onChange={handleDetailPhotoChange} />
      {(detailPhotoPreview || producto.foto_url) && (
        <img
          src={detailPhotoPreview ?? producto.foto_url ?? ''}
          alt={producto.nombre ?? t('productos.fields.foto')}
          style={{ maxWidth: '100%', borderRadius: 8 }}
        />
      )}
    </div>
  )

  const generalFields = (
    <div style={gridStyle}>
      {renderField(
        t('productos.fields.codigo'),
        mode === 'create' && onCodigoChange
          ? renderInput(codigoValue ?? '', onCodigoChange)
          : renderReadOnly(producto.codigo ?? '-')
      )}
      {renderField(t('productos.fields.nombre'), renderInput(detailValues.nombre, handleDetailChange('nombre')))}
      {renderField(
        t('productos.fields.categoria'),
        renderInput(
          detailValues.categoria_principal,
          handleDetailChange('categoria_principal'),
          t('productos.placeholders.categoria')
        )
      )}
      {showAdvancedFields &&
        renderField(
          t('productos.fields.subcategoria'),
          renderInput(
            detailValues.subcategoria,
            handleDetailChange('subcategoria'),
            t('productos.placeholders.subcategoria')
          )
        )}
      {showAdvancedFields &&
        renderField(
          t('productos.fields.linea'),
          renderInput(
            detailValues.linea_producto,
            handleDetailChange('linea_producto'),
            t('productos.placeholders.linea')
          )
        )}
    </div>
  )

  const costosFields = canViewCostos && showAdvancedFields ? (
    <div style={gridStyle}>
      {renderField(
        t('productos.fields.categoriaCompra'),
        renderSelect(detailValues.categoria_compra, categoriaCompraOptions, handleDetailChange('categoria_compra'))
      )}
      {renderField(t('productos.fields.costoN1'), renderNumber(detailValues.costo_n1, handleDetailChange('costo_n1')))}
      {renderField(t('productos.fields.costoN2'), renderNumber(detailValues.costo_n2, handleDetailChange('costo_n2')))}
      {renderField(t('productos.fields.costoN3'), renderNumber(detailValues.costo_n3, handleDetailChange('costo_n3')))}
      {renderField(t('productos.fields.costoN4'), renderNumber(detailValues.costo_n4, handleDetailChange('costo_n4')))}
    </div>
  ) : null

  const pricingFields = (
    <div style={gridStyle}>
      {renderField(t('productos.fields.precio'), renderNumber(detailValues.precio, handleDetailChange('precio')))}
      {canViewCostos && showAdvancedFields
        ? renderField(
            t('productos.fields.recargo'),
            renderNumber(detailValues.recargo_arancelario, handleDetailChange('recargo_arancelario'))
          )
        : null}
    </div>
  )

  return [
    { label: t('productos.sections.general'), value: generalFields },
    ...(canViewCostos && costosFields ? [{ label: t('productos.sections.costos'), value: costosFields }] : []),
    { label: t('productos.sections.precio'), value: pricingFields },
    {
      label: t('productos.fields.activo'),
      value: (
        <ToggleSwitch
          checked={detailValues.activo}
          onChange={(checked) => setDetailValues((prev) => ({ ...prev, activo: checked }))}
          label={detailValues.activo ? t('productos.estado.activo') : t('productos.estado.inactivo')}
        />
      ),
    },
    { label: t('productos.fields.foto'), value: photoValue },
  ]
}
