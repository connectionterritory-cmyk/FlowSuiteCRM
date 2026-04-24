import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SectionHeader } from '../../components/SectionHeader'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { useToast } from '../../components/useToast'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'
import { useUsers } from '../../data/useUsers'

type PipelineStage = 'nuevo' | 'contacto' | 'demo_agendada' | 'cerrado_ganado' | 'cerrado_perdido'

const PIPELINE_STAGES: { value: PipelineStage; label: string }[] = [
  { value: 'nuevo',          label: 'Nuevo lead' },
  { value: 'contacto',       label: 'Contacto' },
  { value: 'demo_agendada',  label: 'Demo agendada' },
  { value: 'cerrado_ganado', label: 'Cerrado ganado' },
  { value: 'cerrado_perdido',label: 'Cerrado perdido' },
]

const AVAILABLE_TAGS = ['interesado', 'cliente', 'seguimiento', 'reclutamiento'] as const

type ConversationRow = {
  id: string
  org_id: string | null
  canal: string
  contact_tipo: 'cliente' | 'lead' | 'embajador' | null
  contact_id: string | null
  phone_e164: string
  status: 'open' | 'pending' | 'closed' | 'archived'
  last_message_at: string | null
  last_message_preview: string | null
  unread_count: number | null
  wa_id: string | null
  pipeline_stage: PipelineStage | null
  tags: string[] | null
  assigned_to: string | null
  last_message_direction: 'inbound' | 'outbound' | null
  follow_up_count: number | null
}

type InboxTask = {
  id: string
  conversation_id: string
  titulo: string
  notas: string | null
  due_at: string | null
  status: 'open' | 'done' | 'cancelled'
  assigned_to: string | null
  created_at: string
}

type MessageRow = {
  id: string
  conversation_id: string
  direction: 'inbound' | 'outbound'
  message: string | null
  provider_message_id: string | null
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received'
  error_message: string | null
  created_at: string
  delivered_at: string | null
  read_at: string | null
  attachment_urls: string[] | null
}

type ContactNameMap = Record<string, string>

type PendingMessage = {
  id: string
  message: string
  created_at: string
  status: 'queued'
  attachment_urls: string[]
}

const REFRESH_MS = 15000
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/aac',
  'audio/mp4',
  'video/mp4',
  'video/quicktime',
  'video/webm',
])

function formatRelativeOrTime(input: string | null) {
  if (!input) return '-'
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return '-'

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'Ahora'
  if (diffMin < 60) return `Hace ${diffMin}m`

  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate()

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return date.toLocaleDateString()
}

function buildContactKey(tipo: ConversationRow['contact_tipo'], id: string | null) {
  if (!tipo || !id) return null
  return `${tipo}:${id}`
}

function statusLabel(status: MessageRow['status'] | PendingMessage['status']) {
  if (status === 'queued') return 'En cola'
  if (status === 'sent') return 'Enviado'
  if (status === 'delivered') return 'Entregado'
  if (status === 'read') return 'Leído'
  if (status === 'failed') return 'Fallido'
  return 'Recibido'
}

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url)
}

function fileNameFromUrl(url: string) {
  const clean = url.split('?')[0] ?? url
  const parts = clean.split('/')
  return parts[parts.length - 1] || 'archivo'
}

function buildStoragePath(orgId: string | null, fileName: string) {
  const ext = fileName.includes('.') ? fileName.split('.').pop() : ''
  const normalizedExt = ext ? `.${ext.toLowerCase()}` : ''
  const orgSegment = orgId ? String(orgId) : 'sin-org'
  return `inbox/${orgSegment}/${crypto.randomUUID()}${normalizedExt}`
}

function isMimeAllowed(file: File) {
  if (ALLOWED_MIME_TYPES.has(file.type)) return true

  // fallback por extensión cuando el navegador no envía MIME consistente
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.jpg')
    || name.endsWith('.jpeg')
    || name.endsWith('.png')
    || name.endsWith('.webp')
    || name.endsWith('.gif')
    || name.endsWith('.pdf')
    || name.endsWith('.doc')
    || name.endsWith('.docx')
    || name.endsWith('.mp3')
    || name.endsWith('.wav')
    || name.endsWith('.ogg')
    || name.endsWith('.aac')
    || name.endsWith('.m4a')
    || name.endsWith('.mp4')
    || name.endsWith('.mov')
    || name.endsWith('.webm')
  )
}

