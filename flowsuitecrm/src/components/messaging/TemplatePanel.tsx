import React, { useMemo, useState } from 'react'
import { useMessaging, type UnifiedTemplate } from './MessagingProvider'
import { Button } from '../Button'
import { 
  SearchIcon, 
  TrashIcon, 
  ShareIcon,
  PlusIcon
} from '../icons'

export function TemplatePanel() {
  const { 
    systemTemplates, 
    cloudTemplates, 
    setMessage, 
    setSubject,
    loadingTemplates,
    deleteTemplate,
    saveTemplate,
    activeChannel
  } = useMessaging()

  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'cloud' | 'system'>('cloud')
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newScope, setNewScope] = useState<'personal' | 'shared'>('personal')

  const unifiedCloudTemplates = useMemo<UnifiedTemplate[]>(() => {
    return cloudTemplates
      .filter(t => t.canal === activeChannel || t.canal === 'all')
      .map(t => ({
        id: t.id,
        label: t.nombre,
        message: t.cuerpo,
        subject: t.asunto,
        category: t.category,
        channel: t.canal === 'all' ? activeChannel : t.canal as any,
        source: 'cloud',
        raw: t
      }))
  }, [cloudTemplates, activeChannel])

  const filteredTemplates = useMemo(() => {
    const list = tab === 'cloud' ? unifiedCloudTemplates : systemTemplates
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter(t => 
      t.label.toLowerCase().includes(q) || 
      t.message.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    )
  }, [tab, unifiedCloudTemplates, systemTemplates, search])

  const handleSelect = (t: UnifiedTemplate) => {
    setMessage(t.message)
    if (t.subject) setSubject(t.subject)
  }

  const handleSave = async () => {
    if (!newTitle.trim()) return
    await saveTemplate(newTitle, 'general', newScope)
    setNewTitle('')
    setShowSaveForm(false)
  }

  // Estilos adaptados
  const panelStyle: React.CSSProperties = {
    width: '300px',
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid var(--color-border)',
    background: 'var(--color-surface, rgba(15,23,42,0.12))',
  }

  const tabContainerStyle: React.CSSProperties = {
    display: 'flex',
    padding: '0.25rem',
    background: 'var(--color-input)',
    margin: '0.75rem',
    borderRadius: '0.5rem',
    gap: '4px'
  }

  const tabButtonStyle = (isActive: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '0.4rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    borderRadius: '0.4rem',
    border: 'none',
    cursor: 'pointer',
    background: isActive ? 'var(--card-bg)' : 'transparent',
    color: isActive ? 'var(--accent)' : 'var(--text-muted)',
    boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
  })

  return (
    <div style={panelStyle}>
      {/* Tabs */}
      <div style={tabContainerStyle}>
        <button
          onClick={() => setTab('cloud')}
          style={tabButtonStyle(tab === 'cloud')}
        >
          Mis Plantillas
        </button>
        <button
          onClick={() => setTab('system')}
          style={tabButtonStyle(tab === 'system')}
        >
          Sistema
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '0 0.75rem 0.75rem' }}>
        <div style={{ position: 'relative' }}>
          <SearchIcon style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar..."
            style={{ 
                width: '100%', 
                padding: '0.5rem 0.5rem 0.5rem 2rem', 
                fontSize: '0.75rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border)',
                background: 'var(--card-bg)',
                color: 'var(--text-primary)',
                outline: 'none'
            }}
          />
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 0.75rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {loadingTemplates ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            <span style={{ fontSize: '0.75rem' }}>Cargando...</span>
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            No se encontraron plantillas
          </div>
        ) : (
          filteredTemplates.map((t) => (
            <div 
              key={t.id}
              onClick={() => handleSelect(t)}
              style={{
                padding: '0.75rem',
                borderRadius: '0.75rem',
                border: '1px solid var(--color-border)',
                background: 'var(--card-bg)',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)';
                e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.label}
                </span>
                {t.source === 'cloud' && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id); }}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}
                  >
                    <TrashIcon style={{ width: 12, height: 12 }} />
                  </button>
                )}
              </div>
              <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.4' }}>
                {t.message}
              </p>
              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.6rem', padding: '2px 6px', borderRadius: '10px', background: 'var(--color-surface-strong)', color: 'var(--text-muted)' }}>
                  {t.category}
                </span>
                {t.raw?.scope === 'shared' && (
                  <span style={{ fontSize: '0.6rem', color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '2px' }}>
                    <ShareIcon style={{ width: 10, height: 10 }} /> Equipo
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Save Template Footer */}
      <div style={{ padding: '0.75rem', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-strong)' }}>
        {!showSaveForm ? (
          <button
            onClick={() => setShowSaveForm(true)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '0.5rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--accent)',
              border: '1px dashed var(--accent)',
              borderRadius: '0.5rem',
              background: 'transparent',
              cursor: 'pointer'
            }}
          >
            <PlusIcon style={{ width: 14, height: 14 }} />
            Guardar como plantilla
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Título de la plantilla..."
              style={{
                width: '100%',
                padding: '0.5rem',
                fontSize: '0.75rem',
                borderRadius: '0.4rem',
                border: '1px solid var(--color-border)',
                background: 'var(--card-bg)',
                color: 'var(--text-primary)',
                outline: 'none'
              }}
              autoFocus
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.65rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={newScope === 'shared'}
                onChange={(e) => setNewScope(e.target.checked ? 'shared' : 'personal')}
              />
              Compartir con el equipo
            </label>
            <div style={{ display: 'flex', gap: '4px' }}>
              <Button style={{ flex: 1, fontSize: '0.7rem', height: '28px' }} onClick={handleSave}>Guardar</Button>
              <Button style={{ flex: 1, fontSize: '0.7rem', height: '28px' }} variant="ghost" onClick={() => setShowSaveForm(false)}>Cancelar</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
