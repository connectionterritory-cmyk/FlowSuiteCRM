import { type KeyboardEventHandler, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase/client'
import { buildMapsNavUrl } from '../lib/addressUtils'
import { buildWhatsappUrl } from '../lib/whatsappTemplates'
import { Button } from './Button'

export type NearbyContact = {
  id: string
  tipo: 'cliente' | 'lead'
  nombre: string
  telefono: string | null
  direccion: string | null
  ciudad: string | null
  estado_region: string | null
  zip: string | null
}

export type NearbyPanelState = {
  contactoNombre: string
  mapsUrl: string | null
  zip: string | null
  ciudad: string | null
  baseId?: string
  baseTipo?: 'cliente' | 'lead'
}

function NearbyRow({ contact, onSelectContact }: { contact: NearbyContact; onSelectContact?: (contact: NearbyContact) => void }) {
  const waUrl = contact.telefono ? buildWhatsappUrl(contact.telefono, `Hola ${contact.nombre}`) : null
  const navUrl = buildMapsNavUrl({
    direccion: contact.direccion,
    ciudad: contact.ciudad,
    estado_region: contact.estado_region,
    codigo_postal: contact.zip,
  })
  const handleSelect = () => {
    onSelectContact?.(contact)
  }
  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleSelect()
    }
  }
  return (
    <div
      role={onSelectContact ? 'button' : undefined}
      tabIndex={onSelectContact ? 0 : undefined}
      onClick={onSelectContact ? handleSelect : undefined}
      onKeyDown={onSelectContact ? handleKeyDown : undefined}
      style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--color-surface-raised, #e5e7eb)', borderRadius: '0.5rem', cursor: onSelectContact ? 'pointer' : 'default', border: onSelectContact ? '1px solid #d1d5db' : '1px solid transparent', transition: 'background 120ms ease, border-color 120ms ease' }}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#111827' }}>{contact.nombre}</div>
        <div style={{ fontSize: '0.78rem', color: '#374151' }}>
          {contact.tipo === 'lead' ? 'Prospecto' : 'Cliente'}{contact.telefono ? ` · ${contact.telefono}` : ''}
        </div>
        {contact.direccion && (
          <div style={{ fontSize: '0.78rem', color: '#374151' }}>{contact.direccion}</div>
        )}
        {onSelectContact && (
          <div style={{ fontSize: '0.72rem', color: '#4b5563', fontWeight: 600, marginTop: '0.2rem' }}>
            Click para editar
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {waUrl && (
          <a onClick={(event) => event.stopPropagation()} href={waUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '0.35rem 0.65rem', background: '#25d366', color: '#fff', borderRadius: '0.375rem', fontSize: '0.8rem', textDecoration: 'none', fontWeight: 600, minHeight: '32px', display: 'inline-flex', alignItems: 'center' }}>
            WA
          </a>
        )}
        {navUrl && (
          <a onClick={(event) => event.stopPropagation()} href={navUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '0.35rem 0.65rem', background: 'var(--color-primary, #2563eb)', color: '#fff', borderRadius: '0.375rem', fontSize: '0.8rem', textDecoration: 'none', fontWeight: 600, minHeight: '32px', display: 'inline-flex', alignItems: 'center' }}>
            🗺
          </a>
        )}
      </div>
    </div>
  )
}

type Props = NearbyPanelState & {
  onClose: () => void
  onSelectContact?: (contact: NearbyContact) => void
}

