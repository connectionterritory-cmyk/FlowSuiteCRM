import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { Modal } from '../../components/Modal'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'
import { useMessaging } from '../../hooks/useMessaging'
import { ActivacionCard } from './ActivacionCard'

type UsuarioRecord = {
  id: string
  nombre: string | null
  apellido: string | null
  rol: string | null
  telefono: string | null
  distribuidor_padre_id?: string | null
}

type AssignmentRecord = {
  vendedor_id: string
  telemercadista_id: string
}

type ActivacionRecord = {
  id: string
  cliente_id: string | null
  programa_id: string | null
  representante_id: string | null
  estado: string | null
  created_at: string | null
}

type ProgramaRecord = {
  id: string
  nombre: string | null
  activo: boolean | null
}

type ClienteLite = {
  id: string
  nombre: string | null
  apellido: string | null
  telefono: string | null
}

export function TelemercadeoPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { showToast } = useToast()
  const { openWhatsapp, ModalRenderer } = useMessaging()
  const location = useLocation()
  const navigate = useNavigate()
  const configured = isSupabaseConfigured
  const [usuarios, setUsuarios] = useState<UsuarioRecord[]>([])
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([])
  const [activaciones, setActivaciones] = useState<ActivacionRecord[]>([])
  const [programas, setProgramas] = useState<ProgramaRecord[]>([])
  const [clientes, setClientes] = useState<ClienteLite[]>([])
  const [representantes, setRepresentantes] = useState<UsuarioRecord[]>([])
  const [role, setRole] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)
  const [selectedTeleId, setSelectedTeleId] = useState('')
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedProgramId, setSelectedProgramId] = useState('')
  const [selectedRepresentanteId, setSelectedRepresentanteId] = useState('')
  const [selectedCliente, setSelectedCliente] = useState<ClienteLite | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchResults, setSearchResults] = useState<ClienteLite[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  const loadRole = useCallback(async () => {
    if (!configured || !session?.user.id) {
      setRole(null)
      setRoleLoading(false)
      return
    }
    const { data, error: roleError } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', session.user.id)
      .maybeSingle()
    if (roleError) {
      setRole(null)
    } else {
      setRole((data as { rol?: string } | null)?.rol ?? null)
    }
    setRoleLoading(false)
  }, [configured, session?.user.id])

  const loadAssignments = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const [usuariosResult, assignmentsResult] = await Promise.all([
      supabase.from('usuarios').select('id, nombre, apellido, rol, telefono'),
      supabase.from('vendedor_telemercadeo').select('vendedor_id, telemercadista_id'),
    ])

    if (usuariosResult.error || assignmentsResult.error) {
      setError(usuariosResult.error?.message || assignmentsResult.error?.message || t('common.noData'))
    }

    setUsuarios((usuariosResult.data as UsuarioRecord[]) ?? [])
    setAssignments((assignmentsResult.data as AssignmentRecord[]) ?? [])
    setLoading(false)
  }, [configured, t])

  const loadTelemercadeoData = useCallback(async () => {
    if (!configured || !session?.user.id) return
    setLoading(true)
    setError(null)
    const [activacionesResult, programasResult, assignmentsResult] = await Promise.all([
      supabase
        .from('ci_activaciones')
        .select('id, cliente_id, programa_id, representante_id, estado, created_at')
        .order('created_at', { ascending: false }),
      supabase.from('programas').select('id, nombre, activo').order('nombre'),
      supabase
        .from('vendedor_telemercadeo')
        .select('vendedor_id, telemercadista_id')
        .eq('telemercadista_id', session.user.id),
    ])

    if (activacionesResult.error || programasResult.error || assignmentsResult.error) {
      setError(
        activacionesResult.error?.message ||
          programasResult.error?.message ||
          assignmentsResult.error?.message ||
          t('common.noData')
      )
    }

    const nextActivaciones = (activacionesResult.data as ActivacionRecord[]) ?? []
    const nextProgramas = (programasResult.data as ProgramaRecord[]) ?? []
    const nextAssignments = (assignmentsResult.data as AssignmentRecord[]) ?? []

    const repIds = [...new Set(nextAssignments.map((row) => row.vendedor_id))]
    let representantesData: UsuarioRecord[] = []
    if (repIds.length > 0) {
      const repsResult = await supabase
        .from('usuarios')
        .select('id, nombre, apellido, telefono, rol, distribuidor_padre_id')
        .in('id', repIds)
      representantesData = (repsResult.data as UsuarioRecord[]) ?? []
    }

    const distribuidorIds = Array.from(
      new Set(
        representantesData
          .map((rep) => rep.distribuidor_padre_id)
          .filter((id): id is string => Boolean(id))
          .filter((id) => !repIds.includes(id))
      )
    )

    if (distribuidorIds.length > 0) {
      const distribuidorResult = await supabase
        .from('usuarios')
        .select('id, nombre, apellido, telefono, rol')
        .in('id', distribuidorIds)
      const distribuidores = (distribuidorResult.data as UsuarioRecord[]) ?? []
      representantesData = [...representantesData, ...distribuidores]
    }

    setActivaciones(nextActivaciones)
    setProgramas(nextProgramas)
    setAssignments(nextAssignments)
    setRepresentantes(representantesData)
    setLoading(false)
  }, [configured, session?.user.id, t])

  useEffect(() => {
    if (configured) {
      loadRole()
    }
  }, [configured, loadRole])

  useEffect(() => {
    if (!role) return
    if (role === 'telemercadeo') {
      loadTelemercadeoData()
    } else if (role === 'admin' || role === 'distribuidor') {
      loadAssignments()
    }
  }, [role, loadAssignments, loadTelemercadeoData])

  useEffect(() => {
    if (!configured || activaciones.length === 0) {
      setClientes([])
      return
    }
    const ids = [...new Set(activaciones.map((item) => item.cliente_id).filter(Boolean))] as string[]
    if (ids.length === 0) {
      setClientes([])
      return
    }
    supabase
      .from('clientes')
      .select('id, nombre, apellido, telefono')
      .in('id', ids)
      .then(({ data }) => setClientes((data as ClienteLite[]) ?? []))
  }, [activaciones, configured])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(searchTerm.trim())
    }, 300)
    return () => window.clearTimeout(handle)
  }, [searchTerm])

  useEffect(() => {
    const runSearch = async () => {
      if (!configured || debouncedSearch.length < 2) {
        setSearchResults([])
        return
      }
      setSearchLoading(true)
      const term = debouncedSearch.replace(/%/g, '')
      const { data, error: searchError } = await supabase
        .from('clientes')
        .select('id, nombre, apellido, telefono')
        .or(`nombre.ilike.%${term}%,apellido.ilike.%${term}%,telefono.ilike.%${term}%`)
        .limit(8)
      if (searchError) {
        setSearchResults([])
      } else {
        setSearchResults((data as ClienteLite[]) ?? [])
      }
      setSearchLoading(false)
    }

    runSearch()
  }, [configured, debouncedSearch])

  useEffect(() => {
    if (role !== 'telemercadeo') return
    const params = new URLSearchParams(location.search)
    if (params.get('new') === '1') {
      setCreateOpen(true)
      navigate('/telemercadeo', { replace: true })
    }
  }, [location.search, navigate, role])

  const teleUsers = useMemo(
    () => usuarios.filter((user) => user.rol === 'telemercadeo'),
    [usuarios]
  )

  const assignableUsers = useMemo(
    () => usuarios.filter((user) => user.rol === 'vendedor' || user.rol === 'distribuidor'),
    [usuarios]
  )

  const assignmentByVendor = useMemo(() => {
    const map = new Map<string, string>()
    assignments.forEach((assignment) => {
      map.set(assignment.vendedor_id, assignment.telemercadista_id)
    })
    return map
  }, [assignments])

  const assignedToSelected = useMemo(() => {
    if (!selectedTeleId) return []
    return assignments
      .filter((assignment) => assignment.telemercadista_id === selectedTeleId)
      .map((assignment) => assignment.vendedor_id)
  }, [assignments, selectedTeleId])

  const assignedVendors = useMemo(() => {
    const assignedSet = new Set(assignedToSelected)
    return assignableUsers.filter((user) => assignedSet.has(user.id))
  }, [assignedToSelected, assignableUsers])

  const availableVendors = useMemo(() => {
    return assignableUsers.filter((user) => !assignmentByVendor.has(user.id))
  }, [assignmentByVendor, assignableUsers])

  const clientesById = useMemo(() => {
    return new Map(clientes.map((cliente) => [cliente.id, cliente]))
  }, [clientes])

  const programasById = useMemo(() => {
    return new Map(programas.map((programa) => [programa.id, programa]))
  }, [programas])

  const activeProgramas = useMemo(
    () => programas.filter((programa) => programa.activo),
    [programas]
  )

  const assignedRows = useMemo<DataTableRow[]>(() => {
    return assignedVendors.map((vendor) => {
      const fullName = [vendor.nombre, vendor.apellido].filter(Boolean).join(' ') || vendor.id
      const roleLabel = vendor.rol ? t(`usuarios.roles.${vendor.rol}`) : ''
      const nameWithRole = roleLabel ? `${fullName} · ${roleLabel}` : fullName
      return {
        id: vendor.id,
        cells: [
          nameWithRole,
          vendor.telefono ?? '-',
          <Button
            key={`remove-${vendor.id}`}
            variant="ghost"
            type="button"
            onClick={async (event) => {
              event.stopPropagation()
              if (!configured) return
              const { error: deleteError } = await supabase
                .from('vendedor_telemercadeo')
                .delete()
                .match({ vendedor_id: vendor.id, telemercadista_id: selectedTeleId })
              if (deleteError) {
                showToast(deleteError.message, 'error')
              } else {
                setAssignments((prev) =>
                  prev.filter(
                    (row) =>
                      !(row.vendedor_id === vendor.id && row.telemercadista_id === selectedTeleId)
                  )
                )
                showToast(t('toast.success'))
              }
            }}
          >
            {t('telemercadeo.actions.remove')}
          </Button>,
        ],
      }
    })
  }, [assignedVendors, configured, selectedTeleId, showToast, t])

  const activacionRows = useMemo<DataTableRow[]>(() => {
    return activaciones.map((activacion) => {
      const cliente = activacion.cliente_id ? clientesById.get(activacion.cliente_id) : null
      const programa = activacion.programa_id ? programasById.get(activacion.programa_id) : null
      const nombreCliente =
        [cliente?.nombre, cliente?.apellido].filter(Boolean).join(' ') || activacion.cliente_id || '-'
      return {
        id: activacion.id,
        cells: [
          nombreCliente,
          programa?.nombre ?? activacion.programa_id ?? '-',
          activacion.estado ?? '-',
          <Button
            key={`wa-${activacion.id}`}
            variant="ghost"
            type="button"
            onClick={() =>
              openWhatsapp({
                nombre: nombreCliente,
                telefono: cliente?.telefono,
              })
            }
          >
            {t('telemercadeo.labels.whatsapp')}
          </Button>,
        ],
      }
    })
  }, [activaciones, clientesById, openWhatsapp, programasById, t])

  const activationCards = useMemo(() => {
    return activaciones.map((activacion) => {
      const cliente = activacion.cliente_id ? clientesById.get(activacion.cliente_id) : null
      const programa = activacion.programa_id ? programasById.get(activacion.programa_id) : null
      const nombreCliente =
        [cliente?.nombre, cliente?.apellido].filter(Boolean).join(' ') || activacion.cliente_id || '-'
      return (
        <ActivacionCard
          key={activacion.id}
          clienteNombre={nombreCliente}
          clienteTelefono={cliente?.telefono}
          programaNombre={programa?.nombre ?? activacion.programa_id ?? '-'}
          estado={activacion.estado ?? '-'}
          onWhatsapp={() =>
            openWhatsapp({
              nombre: nombreCliente,
              telefono: cliente?.telefono,
            })
          }
          labels={{
            cliente: t('telemercadeo.labels.cliente'),
            programa: t('telemercadeo.labels.programa'),
            telefono: t('telemercadeo.labels.telefono'),
            whatsapp: t('telemercadeo.labels.whatsapp'),
          }}
        />
      )
    })
  }, [activaciones, clientesById, openWhatsapp, programasById, t])

  const handleAssign = async () => {
    if (!configured) {
      setError(t('common.supabaseRequired'))
      return
    }
    if (!selectedTeleId || !selectedVendorId) {
      showToast(t('telemercadeo.errors.missingSelection'), 'error')
      return
    }
    const assignedTele = assignmentByVendor.get(selectedVendorId)
    if (assignedTele) {
      showToast(t('telemercadeo.errors.alreadyAssigned'), 'error')
      return
    }

    const { error: insertError } = await supabase
      .from('vendedor_telemercadeo')
      .insert({ vendedor_id: selectedVendorId, telemercadista_id: selectedTeleId })
    if (insertError) {
      showToast(insertError.message, 'error')
      return
    }
    setAssignments((prev) => [
      ...prev,
      { vendedor_id: selectedVendorId, telemercadista_id: selectedTeleId },
    ])
    setSelectedVendorId('')
    showToast(t('toast.success'))
  }

  const handleCreateOpen = () => {
    setCreateOpen(true)
    setSelectedProgramId('')
    setSelectedRepresentanteId('')
    setSelectedCliente(null)
    setSearchTerm('')
    setSearchResults([])
  }

  const handleCreateActivation = async () => {
    if (!configured) {
      showToast(t('common.supabaseRequired'), 'error')
      return
    }
    if (!selectedProgramId || !selectedRepresentanteId || !selectedCliente?.id) {
      showToast(t('telemercadeo.errors.missingActivationFields'), 'error')
      return
    }
    setCreating(true)
    const { error: insertError } = await supabase.from('ci_activaciones').insert({
      programa_id: selectedProgramId,
      representante_id: selectedRepresentanteId,
      cliente_id: selectedCliente.id,
      estado: 'pendiente',
    })
    if (insertError) {
      showToast(insertError.message, 'error')
      setCreating(false)
      return
    }
    showToast(t('toast.success'))
    setCreateOpen(false)
    setCreating(false)
    loadTelemercadeoData()
  }

  if (!configured) {
    return (
      <EmptyState
        title={t('dashboard.missingConfigTitle')}
        description={t('dashboard.missingConfigDescription')}
      />
    )
  }

  if (roleLoading) {
    return <div className="page">{t('common.loading')}</div>
  }

  if (role && role !== 'admin' && role !== 'distribuidor' && role !== 'telemercadeo') {
    return (
      <EmptyState
        title={t('telemercadeo.noAccessTitle')}
        description={t('telemercadeo.noAccessDescription')}
      />
    )
  }

  const isTelemercadeo = role === 'telemercadeo'

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('telemercadeo.title')}
        subtitle={isTelemercadeo ? t('telemercadeo.subtitleTele') : t('telemercadeo.subtitle')}
        action={
          isTelemercadeo ? (
            <Button type="button" onClick={handleCreateOpen}>
              {t('telemercadeo.actions.newActivation')}
            </Button>
          ) : null
        }
      />

      {error && <div className="form-error">{error}</div>}

      {isTelemercadeo ? (
        <>
          <div className="mobile-only activation-cards">
            {activationCards.length > 0 ? activationCards : (
              <div className="card empty-card">{loading ? t('common.loading') : t('telemercadeo.activaciones.empty')}</div>
            )}
          </div>
          <div className="desktop-only">
            <DataTable
              columns={[
                t('telemercadeo.columns.cliente'),
                t('telemercadeo.columns.programa'),
                t('telemercadeo.columns.estado'),
                t('telemercadeo.columns.actions'),
              ]}
              rows={activacionRows}
              emptyLabel={loading ? t('common.loading') : t('telemercadeo.activaciones.empty')}
            />
          </div>
        </>
      ) : (
        <>
          <div className="card form-card">
            <div className="form-grid">
              <label className="form-field">
                <span>{t('telemercadeo.fields.tele')}</span>
                <select
                  value={selectedTeleId}
                  onChange={(event) => {
                    setSelectedTeleId(event.target.value)
                    setSelectedVendorId('')
                  }}
                >
                  <option value="">{t('common.select')}</option>
                  {teleUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {[user.nombre, user.apellido].filter(Boolean).join(' ') || user.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>{t('telemercadeo.fields.vendedor')}</span>
                <select
                  value={selectedVendorId}
                  onChange={(event) => setSelectedVendorId(event.target.value)}
                  disabled={!selectedTeleId}
                >
                  <option value="">{t('common.select')}</option>
                  {availableVendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {[
                        [vendor.nombre, vendor.apellido].filter(Boolean).join(' ') || vendor.id,
                        vendor.rol ? t(`usuarios.roles.${vendor.rol}`) : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="telemercadeo-actions">
              <Button type="button" onClick={handleAssign} disabled={!selectedTeleId || !selectedVendorId}>
                {t('telemercadeo.actions.assign')}
              </Button>
            </div>
          </div>

          <DataTable
            columns={[
              t('telemercadeo.columns.vendedor'),
              t('telemercadeo.columns.telefono'),
              t('telemercadeo.columns.actions'),
            ]}
            rows={assignedRows}
            emptyLabel={loading ? t('common.loading') : t('telemercadeo.empty')}
          />
        </>
      )}

      <Modal
        open={createOpen}
        title={t('telemercadeo.modal.title')}
        description={t('telemercadeo.modal.subtitle')}
        onClose={() => setCreateOpen(false)}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={handleCreateActivation} disabled={creating}>
              {creating ? t('common.saving') : t('telemercadeo.actions.createActivation')}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <label className="form-field">
            <span>{t('telemercadeo.fields.programa')}</span>
            <select value={selectedProgramId} onChange={(event) => setSelectedProgramId(event.target.value)}>
              <option value="">{t('common.select')}</option>
              {activeProgramas.map((programa) => (
                <option key={programa.id} value={programa.id}>
                  {programa.nombre ?? programa.id}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{t('telemercadeo.fields.representante')}</span>
            <select
              value={selectedRepresentanteId}
              onChange={(event) => setSelectedRepresentanteId(event.target.value)}
            >
              <option value="">{t('common.select')}</option>
              {representantes.map((representante) => (
                <option key={representante.id} value={representante.id}>
                  {[
                    [representante.nombre, representante.apellido].filter(Boolean).join(' ') || representante.id,
                    representante.rol ? t(`usuarios.roles.${representante.rol}`) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="cliente-search">
          <label className="form-field">
            <span>{t('telemercadeo.fields.buscarCliente')}</span>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t('telemercadeo.fields.buscarClientePlaceholder')}
            />
          </label>
          {selectedCliente && (
            <div className="cliente-selected">
              <strong>{t('telemercadeo.labels.clienteSeleccionado')}</strong>
              <p>
                {[selectedCliente.nombre, selectedCliente.apellido].filter(Boolean).join(' ') || selectedCliente.id}
                {selectedCliente.telefono ? ` · ${selectedCliente.telefono}` : ''}
              </p>
              <button type="button" className="inline-link" onClick={() => setSelectedCliente(null)}>
                {t('telemercadeo.actions.clearSelection')}
              </button>
            </div>
          )}
          <div className="cliente-results">
            {searchLoading ? (
              <p className="muted">{t('common.loading')}</p>
            ) : debouncedSearch.length < 2 ? (
              <p className="muted">{t('telemercadeo.search.helper')}</p>
            ) : searchResults.length === 0 ? (
              <p className="muted">{t('telemercadeo.search.empty')}</p>
            ) : (
              searchResults.map((cliente) => (
                <button
                  key={cliente.id}
                  type="button"
                  className="cliente-result"
                  onClick={() => setSelectedCliente(cliente)}
                >
                  <span>
                    {[cliente.nombre, cliente.apellido].filter(Boolean).join(' ') || cliente.id}
                  </span>
                  <span className="muted">{cliente.telefono ?? '-'}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </Modal>
      <ModalRenderer />
    </div>
  )
}
