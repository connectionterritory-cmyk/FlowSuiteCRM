import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { DetailPanel } from '../../components/DetailPanel'
import { EmptyState } from '../../components/EmptyState'
import { IconWhatsapp } from '../../components/icons'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import { useUsers } from '../../data/UsersProvider'
import { useMessaging } from '../../hooks/useMessaging'

type ClienteRecord = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  numero_cuenta_financiera: string | null
  saldo_actual: number | null
  estado_morosidad: string | null
  vendedor_id: string | null
  distribuidor_id: string | null
  fecha_nacimiento: string | null
  activo: boolean | null
  created_at: string | null
}

const initialForm = {
  nombre: '',
  apellido: '',
  email: '',
  telefono: '',
  direccion: '',
  apartamento: '',
  ciudad: '',
  estado_region: '',
  codigo_postal: '',
  numero_cuenta_financiera: '',
  saldo_actual: '',
  estado_morosidad: '',
  vendedor_id: '',
  distribuidor_id: '',
  fecha_nacimiento: '',
  activo: true,
}

export function ClientesPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { usersById } = useUsers()
  const { showToast } = useToast()
  const [clientes, setClientes] = useState<ClienteRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selectedRow, setSelectedRow] = useState<DataTableRow | null>(null)
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const configured = isSupabaseConfigured

  const parseDireccion = useCallback((value: string | null) => {
    if (!value) {
      return {
        direccion: '-',
        apartamento: '-',
        ciudad: '-',
        estado_region: '-',
        codigo_postal: '-',
      }
    }
    try {
      const parsed = JSON.parse(value) as Partial<typeof initialForm>
      return {
        direccion: parsed.direccion || '-',
        apartamento: parsed.apartamento || '-',
        ciudad: parsed.ciudad || '-',
        estado_region: parsed.estado_region || '-',
        codigo_postal: parsed.codigo_postal || '-',
      }
    } catch {
      return {
        direccion: value,
        apartamento: '-',
        ciudad: '-',
        estado_region: '-',
        codigo_postal: '-',
      }
    }
  }, [])

  const loadClientes = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('clientes')
      .select('*')
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
      setClientes([])
    } else {
      setClientes(data ?? [])
    }
    setLoading(false)
  }, [configured])

  useEffect(() => {
    if (configured) {
      loadClientes()
    }
  }, [configured, loadClientes])

  const rows = useMemo<DataTableRow[]>(() => {
    return clientes.map((cliente) => {
      const fullName = [cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || '-'
      const morosidadLabel = cliente.estado_morosidad
        ? t(`clientes.morosidad.${cliente.estado_morosidad}`)
        : '-'
      const estadoLabel = cliente.activo ? t('clientes.estado.activo') : t('clientes.estado.inactivo')
      const vendedorName = cliente.vendedor_id ? usersById[cliente.vendedor_id] ?? cliente.vendedor_id : '-'
      const direccionParts = parseDireccion(cliente.direccion)
      const whatsappAction = (
        <button
          type="button"
          className="whatsapp-button"
          aria-label={t('whatsapp.open')}
          onClick={(event) => {
            event.stopPropagation()
            openWhatsapp({
              nombre: fullName,
              telefono: cliente.telefono ?? '',
              email: cliente.email ?? '',
              vendedor: vendedorName === '-' ? '' : vendedorName,
            })
          }}
        >
          <IconWhatsapp className="whatsapp-icon" />
        </button>
      )
      return {
        id: cliente.id,
        cells: [
          fullName,
          cliente.telefono ?? '-',
          cliente.numero_cuenta_financiera ?? '-',
          vendedorName,
          morosidadLabel,
          estadoLabel,
          whatsappAction,
        ],
        detail: [
          { label: t('clientes.fields.nombre'), value: cliente.nombre ?? '-' },
          { label: t('clientes.fields.apellido'), value: cliente.apellido ?? '-' },
          { label: t('clientes.fields.email'), value: cliente.email ?? '-' },
          { label: t('clientes.fields.telefono'), value: cliente.telefono ?? '-' },
          { label: t('clientes.fields.direccion'), value: direccionParts.direccion },
          { label: t('clientes.fields.apartamento'), value: direccionParts.apartamento },
          { label: t('clientes.fields.ciudad'), value: direccionParts.ciudad },
          { label: t('clientes.fields.estadoRegion'), value: direccionParts.estado_region },
          { label: t('clientes.fields.codigoPostal'), value: direccionParts.codigo_postal },
          { label: t('clientes.fields.numeroCuentaFinanciera'), value: cliente.numero_cuenta_financiera ?? '-' },
          { label: t('clientes.fields.saldoActual'), value: cliente.saldo_actual ?? '-' },
          { label: t('clientes.fields.estadoMorosidad'), value: morosidadLabel },
          { label: t('clientes.fields.vendedorId'), value: vendedorName },
          { label: t('clientes.fields.distribuidorId'), value: cliente.distribuidor_id ?? '-' },
          { label: t('clientes.fields.fechaNacimiento'), value: cliente.fecha_nacimiento ?? '-' },
          { label: t('clientes.fields.activo'), value: estadoLabel },
        ],
      }
    })
  }, [clientes, parseDireccion, session?.user?.user_metadata, t, usersById])

  const emptyLabel = loading ? t('common.loading') : t('common.noData')

  const handleOpenForm = () => {
    setFormValues({
      ...initialForm,
      vendedor_id: session?.user.id ?? '',
    })
    setFormError(null)
    setFormOpen(true)
  }

  const vendedorName = session?.user.id ? (usersById[session.user.id] ?? session.user.id) : '-'

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setFormError(t('common.supabaseRequired'))
      return
    }
    setSubmitting(true)
    setFormError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())
    const vendedorId = session?.user.id ?? null
    const direccionPayload = {
      direccion: toNull(formValues.direccion),
      apartamento: toNull(formValues.apartamento),
      ciudad: toNull(formValues.ciudad),
      estado_region: toNull(formValues.estado_region),
      codigo_postal: toNull(formValues.codigo_postal),
    }
    const direccionValue = Object.values(direccionPayload).some((value) => value)
      ? JSON.stringify(direccionPayload)
      : null
    const payload = {
      nombre: toNull(formValues.nombre),
      apellido: toNull(formValues.apellido),
      email: toNull(formValues.email),
      telefono: toNull(formValues.telefono),
      direccion: direccionValue,
      numero_cuenta_financiera: toNull(formValues.numero_cuenta_financiera),
      saldo_actual: formValues.saldo_actual === '' ? 0 : Number(formValues.saldo_actual),
      estado_morosidad: formValues.estado_morosidad || null,
      vendedor_id: vendedorId,
      distribuidor_id: toNull(formValues.distribuidor_id),
      fecha_nacimiento: formValues.fecha_nacimiento || null,
      activo: formValues.activo,
    }

    const { error: insertError } = await supabase.from('clientes').insert(payload)

    if (insertError) {
      setFormError(insertError.message)
      showToast(insertError.message, 'error')
    } else {
      setFormOpen(false)
      await loadClientes()
      showToast(t('toast.success'))
    }
    setSubmitting(false)
  }

  const handleChange = (field: keyof typeof initialForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const target = event.target
      const value =
        target instanceof HTMLInputElement && target.type === 'checkbox'
          ? target.checked
          : target.value
      setFormValues((prev) => ({ ...prev, [field]: value }))
    }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('clientes.title')}
        subtitle={t('clientes.subtitle')}
        action={<Button onClick={handleOpenForm}>{t('common.newCliente')}</Button>}
      />
      {!configured && (
        <EmptyState
          title={t('dashboard.missingConfigTitle')}
          description={t('dashboard.missingConfigDescription')}
        />
      )}
      {error && <div className="form-error">{error}</div>}
      <DataTable
        columns={[
          t('clientes.columns.nombre'),
          t('clientes.columns.telefono'),
          t('clientes.columns.cuenta'),
          t('clientes.columns.vendedor'),
          t('clientes.columns.morosidad'),
          t('clientes.columns.estado'),
          t('whatsapp.column'),
        ]}
        rows={rows}
        emptyLabel={emptyLabel}
        onRowClick={setSelectedRow}
      />
      <Modal
        open={formOpen}
        title={t('clientes.form.title')}
        onClose={() => setFormOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="cliente-form" disabled={submitting}>
              {submitting ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="cliente-form" className="form-grid" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>{t('clientes.fields.nombre')}</span>
            <input value={formValues.nombre} onChange={handleChange('nombre')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.apellido')}</span>
            <input value={formValues.apellido} onChange={handleChange('apellido')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.email')}</span>
            <input type="email" value={formValues.email} onChange={handleChange('email')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.telefono')}</span>
            <input value={formValues.telefono} onChange={handleChange('telefono')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.direccion')}</span>
            <input value={formValues.direccion} onChange={handleChange('direccion')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.apartamento')}</span>
            <input value={formValues.apartamento} onChange={handleChange('apartamento')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.ciudad')}</span>
            <input value={formValues.ciudad} onChange={handleChange('ciudad')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.estadoRegion')}</span>
            <input value={formValues.estado_region} onChange={handleChange('estado_region')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.codigoPostal')}</span>
            <input value={formValues.codigo_postal} onChange={handleChange('codigo_postal')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.numeroCuentaFinanciera')}</span>
            <input
              value={formValues.numero_cuenta_financiera}
              onChange={handleChange('numero_cuenta_financiera')}
            />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.saldoActual')}</span>
            <input type="number" value={formValues.saldo_actual} onChange={handleChange('saldo_actual')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.estadoMorosidad')}</span>
            <select value={formValues.estado_morosidad} onChange={handleChange('estado_morosidad')}>
              <option value="">-</option>
              <option value="0-30">{t('clientes.morosidad.0-30')}</option>
              <option value="31-60">{t('clientes.morosidad.31-60')}</option>
              <option value="61-90">{t('clientes.morosidad.61-90')}</option>
              <option value="91+">{t('clientes.morosidad.91+')}</option>
            </select>
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.vendedorId')}</span>
            <input value={vendedorName} readOnly />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.distribuidorId')}</span>
            <input value={formValues.distribuidor_id} onChange={handleChange('distribuidor_id')} />
          </label>
          <label className="form-field">
            <span>{t('clientes.fields.fechaNacimiento')}</span>
            <input type="date" value={formValues.fecha_nacimiento} onChange={handleChange('fecha_nacimiento')} />
          </label>
          <label className="form-field checkbox-field">
            <span>{t('clientes.fields.activo')}</span>
            <input type="checkbox" checked={formValues.activo} onChange={handleChange('activo')} />
          </label>
          {formError && <div className="form-error">{formError}</div>}
        </form>
      </Modal>
      <DetailPanel
        open={Boolean(selectedRow)}
        title={t('clientes.detailsTitle')}
        items={selectedRow?.detail ?? []}
        onClose={() => setSelectedRow(null)}
      />
      <ModalRenderer />
    </div>
  )
}
