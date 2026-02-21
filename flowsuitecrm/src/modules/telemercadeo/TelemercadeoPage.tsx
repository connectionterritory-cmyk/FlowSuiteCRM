import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SectionHeader } from '../../components/SectionHeader'
import { DataTable, type DataTableRow } from '../../components/DataTable'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { useToast } from '../../components/Toast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/AuthProvider'

type UsuarioRecord = {
  id: string
  nombre: string | null
  apellido: string | null
  rol: string | null
  telefono: string | null
}

type AssignmentRecord = {
  vendedor_id: string
  telemercadeo_id: string
}

export function TelemercadeoPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { showToast } = useToast()
  const configured = isSupabaseConfigured
  const [usuarios, setUsuarios] = useState<UsuarioRecord[]>([])
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([])
  const [role, setRole] = useState<string | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)
  const [selectedTeleId, setSelectedTeleId] = useState('')
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const loadData = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setError(null)
    const [usuariosResult, assignmentsResult] = await Promise.all([
      supabase.from('usuarios').select('id, nombre, apellido, rol, telefono'),
      supabase.from('vendedor_telemercadeo').select('vendedor_id, telemercadeo_id'),
    ])

    if (usuariosResult.error || assignmentsResult.error) {
      setError(usuariosResult.error?.message || assignmentsResult.error?.message || t('common.noData'))
    }

    setUsuarios((usuariosResult.data as UsuarioRecord[]) ?? [])
    setAssignments((assignmentsResult.data as AssignmentRecord[]) ?? [])
    setLoading(false)
  }, [configured, t])

  useEffect(() => {
    if (configured) {
      loadRole()
      loadData()
    }
  }, [configured, loadData, loadRole])

  const teleUsers = useMemo(
    () => usuarios.filter((user) => user.rol === 'telemercadeo'),
    [usuarios]
  )

  const vendorUsers = useMemo(
    () => usuarios.filter((user) => user.rol === 'vendedor'),
    [usuarios]
  )

  const assignmentByVendor = useMemo(() => {
    const map = new Map<string, string>()
    assignments.forEach((assignment) => {
      map.set(assignment.vendedor_id, assignment.telemercadeo_id)
    })
    return map
  }, [assignments])

  const assignedToSelected = useMemo(() => {
    if (!selectedTeleId) return []
    return assignments
      .filter((assignment) => assignment.telemercadeo_id === selectedTeleId)
      .map((assignment) => assignment.vendedor_id)
  }, [assignments, selectedTeleId])

  const assignedVendors = useMemo(() => {
    const assignedSet = new Set(assignedToSelected)
    return vendorUsers.filter((vendor) => assignedSet.has(vendor.id))
  }, [assignedToSelected, vendorUsers])

  const availableVendors = useMemo(() => {
    return vendorUsers.filter((vendor) => !assignmentByVendor.has(vendor.id))
  }, [assignmentByVendor, vendorUsers])

  const assignedRows = useMemo<DataTableRow[]>(() => {
    return assignedVendors.map((vendor) => {
      const fullName = [vendor.nombre, vendor.apellido].filter(Boolean).join(' ') || vendor.id
      return {
        id: vendor.id,
        cells: [
          fullName,
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
                .match({ vendedor_id: vendor.id, telemercadeo_id: selectedTeleId })
              if (deleteError) {
                showToast(deleteError.message, 'error')
              } else {
                setAssignments((prev) =>
                  prev.filter(
                    (row) =>
                      !(row.vendedor_id === vendor.id && row.telemercadeo_id === selectedTeleId)
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
      .insert({ vendedor_id: selectedVendorId, telemercadeo_id: selectedTeleId })
    if (insertError) {
      showToast(insertError.message, 'error')
      return
    }
    setAssignments((prev) => [
      ...prev,
      { vendedor_id: selectedVendorId, telemercadeo_id: selectedTeleId },
    ])
    setSelectedVendorId('')
    showToast(t('toast.success'))
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

  if (role && role !== 'admin' && role !== 'distribuidor') {
    return (
      <EmptyState
        title={t('telemercadeo.noAccessTitle')}
        description={t('telemercadeo.noAccessDescription')}
      />
    )
  }

  return (
    <div className="page-stack">
      <SectionHeader
        title={t('telemercadeo.title')}
        subtitle={t('telemercadeo.subtitle')}
      />

      {error && <div className="form-error">{error}</div>}

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
                  {[vendor.nombre, vendor.apellido].filter(Boolean).join(' ') || vendor.id}
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
    </div>
  )
}