export function NearbyContactsPanel({ contactoNombre, mapsUrl, zip, ciudad, baseId, baseTipo, onClose, onSelectContact }: Props) {
  const [nearbyData, setNearbyData] = useState<{ byZip: NearbyContact[]; byCity: NearbyContact[] } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setNearbyData(null)
    const nZip = zip?.trim() || null
    const nCity = ciudad?.trim().toLowerCase() || null
    if (!nZip && !nCity) {
      setNearbyData({ byZip: [], byCity: [] })
      setLoading(false)
      return
    }
    type RawRow = { id: string; nombre: string | null; apellido: string | null; telefono: string | null; direccion: string | null; ciudad: string | null; estado_region: string | null; codigo_postal: string | null }
    const isBase = (id: string, tipo: 'cliente' | 'lead') =>
      Boolean(baseId && baseTipo && id === baseId && tipo === baseTipo)
    const toContact = (row: RawRow, tipo: 'cliente' | 'lead'): NearbyContact => ({
      id: row.id,
      tipo,
      nombre: [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || 'Sin nombre',
      telefono: row.telefono ?? null,
      direccion: row.direccion ?? null,
      ciudad: row.ciudad ?? null,
      estado_region: row.estado_region ?? null,
      zip: row.codigo_postal ?? null,
    })
    const sel = 'id, nombre, apellido, telefono, direccion, ciudad, estado_region, codigo_postal'
    void Promise.all([
      nZip ? supabase.from('clientes').select(sel).eq('codigo_postal', nZip).limit(25) : Promise.resolve({ data: [] as RawRow[], error: null }),
      nCity ? supabase.from('clientes').select(sel).ilike('ciudad', nCity).limit(25) : Promise.resolve({ data: [] as RawRow[], error: null }),
      nZip ? supabase.from('leads').select(sel).eq('codigo_postal', nZip).is('deleted_at', null).limit(15) : Promise.resolve({ data: [] as RawRow[], error: null }),
      nCity ? supabase.from('leads').select(sel).ilike('ciudad', nCity).is('deleted_at', null).limit(15) : Promise.resolve({ data: [] as RawRow[], error: null }),
    ]).then(([zipC, cityC, zipL, cityL]) => {
      const seen = new Set<string>()
      const byZip: NearbyContact[] = []
      for (const row of ((zipC.data ?? []) as RawRow[])) {
        if (isBase(row.id, 'cliente')) continue
        const key = `c-${row.id}`; seen.add(key); byZip.push(toContact(row, 'cliente'))
      }
      for (const row of ((zipL.data ?? []) as RawRow[])) {
        if (isBase(row.id, 'lead')) continue
        const key = `l-${row.id}`; seen.add(key); byZip.push(toContact(row, 'lead'))
      }
      const byCity: NearbyContact[] = []
      for (const row of ((cityC.data ?? []) as RawRow[])) {
        if (isBase(row.id, 'cliente')) continue
        const key = `c-${row.id}`; if (seen.has(key)) continue; seen.add(key); byCity.push(toContact(row, 'cliente'))
      }
      for (const row of ((cityL.data ?? []) as RawRow[])) {
        if (isBase(row.id, 'lead')) continue
        const key = `l-${row.id}`; if (seen.has(key)) continue; seen.add(key); byCity.push(toContact(row, 'lead'))
      }
      setNearbyData({ byZip, byCity })
      setLoading(false)
    })
  }, [zip, ciudad, baseId, baseTipo])

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: '540px',
          maxHeight: '80vh',
          overflowY: 'auto',
          background: 'var(--color-surface, #fff)',
          borderRadius: '1rem 1rem 0 0',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
          zIndex: 1001,
          padding: '1.25rem',
          display: 'grid',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '1rem', color: '#111827' }}>Cercanos · {contactoNombre}</strong>
          <Button variant="ghost" onClick={onClose}>✕</Button>
        </div>

        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'block', padding: '0.75rem 1rem', background: 'var(--color-primary, #2563eb)', color: '#fff', borderRadius: '0.5rem', textAlign: 'center', textDecoration: 'none', fontWeight: 600 }}
          >
            🗺 Abrir en Maps
          </a>
        ) : (
          <div style={{ color: '#4b5563', fontSize: '0.875rem' }}>
            No hay dirección disponible para navegar.
          </div>
        )}

        {loading && (
          <div style={{ color: '#4b5563', fontSize: '0.875rem' }}>
            Buscando contactos cercanos...
          </div>
        )}

        {!loading && nearbyData && !zip && !ciudad && (
          <div style={{ color: '#4b5563', fontSize: '0.875rem' }}>
            No hay suficientes datos de ubicación para sugerir contactos cercanos.
          </div>
        )}

        {!loading && nearbyData && (zip || ciudad) && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {nearbyData.byZip.length > 0 && (
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
                  CERCANOS POR ZIP CODE · {zip}
                </div>
                <div style={{ display: 'grid', gap: '0.4rem' }}>
                  {nearbyData.byZip.map(c => <NearbyRow key={`${c.tipo}-${c.id}`} contact={c} onSelectContact={onSelectContact} />)}
                </div>
              </div>
            )}
            {nearbyData.byCity.length > 0 && (
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
                  CERCANOS POR CIUDAD · {ciudad}
                </div>
                <div style={{ display: 'grid', gap: '0.4rem' }}>
                  {nearbyData.byCity.map(c => <NearbyRow key={`${c.tipo}-${c.id}`} contact={c} onSelectContact={onSelectContact} />)}
                </div>
              </div>
            )}
            {nearbyData.byZip.length === 0 && nearbyData.byCity.length === 0 && (
              <div style={{ color: '#4b5563', fontSize: '0.875rem' }}>
                No se encontraron contactos con el mismo ZIP o ciudad.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