export function InboxPage() {
  const { session } = useAuth()
  const { currentUser } = useUsers()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(false)
  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [contactNames, setContactNames] = useState<ContactNameMap>({})
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [pendingOutbound, setPendingOutbound] = useState<PendingMessage[]>([])
  const [messageInput, setMessageInput] = useState('')
  const [sending, setSending] = useState(false)
  const [attachments, setAttachments] = useState<string[]>([])
  const [uploadingAttachments, setUploadingAttachments] = useState(false)

  // sales panel
  const [tasks, setTasks] = useState<InboxTask[]>([])
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDue, setNewTaskDue] = useState('')
  const [addingTask, setAddingTask] = useState(false)
  const [showTaskForm, setShowTaskForm] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)

  const configured = isSupabaseConfigured
  const orgId = currentUser?.org_id ?? null

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  )

  const mergeContactNames = useCallback(async (rows: ConversationRow[]) => {
    const clienteIds = Array.from(new Set(rows.filter((c) => c.contact_tipo === 'cliente' && c.contact_id).map((c) => c.contact_id as string)))
    const leadIds = Array.from(new Set(rows.filter((c) => c.contact_tipo === 'lead' && c.contact_id).map((c) => c.contact_id as string)))

    const next: ContactNameMap = {}

    if (clienteIds.length > 0) {
      const { data } = await supabase
        .from('clientes')
        .select('id, nombre, apellido')
        .in('id', clienteIds)

      ;((data as Array<{ id: string; nombre: string | null; apellido: string | null }> | null) ?? []).forEach((row) => {
        next[`cliente:${row.id}`] = [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || 'Cliente'
      })
    }

    if (leadIds.length > 0) {
      const { data } = await supabase
        .from('leads')
        .select('id, nombre, apellido')
        .in('id', leadIds)

      ;((data as Array<{ id: string; nombre: string | null; apellido: string | null }> | null) ?? []).forEach((row) => {
        next[`lead:${row.id}`] = [row.nombre, row.apellido].filter(Boolean).join(' ').trim() || 'Lead'
      })
    }

    setContactNames(next)
  }, [])

  const loadConversations = useCallback(async () => {
    if (!configured || !session?.user?.id) return

    setLoading(true)
    let query = supabase
      .from('conversations')
      .select('id, org_id, canal, contact_tipo, contact_id, phone_e164, status, last_message_at, last_message_preview, unread_count, wa_id, pipeline_stage, tags, assigned_to, last_message_direction, follow_up_count')
      .eq('canal', 'whatsapp')
      .order('last_message_at', { ascending: false })
      .limit(200)

    if (orgId) {
      query = query.eq('org_id', orgId)
    }

    const { data, error } = await query

    if (error) {
      setLoading(false)
      showToast(`Error cargando conversaciones: ${error.message}`, 'error')
      return
    }

    const rows = (data as ConversationRow[] | null) ?? []
    setConversations(rows)
    await mergeContactNames(rows)

    setActiveConversationId((prev) => {
      if (prev && rows.some((row) => row.id === prev)) return prev
      return rows[0]?.id ?? null
    })

    setLoading(false)
  }, [configured, mergeContactNames, orgId, session?.user?.id, showToast])

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!configured || !conversationId) return

    const { data, error } = await supabase
      .from('messages')
      .select('id, conversation_id, direction, message, provider_message_id, status, error_message, created_at, delivered_at, read_at, attachment_urls')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(1000)

    if (error) {
      showToast(`Error cargando mensajes: ${error.message}`, 'error')
      return
    }

    setMessages((data as MessageRow[] | null) ?? [])
    setPendingOutbound([])
  }, [configured, showToast])

  const markConversationRead = useCallback(async (conversationId: string) => {
    const { error } = await supabase
      .from('conversations')
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
      .eq('id', conversationId)

    if (!error) {
      setConversations((prev) => prev.map((row) => (row.id === conversationId ? { ...row, unread_count: 0 } : row)))
    }
  }, [])

  const loadTasks = useCallback(async (conversationId: string) => {
    const { data, error } = await supabase
      .from('inbox_tasks')
      .select('id, conversation_id, titulo, notas, due_at, status, assigned_to, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    if (!error) setTasks((data as InboxTask[] | null) ?? [])
  }, [])

  const savePipelineStage = useCallback(async (conversationId: string, stage: PipelineStage) => {
    const { error } = await supabase
      .from('conversations')
      .update({ pipeline_stage: stage, updated_at: new Date().toISOString() })
      .eq('id', conversationId)

    if (!error) {
      setConversations((prev) =>
        prev.map((row) => (row.id === conversationId ? { ...row, pipeline_stage: stage } : row)),
      )
    } else {
      showToast(`Error guardando pipeline: ${error.message}`, 'error')
    }
  }, [showToast])

  const toggleTag = useCallback(async (conversationId: string, currentTags: string[] | null, tag: string) => {
    const current = currentTags ?? []
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]

    const { error } = await supabase
      .from('conversations')
      .update({ tags: next, updated_at: new Date().toISOString() })
      .eq('id', conversationId)

    if (!error) {
      setConversations((prev) =>
        prev.map((row) => (row.id === conversationId ? { ...row, tags: next } : row)),
      )
    } else {
      showToast(`Error guardando etiqueta: ${error.message}`, 'error')
    }
  }, [showToast])

  const addTask = useCallback(async () => {
    if (!activeConversation || !newTaskTitle.trim() || addingTask) return

    setAddingTask(true)
    const { data, error } = await supabase
      .from('inbox_tasks')
      .insert({
        org_id: orgId ?? activeConversation.org_id ?? '',
        conversation_id: activeConversation.id,
        contact_id: activeConversation.contact_id,
        contact_tipo: activeConversation.contact_tipo,
        assigned_to: session?.user.id ?? null,
        titulo: newTaskTitle.trim(),
        due_at: newTaskDue || null,
        status: 'open',
      })
      .select('id, conversation_id, titulo, notas, due_at, status, assigned_to, created_at')
      .single()

    setAddingTask(false)

    if (error) {
      showToast(`Error creando tarea: ${error.message}`, 'error')
      return
    }

    setTasks((prev) => [...prev, data as InboxTask])
    setNewTaskTitle('')
    setNewTaskDue('')
    setShowTaskForm(false)
  }, [activeConversation, addingTask, newTaskDue, newTaskTitle, orgId, session?.user.id, showToast])

  const completeTask = useCallback(async (taskId: string) => {
    const { error } = await supabase
      .from('inbox_tasks')
      .update({ status: 'done', completado_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', taskId)

    if (!error) {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'done' as const } : t)))
    } else {
      showToast(`Error: ${error.message}`, 'error')
    }
  }, [showToast])

  const refreshActiveConversation = useCallback(async () => {
    if (!activeConversationId) return
    await loadMessages(activeConversationId)
  }, [activeConversationId, loadMessages])

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([])
      setPendingOutbound([])
      setAttachments([])
      setTasks([])
      setShowTaskForm(false)
      return
    }

    void loadMessages(activeConversationId)
    void markConversationRead(activeConversationId)
    void loadTasks(activeConversationId)
  }, [activeConversationId, loadMessages, loadTasks, markConversationRead])

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadConversations()
      void refreshActiveConversation()
    }, REFRESH_MS)

    return () => window.clearInterval(id)
  }, [loadConversations, refreshActiveConversation])

  useEffect(() => {
    if (!configured) return

    const convChannel = supabase
      .channel('inbox-conversations-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        void loadConversations()
      })
      .subscribe()

    const msgChannel = supabase
      .channel('inbox-messages-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        const row = payload.new as Partial<MessageRow>
        if (activeConversationId && row?.conversation_id === activeConversationId) {
          void refreshActiveConversation()
        }
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(convChannel)
      void supabase.removeChannel(msgChannel)
    }
  }, [activeConversationId, configured, loadConversations, refreshActiveConversation])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, pendingOutbound, activeConversationId])

  const displayedMessages = useMemo(() => {
    const pendingAsRows: MessageRow[] = pendingOutbound.map((pending) => ({
      id: pending.id,
      conversation_id: activeConversationId ?? '',
      direction: 'outbound',
      message: pending.message,
      provider_message_id: null,
      status: pending.status,
      error_message: null,
      created_at: pending.created_at,
      delivered_at: null,
      read_at: null,
      attachment_urls: pending.attachment_urls,
    }))

    return [...messages, ...pendingAsRows].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
  }, [activeConversationId, messages, pendingOutbound])

  const activeContactLabel = useMemo(() => {
    if (!activeConversation) return ''
    const key = buildContactKey(activeConversation.contact_tipo, activeConversation.contact_id)
    if (key && contactNames[key]) return contactNames[key]
    return activeConversation.phone_e164
  }, [activeConversation, contactNames])

  const handlePickFiles = useCallback(() => {
    attachmentInputRef.current?.click()
  }, [])

  const handleUploadAttachments = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return

    setUploadingAttachments(true)

    try {
      const uploadedUrls: string[] = []

      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          showToast(`Archivo demasiado grande: ${file.name} (máx 10MB)`, 'error')
          continue
        }

        if (!isMimeAllowed(file)) {
          showToast(`Tipo no permitido: ${file.name}`, 'error')
          continue
        }

        const path = buildStoragePath(orgId, file.name)

        const { error: uploadError } = await supabase.storage
          .from('messaging_attachments')
          .upload(path, file, { upsert: false })

        if (uploadError) {
          showToast(`Error subiendo ${file.name}: ${uploadError.message}`, 'error')
          continue
        }

        const { data } = supabase.storage.from('messaging_attachments').getPublicUrl(path)
        if (data?.publicUrl) {
          uploadedUrls.push(data.publicUrl)
        }
      }

      if (uploadedUrls.length > 0) {
        setAttachments((prev) => [...prev, ...uploadedUrls])
      }
    } finally {
      setUploadingAttachments(false)
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = ''
      }
    }
  }, [orgId, showToast])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const sendMessage = useCallback(async () => {
    if (!activeConversation || sending || uploadingAttachments) return

    const body = messageInput.trim()
    const attachmentsToSend = [...attachments]

    if (!body && attachmentsToSend.length === 0) return

    setSending(true)
    const optimisticId = `pending-${crypto.randomUUID()}`
    setPendingOutbound((prev) => [
      ...prev,
      {
        id: optimisticId,
        message: body,
        created_at: new Date().toISOString(),
        status: 'queued',
        attachment_urls: attachmentsToSend,
      },
    ])

    try {
      const { data, error } = await supabase
        .from('outbox_messages')
        .insert({
          owner_id: session?.user.id,
          org_id: currentUser?.organizacion ?? null,
          contact_tipo: activeConversation.contact_tipo,
          contact_id: activeConversation.contact_id,
          contexto_tipo: 'seguimiento',
          canal: 'whatsapp',
          destinatario: activeConversation.phone_e164,
          asunto: null,
          mensaje: body,
          mensaje_resuelto: body,
          attachment_urls: attachmentsToSend,
          status: 'programado',
          scheduled_for: new Date(Date.now() - 1000).toISOString(),
          sent_at: null,
          tipo_envio: 'text',
        })
        .select('id')
        .single()

      if (error) {
        throw error
      }

      setMessageInput('')
      setAttachments([])
      showToast('Mensaje enviado a cola', 'success')

      const { error: invokeError } = await supabase.functions.invoke('process-outbox')
      if (invokeError) {
        console.warn('process-outbox invoke warning:', invokeError.message)
      }

      setPendingOutbound((prev) => prev.filter((row) => row.id !== optimisticId))
      await loadConversations()
      await refreshActiveConversation()

      if (!data?.id) {
        console.warn('Outbox insert without id response')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo encolar el mensaje'
      setPendingOutbound((prev) => prev.filter((row) => row.id !== optimisticId))
      showToast(message, 'error')
    } finally {
      setSending(false)
    }
  }, [activeConversation, attachments, currentUser?.organizacion, loadConversations, messageInput, refreshActiveConversation, sending, session?.user.id, showToast, uploadingAttachments])

  return (
    <div>
      <SectionHeader
        title="Inbox WhatsApp"
        subtitle="Conversaciones en tiempo real con envío por cola (outbox)."
      />

      <div className="inbox-layout inbox-layout--three card">
        <aside className="inbox-sidebar">
          <div className="inbox-sidebar-header">
            <strong>Conversaciones</strong>
            <span>{conversations.length}</span>
          </div>

          {loading ? (
            <div className="inbox-empty">Cargando...</div>
          ) : conversations.length === 0 ? (
            <div className="inbox-empty">Sin conversaciones</div>
          ) : (
            <div className="inbox-conversation-list">
              {conversations.map((conversation) => {
                const key = buildContactKey(conversation.contact_tipo, conversation.contact_id)
                const name = (key ? contactNames[key] : null) || conversation.phone_e164
                const isActive = conversation.id === activeConversationId
                const unread = Math.max(0, Number(conversation.unread_count ?? 0))

                return (
                  <button
                    type="button"
                    key={conversation.id}
                    className={`inbox-conversation-item ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveConversationId(conversation.id)}
                  >
                    <div className="inbox-conversation-top">
                      <strong>{name}</strong>
                      <span>{formatRelativeOrTime(conversation.last_message_at)}</span>
                    </div>
                    <div className="inbox-conversation-bottom">
                      <span>{conversation.last_message_preview || 'Sin mensajes'}</span>
                      {unread > 0 && <em>{unread}</em>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </aside>

        <section className="inbox-chat">
          {!activeConversation ? (
            <EmptyState
              title="Selecciona una conversación"
              description="Elige una conversación en la barra lateral para ver mensajes."
            />
          ) : (
            <>
              <header className="inbox-chat-header">
                <div>
                  <h3>{activeContactLabel}</h3>
                  <p>{activeConversation.phone_e164}</p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void markConversationRead(activeConversation.id)
                  }}
                >
                  Marcar leído
                </Button>
              </header>

              <div className="inbox-chat-messages" ref={scrollRef}>
                {displayedMessages.length === 0 ? (
                  <div className="inbox-empty">No hay mensajes en esta conversación.</div>
                ) : (
                  displayedMessages.map((msg) => {
                    const inbound = msg.direction === 'inbound'
                    const attachmentUrls = msg.attachment_urls ?? []

                    return (
                      <article key={msg.id} className={`inbox-bubble-row ${inbound ? 'inbound' : 'outbound'}`}>
                        <div className={`inbox-bubble ${inbound ? 'inbound' : 'outbound'}`}>
                          {msg.message ? <p>{msg.message}</p> : null}

                          {attachmentUrls.length > 0 && (
                            <div className="inbox-attachments-list">
                              {attachmentUrls.map((url) => {
                                const isImage = isImageUrl(url)
                                return isImage ? (
                                  <a key={url} className="inbox-attachment-image" href={url} target="_blank" rel="noreferrer">
                                    <img src={url} alt="Adjunto" loading="lazy" />
                                  </a>
                                ) : (
                                  <a key={url} className="inbox-attachment-file" href={url} target="_blank" rel="noreferrer">
                                    <span>📎</span>
                                    <span>{fileNameFromUrl(url)}</span>
                                  </a>
                                )
                              })}
                            </div>
                          )}

                          <div className="inbox-bubble-meta">
                            <span>{formatRelativeOrTime(msg.created_at)}</span>
                            {!inbound && <span>{statusLabel(msg.status)}</span>}
                          </div>
                        </div>
                      </article>
                    )
                  })
                )}
              </div>

              <footer className="inbox-chat-input">
                <textarea
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="Escribe un mensaje..."
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void sendMessage()
                    }
                  }}
                />

                <input
                  ref={attachmentInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.mp3,.wav,.ogg,.aac,.m4a,.mp4,.mov,.webm"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    void handleUploadAttachments(e.target.files)
                  }}
                />

                <div className="inbox-composer-tools">
                  <Button variant="ghost" onClick={handlePickFiles} disabled={sending || uploadingAttachments}>
                    {uploadingAttachments ? 'Subiendo...' : 'Adjuntar'}
                  </Button>
                  <small>Máx. 10MB por archivo</small>
                </div>

                {attachments.length > 0 && (
                  <div className="inbox-preview-list">
                    {attachments.map((url, idx) => {
                      const image = isImageUrl(url)
                      return (
                        <div key={`${url}-${idx}`} className="inbox-preview-item">
                          {image ? (
                            <img src={url} alt="Preview" className="inbox-preview-thumb" />
                          ) : (
                            <div className="inbox-preview-doc">📄</div>
                          )}
                          <a href={url} target="_blank" rel="noreferrer" className="inbox-preview-name">
                            {fileNameFromUrl(url)}
                          </a>
                          <button
                            type="button"
                            className="inbox-preview-remove"
                            onClick={() => removeAttachment(idx)}
                            aria-label="Quitar adjunto"
                          >
                            ×
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="inbox-chat-actions">
                  <Button
                    onClick={() => void sendMessage()}
                    disabled={sending || uploadingAttachments || (messageInput.trim().length === 0 && attachments.length === 0)}
                  >
                    {sending ? 'Encolando...' : 'Enviar'}
                  </Button>
                </div>
              </footer>
            </>
          )}
        </section>

        {/* ── Sales panel ─────────────────────────────────────────── */}
        <aside className="inbox-detail">
          {!activeConversation ? (
            <div className="inbox-empty">Selecciona una conversación</div>
          ) : (
            <>
              {/* Pipeline */}
              <div className="inbox-detail-section">
                <p className="inbox-detail-label">Pipeline</p>
                <select
                  className="inbox-detail-select"
                  value={activeConversation.pipeline_stage ?? 'nuevo'}
                  onChange={(e) => void savePipelineStage(activeConversation.id, e.target.value as PipelineStage)}
                >
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              {/* Tags */}
              <div className="inbox-detail-section">
                <p className="inbox-detail-label">Etiquetas</p>
                <div className="inbox-tags-row">
                  {AVAILABLE_TAGS.map((tag) => {
                    const active = (activeConversation.tags ?? []).includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`inbox-tag${active ? ' active' : ''}`}
                        onClick={() => void toggleTag(activeConversation.id, activeConversation.tags, tag)}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Tasks */}
              <div className="inbox-detail-section">
                <div className="inbox-detail-section-header">
                  <p className="inbox-detail-label">Tareas</p>
                  <button
                    type="button"
                    className="inbox-detail-add-btn"
                    onClick={() => setShowTaskForm((v) => !v)}
                  >
                    {showTaskForm ? 'Cancelar' : '+ Nueva'}
                  </button>
                </div>

                {showTaskForm && (
                  <div className="inbox-task-form">
                    <input
                      className="inbox-task-input"
                      placeholder="Título de la tarea..."
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void addTask() }}
                    />
                    <input
                      className="inbox-task-input"
                      type="datetime-local"
                      value={newTaskDue}
                      onChange={(e) => setNewTaskDue(e.target.value)}
                    />
                    <button
                      type="button"
                      className="inbox-task-save-btn"
                      disabled={!newTaskTitle.trim() || addingTask}
                      onClick={() => void addTask()}
                    >
                      {addingTask ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                )}

                {tasks.length === 0 ? (
                  <p className="inbox-empty" style={{ padding: '0.6rem 0', fontSize: '0.82rem' }}>Sin tareas</p>
                ) : (
                  <div className="inbox-tasks-list">
                    {tasks.map((task) => (
                      <div key={task.id} className={`inbox-task-item${task.status === 'done' ? ' done' : ''}`}>
                        <input
                          type="checkbox"
                          checked={task.status === 'done'}
                          disabled={task.status === 'done'}
                          onChange={() => { if (task.status !== 'done') void completeTask(task.id) }}
                        />
                        <div className="inbox-task-body">
                          <span>{task.titulo}</span>
                          {task.due_at && (
                            <small>{formatRelativeOrTime(task.due_at)}</small>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Follow-up status */}
              {(activeConversation.follow_up_count ?? 0) > 0 && (
                <div className="inbox-detail-section">
                  <p className="inbox-detail-label">Follow-ups enviados</p>
                  <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>
                    {activeConversation.follow_up_count} / 3
                  </p>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
