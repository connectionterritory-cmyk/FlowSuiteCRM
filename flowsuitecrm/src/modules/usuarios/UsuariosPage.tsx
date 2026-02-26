import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { DetailPanel } from '../../components/DetailPanel'
import { EmptyState } from '../../components/EmptyState'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import { getOrganizationName } from '../../lib/whatsappTemplates'

type UsuarioRecord = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  codigo_vendedor: string | null
  codigo_distribuidor: string | null
  rol: string | null
  activo: boolean | null
  created_at: string | null
}

type TeleAssignment = {
  id: string
  vendedor_id: string
  vendedor?: {
    nombre: string | null
    apellido: string | null
    rol: string | null
    email: string | null
  }
}

const initialForm = {
  nombre: '',
  apellido: '',
  email: '',
  codigo_vendedor: '',
  codigo_distribuidor: '',
  rol: 'vendedor',
  activo: true,
}

export function UsuariosPage() {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const { session } = useAuth()
  const [usuarios, setUsuarios] = useState<UsuarioRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formValues, setFormValues] = useState(initialForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resendingId, setResendingId] = useState<string | null>(null)

  const [role, setRole] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [userToDelete, setUserToDelete] = useState<UsuarioRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const [selectedRow, setSelectedRow] = useState<(DataTableRow & { originalData?: UsuarioRecord }) | null>(null)

  const [teleAssignments, setTeleAssignments] = useState<TeleAssignment[]>([])
  const [teleAssignSearch, setTeleAssignSearch] = useState('')
  const [teleAssignResults, setTeleAssignResults] = useState<UsuarioRecord[]>([])
  const [teleAssignLoading, setTeleAssignLoading] = useState(false)

  const configured = isSupabaseConfigured

  useEffect(() => {
    let active = true
    if (!configured || !session?.user.id) {
      setRole(null)
      return
    }
    setRoleLoading(true)
    const cargarRol = async () => {
      try {
        const { data } = await supabase
          .from('usuarios')
          .select('rol')
          .eq('id', session.user.id)
          .maybeSingle()
        if (!active) return
        setRole((data as { rol?: string } | null)?.rol ?? null)
      } finally {
        if (!active) return
        setRoleLoading(false)
      }
    }
    cargarRol()
    return () => {
      active = false
    }
  }, [configured, session?.user.id])

  const loadUsuarios = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('usuarios')
      .select('id, nombre, apellido, email, codigo_vendedor, codigo_distribuidor, rol, activo, created_at')
      .order('created_at', { ascending: false })

    if (fetchError) {
      setError(fetchError.message)
      setUsuarios([])
    } else {
      setUsuarios(data ?? [])
    }
    setLoading(false)
  }, [configured])

  useEffect(() => {
    if (configured) {
      loadUsuarios()
    }
  }, [configured, loadUsuarios])

  // Load tele_vendedor_assignments when editing a telemercadeo user
  useEffect(() => {
    if (!editingId || formValues.rol !== 'telemercadeo' || !configured) {
      setTeleAssignments([])
      setTeleAssignSearch('')
      setTeleAssignResults([])
      return
    }
    let active = true
    setTeleAssignLoading(true)
    const load = async () => {
      const { data } = await supabase
        .from('tele_vendedor_assignments')
        .select('id, vendedor_id, vendedor:usuarios!vendedor_id(nombre, apellido, rol, email)')
        .eq('tele_id', editingId)
      if (!active) return
      setTeleAssignments((data as unknown as TeleAssignment[]) ?? [])
      setTeleAssignLoading(false)
    }
    load()
    return () => { active = false }
  }, [editingId, formValues.rol, configured])

  // Debounced search for vendedores to assign
  useEffect(() => {
    if (!teleAssignSearch.trim() || !configured) {
      setTeleAssignResults([])
      setTeleAssignLoading(false)
      return
    }
    const term = teleAssignSearch.trim()
    let active = true
    setTeleAssignLoading(true)
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('usuarios')
        .select('id, nombre, apellido, email, codigo_vendedor, codigo_distribuidor, rol, activo, created_at')
        .in('rol', ['vendedor', 'distribuidor'])
        .eq('activo', true)
        .or(
          `nombre.ilike.%${term}%,apellido.ilike.%${term}%,email.ilike.%${term}%,codigo_vendedor.ilike.%${term}%,codigo_distribuidor.ilike.%${term}%`,
        )
        .limit(6)
      if (!active) return
      setTeleAssignResults(
        ((data ?? []) as UsuarioRecord[]).filter(
          (u) => !teleAssignments.some((a) => a.vendedor_id === u.id),
        ),
      )
      setTeleAssignLoading(false)
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [teleAssignSearch, configured, teleAssignments])

  const handleAddTeleAssignment = useCallback(
    async (vendedor: UsuarioRecord) => {
      if (!editingId) return
      const { data, error } = await supabase
        .from('tele_vendedor_assignments')
        .insert({ tele_id: editingId, vendedor_id: vendedor.id })
        .select('id, vendedor_id')
        .single()
      if (error) {
        showToast(error.message, 'error')
        return
      }
      setTeleAssignments((prev) => [
        ...prev,
        {
          ...(data as { id: string; vendedor_id: string }),
          vendedor: { nombre: vendedor.nombre, apellido: vendedor.apellido, rol: vendedor.rol, email: vendedor.email },
        },
      ])
      setTeleAssignSearch('')
      setTeleAssignResults([])
    },
    [editingId, showToast],
  )

  const handleRemoveTeleAssignment = useCallback(
    async (assignmentId: string) => {
      const { error } = await supabase
        .from('tele_vendedor_assignments')
        .delete()
        .eq('id', assignmentId)
      if (error) {
        showToast(error.message, 'error')
        return
      }
      setTeleAssignments((prev) => prev.filter((a) => a.id !== assignmentId))
    },
    [showToast],
  )

  const handleResendInvite = useCallback(
    async (usuario: UsuarioRecord) => {
      if (!usuario.email) {
        showToast(t('usuarios.errors.missingEmail'), 'error')
        return
      }
      if (!session?.access_token) {
        showToast(t('usuarios.errors.authRequired'), 'error')
        return
      }
      setResendingId(usuario.id)
      try {
        const { data, error: invokeError } = await supabase.functions.invoke('resend-invite', {
          body: { email: usuario.email, organizacion: getOrganizationName(session.user?.user_metadata) },
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
        if (invokeError || (data as { error?: string } | null)?.error) {
          const message = invokeError?.message || (data as { error?: string } | null)?.error || t('toast.error')
          showToast(message, 'error')
        } else {
          showToast(t('usuarios.success.inviteResent'))
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : t('toast.error')
        showToast(message, 'error')
      } finally {
        setResendingId(null)
      }
    },
    [showToast, t, session],
  )

  const filteredUsuarios = useMemo(() => {
    return usuarios.filter((u) => {
      const term = searchTerm.toLowerCase()
      const matchSearch = term
        ? (u.nombre?.toLowerCase().includes(term) ?? false) ||
        (u.apellido?.toLowerCase().includes(term) ?? false) ||
        (u.email?.toLowerCase().includes(term) ?? false) ||
        (u.codigo_vendedor?.toLowerCase().includes(term) ?? false) ||
        (u.codigo_distribuidor?.toLowerCase().includes(term) ?? false)
        : true
      const matchRole = roleFilter !== 'all' ? u.rol === roleFilter : true
      const matchStatus =
        statusFilter !== 'all'
          ? statusFilter === 'active'
            ? u.activo
            : !u.activo
          : true
      return matchSearch && matchRole && matchStatus
    })
  }, [usuarios, searchTerm, roleFilter, statusFilter])

  const handleOpenForm = useCallback((usuario?: UsuarioRecord) => {
    if (usuario) {
      setEditingId(usuario.id)
      setFormValues({
        nombre: usuario.nombre ?? '',
        apellido: usuario.apellido ?? '',
        email: usuario.email ?? '',
        codigo_vendedor: usuario.codigo_vendedor ?? '',
        codigo_distribuidor: usuario.codigo_distribuidor ?? '',
        rol: usuario.rol ?? 'vendedor',
        activo: usuario.activo ?? true,
      })
    } else {
      setEditingId(null)
      setFormValues(initialForm)
    }
    setFormError(null)
    setFormOpen(true)
  }, [])

  const handleDelete = async () => {
    if (!userToDelete) return
    setDeleting(true)
    const { error } = await supabase
      .from('usuarios')
      .update({ activo: false })
      .eq('id', userToDelete.id)

    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast(t('usuarios.success.deleted'))
      await loadUsuarios()
      setUserToDelete(null)
      if (selectedRow?.originalData?.id === userToDelete.id) {
        setSelectedRow(null)
      }
    }
    setDeleting(false)
  }

  const rows = useMemo<(DataTableRow & { originalData?: UsuarioRecord })[]>(() => {
    return filteredUsuarios.map((usuario) => {
      const fullName = [usuario.nombre, usuario.apellido].filter(Boolean).join(' ') || '-'
      const codigo = [usuario.codigo_vendedor, usuario.codigo_distribuidor]
        .filter(Boolean)
        .join(' / ')
      const estadoLabel = usuario.activo ? t('usuarios.estado.activo') : t('usuarios.estado.inactivo')
      const canResend = Boolean(usuario.email)

      return {
        id: usuario.id,
        originalData: usuario,
        cells: [
          fullName,
          usuario.email ?? '-',
          usuario.rol ? t(`usuarios.roles.${usuario.rol}`) : '-',
          codigo || '-',
          estadoLabel,
          <div key={`actions-${usuario.id}`} className="flex gap-2 items-center">
            <Button
              variant="ghost"
              type="button"
              disabled={!canResend || resendingId === usuario.id}
              onClick={(event) => {
                event.stopPropagation()
                handleResendInvite(usuario)
              }}
            >
              {resendingId === usuario.id
                ? t('common.saving')
                : t('usuarios.actions.resendInvite')}
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                handleOpenForm(usuario)
              }}
              title={t('usuarios.actions.edit')}
            >
              ✏️
            </Button>
            {usuario.activo && (
              <Button
                variant="ghost"
                type="button"
                className="text-red-500 hover:text-red-600"
                onClick={(event) => {
                  event.stopPropagation()
                  setUserToDelete(usuario)
                }}
                title={t('usuarios.actions.delete')}
              >
                🗑️
              </Button>
            )}
          </div>,
        ],
        detail: [
          { label: t('usuarios.fields.nombre'), value: usuario.nombre ?? '-' },
          { label: t('usuarios.fields.apellido'), value: usuario.apellido ?? '-' },
          { label: t('usuarios.fields.email'), value: usuario.email ?? '-' },
          { label: t('usuarios.fields.codigoVendedor'), value: usuario.codigo_vendedor ?? '-' },
          { label: t('usuarios.fields.codigoDistribuidor'), value: usuario.codigo_distribuidor ?? '-' },
          { label: t('usuarios.fields.rol'), value: usuario.rol ? t(`usuarios.roles.${usuario.rol}`) : '-' },
          { label: t('usuarios.fields.activo'), value: estadoLabel },
        ]
      }
    })
  }, [handleResendInvite, resendingId, t, filteredUsuarios, handleOpenForm])

  const emptyLabel = loading ? t('common.loading') : t('common.noData')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!configured) {
      setFormError(t('common.supabaseRequired'))
      return
    }
    if (!formValues.nombre.trim() || !formValues.apellido.trim() || !formValues.email.trim()) {
      setFormError(t('usuarios.errors.missingRequired'))
      return
    }

    const activeSession = session

    setSubmitting(true)
    setFormError(null)
    const toNull = (value: string) => (value.trim() === '' ? null : value.trim())

    if (editingId) {
      const payload = {
        nombre: toNull(formValues.nombre),
        apellido: toNull(formValues.apellido),
        codigo_vendedor: toNull(formValues.codigo_vendedor),
        codigo_distribuidor: toNull(formValues.codigo_distribuidor),
        rol: formValues.rol,
        activo: formValues.activo,
      }
      const { error } = await supabase
        .from('usuarios')
        .update(payload)
        .eq('id', editingId)

      if (error) {
        setFormError(error.message)
        showToast(error.message, 'error')
      } else {
        setFormOpen(false)
        await loadUsuarios()
        showToast(t('usuarios.success.updated'))
        if (selectedRow?.id === editingId) {
          setSelectedRow(null)
        }
      }
    } else {
      if (!activeSession?.access_token) {
        setFormError(t('usuarios.errors.authRequired'))
        setSubmitting(false)
        return
      }
      const payload = {
        nombre: toNull(formValues.nombre),
        apellido: toNull(formValues.apellido),
        email: toNull(formValues.email),
        codigo_vendedor: toNull(formValues.codigo_vendedor),
        codigo_distribuidor: toNull(formValues.codigo_distribuidor),
        rol: formValues.rol,
        activo: formValues.activo,
        organizacion: getOrganizationName(activeSession.user?.user_metadata),
      }
      const { data, error: invokeError } = await supabase.functions.invoke('create-user', {
        body: payload,
        headers: {
          Authorization: `Bearer ${activeSession.access_token}`,
        },
      })

      if (invokeError || (data as { error?: string } | null)?.error) {
        const message = invokeError?.message || (data as { error?: string } | null)?.error || t('toast.error')
        setFormError(message)
        showToast(message, 'error')
      } else {
        setFormOpen(false)
        await loadUsuarios()
        showToast(t('usuarios.success.invite'))
      }
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
      {roleLoading ? (
        <div className="page">Cargando...</div>
      ) : role && role !== 'admin' && role !== 'distribuidor' ? (
        <div>
          <SectionHeader
            title={t('usuarios.title')}
            subtitle={t('usuarios.subtitle')}
          />
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted)' }}>
            <p style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Acceso restringido</p>
            <p style={{ fontSize: '0.9rem' }}>Solo administradores y distribuidores pueden usar este módulo.</p>
          </div>
        </div>
      ) : (
        <>
          <SectionHeader
            title={t('usuarios.title')}
            subtitle={t('usuarios.subtitle')}
            action={<Button onClick={() => handleOpenForm()}>{t('common.newUsuario')}</Button>}
          />
          {!configured && (
            <EmptyState
              title={t('dashboard.missingConfigTitle')}
              description={t('dashboard.missingConfigDescription')}
            />
          )}
          {error && <div className="form-error">{error}</div>}

          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <input
              type="search"
              placeholder={t('usuarios.filters.search')}
              style={{ flex: 1, padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid #ccc' }}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select
              style={{ width: 'auto', padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid #ccc' }}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="all">{t('usuarios.filters.allRoles')}</option>
              <option value="admin">{t('usuarios.roles.admin')}</option>
              <option value="distribuidor">{t('usuarios.roles.distribuidor')}</option>
              <option value="vendedor">{t('usuarios.roles.vendedor')}</option>
              <option value="telemercadeo">{t('usuarios.roles.telemercadeo')}</option>
            </select>
            <select
              style={{ width: 'auto', padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid #ccc' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">{t('usuarios.filters.allStatuses')}</option>
              <option value="active">{t('usuarios.estado.activo')}</option>
              <option value="inactive">{t('usuarios.estado.inactivo')}</option>
            </select>
          </div>

          <DataTable
            columns={[
              t('usuarios.columns.nombre'),
              t('usuarios.columns.email'),
              t('usuarios.columns.rol'),
              t('usuarios.columns.codigo'),
              t('usuarios.columns.activo'),
              t('usuarios.columns.actions'),
            ]}
            rows={rows as DataTableRow[]}
            emptyLabel={emptyLabel}
            onRowClick={setSelectedRow as any}
          />

          <Modal
            open={formOpen}
            title={editingId ? t('usuarios.form.editTitle') : t('usuarios.form.title')}
            onClose={() => setFormOpen(false)}
            actions={
              <>
                <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" form="usuario-form" disabled={submitting}>
                  {submitting ? t('common.saving') : t('common.save')}
                </Button>
              </>
            }
          >
            {!editingId && (
              <div className="form-hint">
                <strong>{t('usuarios.instructions.title')}</strong>
                <p>{t('usuarios.instructions.singleStep')}</p>
              </div>
            )}
            <form id="usuario-form" className="form-grid" onSubmit={handleSubmit}>
              <label className="form-field">
                <span>{t('usuarios.fields.nombre')}</span>
                <input value={formValues.nombre} onChange={handleChange('nombre')} required />
              </label>
              <label className="form-field">
                <span>{t('usuarios.fields.apellido')}</span>
                <input value={formValues.apellido} onChange={handleChange('apellido')} required />
              </label>
              <label className="form-field">
                <span>{t('usuarios.fields.email')}</span>
                <input
                  type="email"
                  value={formValues.email}
                  onChange={handleChange('email')}
                  required
                  disabled={Boolean(editingId)}
                  title={editingId ? t('usuarios.errors.emailReadonly') : undefined}
                />
              </label>
              <label className="form-field">
                <span>{t('usuarios.fields.codigoVendedor')}</span>
                <input value={formValues.codigo_vendedor} onChange={handleChange('codigo_vendedor')} />
              </label>
              <label className="form-field">
                <span>{t('usuarios.fields.codigoDistribuidor')}</span>
                <input value={formValues.codigo_distribuidor} onChange={handleChange('codigo_distribuidor')} />
              </label>
              <label className="form-field">
                <span>{t('usuarios.fields.rol')}</span>
                <select value={formValues.rol} onChange={handleChange('rol')}>
                  <option value="admin">{t('usuarios.roles.admin')}</option>
                  <option value="distribuidor">{t('usuarios.roles.distribuidor')}</option>
                  <option value="vendedor">{t('usuarios.roles.vendedor')}</option>
                  <option value="telemercadeo">{t('usuarios.roles.telemercadeo')}</option>
                </select>
              </label>
              <label className="form-field checkbox-field">
                <span>{t('usuarios.fields.activo')}</span>
                <input type="checkbox" checked={formValues.activo} onChange={handleChange('activo')} />
              </label>
              {formError && <div className="form-error">{formError}</div>}
            </form>

            {editingId && formValues.rol === 'telemercadeo' && (
              <div
                style={{
                  marginTop: '1.5rem',
                  borderTop: '1px solid var(--color-border, #2b3244)',
                  paddingTop: '1.25rem',
                }}
              >
                <p
                  style={{
                    fontWeight: 700,
                    marginBottom: '0.75rem',
                    fontSize: '0.9rem',
                    color: 'var(--color-text)',
                  }}
                >
                  Vendedores asignados
                </p>

                {teleAssignLoading ? (
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>Cargando...</p>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                      marginBottom: '0.75rem',
                    }}
                  >
                    {teleAssignments.length === 0 ? (
                      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                        Sin vendedores asignados
                      </p>
                    ) : (
                      teleAssignments.map((a) => {
                        const name =
                          [a.vendedor?.nombre, a.vendedor?.apellido].filter(Boolean).join(' ') ||
                          a.vendedor?.email ||
                          '—'
                        return (
                          <div
                            key={a.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '0.4rem 0.75rem',
                              background: 'var(--color-surface, #f8fafb)',
                              borderRadius: '0.5rem',
                              border: '1px solid var(--color-border, #2b3244)',
                              color: 'var(--color-text)',
                            }}
                          >
                            <div>
                              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{name}</span>
                              <span
                                style={{
                                  marginLeft: '0.5rem',
                                  fontSize: '0.75rem',
                                  color: 'var(--color-text-muted)',
                                }}
                              >
                                ({a.vendedor?.rol ?? '?'})
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveTeleAssignment(a.id)}
                              title="Quitar asignación"
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#ef4444',
                                fontSize: '1rem',
                                lineHeight: 1,
                                padding: '0 0.25rem',
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}

                <div style={{ position: 'relative' }}>
                  <input
                    type="search"
                    placeholder="Buscar vendedor o distribuidor..."
                    value={teleAssignSearch}
                    onChange={(e) => setTeleAssignSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.45rem 0.7rem',
                      borderRadius: '0.4rem',
                      border: '1px solid var(--color-border, #2b3244)',
                      background: 'var(--color-input, #1b2230)',
                      color: 'var(--color-text)',
                      fontSize: '0.85rem',
                      boxSizing: 'border-box',
                    }}
                  />
                  {(teleAssignSearch.trim() !== '' || teleAssignLoading) && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 'calc(100% + 6px)',
                        left: 0,
                        right: 0,
                        zIndex: 20,
                        background: 'var(--color-card, #1b2230)',
                        border: '1px solid var(--color-border, #2b3244)',
                        borderRadius: '0.5rem',
                        marginBottom: '0.25rem',
                        boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
                        maxHeight: '180px',
                        overflowY: 'auto',
                      }}
                    >
                      {teleAssignLoading ? (
                        <div
                          style={{
                            padding: '0.6rem 0.75rem',
                            fontSize: '0.82rem',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          Buscando...
                        </div>
                      ) : teleAssignResults.length === 0 ? (
                        <div
                          style={{
                            padding: '0.6rem 0.75rem',
                            fontSize: '0.82rem',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          Sin resultados
                        </div>
                      ) : (
                        teleAssignResults.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => handleAddTeleAssignment(u)}
                            style={{
                              display: 'block',
                              width: '100%',
                              textAlign: 'left',
                              padding: '0.5rem 0.75rem',
                              background: 'none',
                              border: 'none',
                              borderBottom: '1px solid var(--color-border, #2b3244)',
                              cursor: 'pointer',
                              fontSize: '0.85rem',
                              color: 'var(--color-text)',
                            }}
                          >
                            {[u.nombre, u.apellido].filter(Boolean).join(' ') || u.email}{' '}
                            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                              ({u.rol})
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Modal>

          <Modal
            open={Boolean(userToDelete)}
            title={t('usuarios.actions.delete')}
            onClose={() => setUserToDelete(null)}
            actions={
              <>
                <Button variant="ghost" onClick={() => setUserToDelete(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  style={{ backgroundColor: '#dc2626', color: 'white' }}
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? t('common.saving') : t('usuarios.actions.delete')}
                </Button>
              </>
            }
          >
            <p>{t('usuarios.actions.confirmDelete')}</p>
            <p className="mt-2" style={{ color: '#6b7280', fontSize: '0.875rem' }}>
              {userToDelete?.nombre} {userToDelete?.apellido} ({userToDelete?.email})
            </p>
          </Modal>

          <DetailPanel
            open={Boolean(selectedRow)}
            title={t('usuarios.detailsTitle')}
            items={selectedRow?.detail ?? []}
            onClose={() => setSelectedRow(null)}
            action={
              selectedRow?.originalData && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    handleOpenForm(selectedRow.originalData)
                  }}
                  title={t('usuarios.actions.edit')}
                >
                  ✏️
                </Button>
              )
            }
          />
        </>
      )}
    </div>
  )
}
