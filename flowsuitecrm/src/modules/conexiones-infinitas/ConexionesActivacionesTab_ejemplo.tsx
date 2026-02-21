import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { useConexiones } from '../../hooks/useConexiones'
import { formatPhone, isReferidoComplete, type ReferidoFormRow } from '../../lib/conexiones/validaciones'

const initialRow: ReferidoFormRow = {
  nombre: '',
  telefono: '',
  relacion: 'familiar',
}

export function ConexionesActivacionesTabEjemplo() {
  const { configured, loading, error, data, loadConexiones, createActivacion } = useConexiones()
  const [rows, setRows] = useState<ReferidoFormRow[]>([initialRow, initialRow, initialRow])
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (configured) {
      loadConexiones()
    }
  }, [configured, loadConexiones])

  const validReferidos = useMemo(() => rows.filter(isReferidoComplete), [rows])

  const handleRowChange = (index: number, field: keyof ReferidoFormRow, value: string) => {
    setRows((prev) =>
      prev.map((row, rowIndex) => {
        if (rowIndex !== index) return row
        if (field === 'telefono') return { ...row, telefono: formatPhone(value) }
        return { ...row, [field]: value }
      }),
    )
  }

  const handleCreate = async () => {
    setStatus(null)
    const result = await createActivacion({
      clienteId: null,
      leadId: null,
      regaloId: null,
      fotoUrl: null,
      whatsappEnviadoAt: null,
      referidos: rows,
    })
    if (result.error) {
      setStatus(result.error)
      return
    }
    setStatus('Activacion creada')
  }

  return (
    <section className="page-stack">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Conexiones - Activaciones (Ejemplo)</h2>
          <p className="text-sm text-slate-500">Hook separado de la UI</p>
        </div>
        <Button type="button" onClick={handleCreate} disabled={!configured || loading}>
          Crear activacion
        </Button>
      </header>

      {!configured && <div className="form-error">Supabase no configurado</div>}
      {error && <div className="form-error">{error}</div>}
      {status && <div className="form-hint">{status}</div>}

      <div className="grid gap-4">
        {rows.map((row, index) => (
          <div key={`referido-${index}`} className="grid gap-2 sm:grid-cols-3">
            <input
              placeholder="Nombre"
              value={row.nombre}
              onChange={(event) => handleRowChange(index, 'nombre', event.target.value)}
            />
            <input
              placeholder="Telefono"
              value={row.telefono}
              onChange={(event) => handleRowChange(index, 'telefono', event.target.value)}
            />
            <select
              value={row.relacion}
              onChange={(event) => handleRowChange(index, 'relacion', event.target.value)}
            >
              <option value="familiar">Familiar</option>
              <option value="amigo">Amigo</option>
              <option value="companero">Companero</option>
            </select>
          </div>
        ))}
      </div>

      <div className="text-sm text-slate-500">
        Referidos completos: {validReferidos.length} | Activaciones: {data.activaciones.length}
      </div>
    </section>
  )
}
