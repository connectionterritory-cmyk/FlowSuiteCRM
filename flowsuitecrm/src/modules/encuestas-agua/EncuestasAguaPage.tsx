import { type ReactNode, useState, useCallback, useEffect, useMemo } from 'react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../../auth/useAuth'
import { useUsers } from '../../data/useUsers'
import { useToast } from '../../components/useToast'
import { SectionHeader } from '../../components/SectionHeader'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { CitaModal, type CitaForm } from '../citas/CitaModal'
import {
  IconDroplet,
  IconBottle,
  IconJug,
  IconSnowflake,
  IconWrench,
  IconMoreHorizontal,
  IconWind,
  IconPalette,
  IconFlask,
  IconLayers,
  IconHeart,
  IconBaby,
  IconCheck,
  IconFlame,
  IconCalendar,
  IconClock,
  IconX,
  IconHome,
  IconBuilding,
  IconStore,
  IconKey,
  IconFile,
  IconHelpCircle,
  IconUser,
  IconUsers,
  IconHandshake,
  IconSun,
  IconPhone,
  IconWhatsapp,
} from '../../components/icons'

// ─── Types ────────────────────────────────────────────────────────────────────

type WaterSurvey = {
  id: string
  created_by: string | null
  assigned_to: string | null
  nombre: string | null
  telefono: string | null
  direccion: string | null
  idioma_preferido: string | null
  tipo_vivienda: string | null
  propiedad: string | null
  personas_hogar: string | null
  hay_ninos: boolean | null
  decisor: string | null
  decisor_presente: boolean | null
  fuente_agua: string | null
  preocupaciones: string[] | null
  gasto_mensual_agua: string | null
  interes_revision: string | null
  notas: string | null
  score: number
  temperatura: 'frio' | 'tibio' | 'caliente' | null
  status: string
  lead_id: string | null
  created_at: string | null
  updated_at: string | null
}

function normalizePhoneDigits(phone: string): string | null {
  let digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  return digits.length === 10 ? digits : null
}

type SurveyForm = {
  nombre: string
  telefono: string
  direccion: string
  idioma_preferido: string
  tipo_vivienda: string
  propiedad: string
  personas_hogar: string
  hay_ninos: boolean | null
  decisor: string
  decisor_presente: boolean | null
  fuente_agua: string
  preocupaciones: string[]
  gasto_mensual_agua: string
  interes_revision: string
  notas: string
}

const EMPTY_FORM: SurveyForm = {
  nombre: '',
  telefono: '',
  direccion: '',
  idioma_preferido: '',
  tipo_vivienda: '',
  propiedad: '',
  personas_hogar: '',
  hay_ninos: null,
  decisor: '',
  decisor_presente: null,
  fuente_agua: '',
  preocupaciones: [],
  gasto_mensual_agua: '',
  interes_revision: '',
  notas: '',
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function calcScore(f: SurveyForm): number {
  let s = 0
  if (f.fuente_agua === 'botellitas' || f.fuente_agua === 'botellon') s += 3
  if (f.gasto_mensual_agua === '40_80') s += 2
  if (f.gasto_mensual_agua === '80_120' || f.gasto_mensual_agua === '120_plus') s += 3
  if (f.hay_ninos === true) s += 2
  if (f.preocupaciones.some((p) => ['sabor', 'olor', 'cloro', 'salud', 'ninos'].includes(p))) s += 2
  if (f.interes_revision === 'hoy') s += 3
  if (f.interes_revision === 'otro_dia') s += 2
  if (f.decisor_presente === true) s += 2
  if (f.propiedad === 'dueno') s += 2
  return s
}

function calcTemperatura(score: number): 'frio' | 'tibio' | 'caliente' {
  if (score >= 9) return 'caliente'
  if (score >= 5) return 'tibio'
  return 'frio'
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TEMP_COLOR: Record<string, string> = {
  frio: '#3b82f6',
  tibio: '#f59e0b',
  caliente: '#ef4444',
}
const TEMP_ICON: Record<string, ReactNode> = {
  frio: <IconSnowflake width={16} height={16} />,
  tibio: <IconSun width={16} height={16} />,
  caliente: <IconFlame width={16} height={16} />,
}
const TEMP_LABEL: Record<string, string> = {
  frio: 'Frío',
  tibio: 'Tibio',
  caliente: 'Caliente',
}

const FUENTE_OPTS = [
  { value: 'llave',            label: 'Grifo/llave',    icon: <IconDroplet width={18} height={18} /> },
  { value: 'botellitas',       label: 'Botellas',       icon: <IconBottle width={18} height={18} /> },
  { value: 'botellon',        label: 'Botellón',        icon: <IconJug width={18} height={18} /> },
  { value: 'filtro_nevera',   label: 'Filtro nevera',   icon: <IconSnowflake width={18} height={18} /> },
  { value: 'filtro_instalado',label: 'Filtro instalado',icon: <IconWrench width={18} height={18} /> },
  { value: 'otro',            label: 'Otro',            icon: <IconMoreHorizontal width={18} height={18} /> },
]

const PREOCUPACIONES_OPTS = [
  { value: 'sabor',  label: 'Sabor',  icon: <IconDroplet width={18} height={18} /> },
  { value: 'olor',   label: 'Olor',   icon: <IconWind width={18} height={18} /> },
  { value: 'color',  label: 'Color',  icon: <IconPalette width={18} height={18} /> },
  { value: 'cloro',  label: 'Cloro',  icon: <IconFlask width={18} height={18} /> },
  { value: 'sarro',  label: 'Sarro',  icon: <IconLayers width={18} height={18} /> },
  { value: 'salud',  label: 'Salud',  icon: <IconHeart width={18} height={18} /> },
  { value: 'ninos',  label: 'Niños',  icon: <IconBaby width={18} height={18} /> },
  { value: 'ninguna',label: 'Ninguna',icon: <IconCheck width={18} height={18} /> },
]

const GASTO_OPTS = [
  { value: '0',       label: '$0' },
  { value: '20_40',   label: '$20–40' },
  { value: '40_80',   label: '$40–80' },
  { value: '80_120',  label: '$80–120' },
  { value: '120_plus',label: '$120+' },
]

const PERSONAS_OPTS = [
  { value: '1_2',   label: '1–2' },
  { value: '3_4',   label: '3–4' },
  { value: '5_plus',label: '5+' },
]

const INTERES_OPTS = [
  { value: 'hoy',      label: 'Hoy mismo',   icon: <IconFlame width={18} height={18} /> },
  { value: 'otro_dia', label: 'Otro día',    icon: <IconCalendar width={18} height={18} /> },
  { value: 'tal_vez',  label: 'Tal vez',     icon: <IconClock width={18} height={18} /> },
  { value: 'no',       label: 'No interesa', icon: <IconX width={18} height={18} /> },
]

const DECISOR_LABEL: Record<string, string> = {
  yo: 'Yo',
  pareja: 'Mi pareja',
  ambos: 'Ambos',
  otro: 'Otro',
}

// ─── Notas para la cita demo ────────────────────────────────────────────────
// Solo incluye lo que la encuesta realmente capturó — nunca inventa datos.

function buildDemoNotas(survey: WaterSurvey): string {
  const lines: string[] = ['Encuesta de agua:']

  const fuenteLabel = FUENTE_OPTS.find((o) => o.value === survey.fuente_agua)?.label
  if (fuenteLabel) lines.push(`- Fuente actual: ${fuenteLabel}`)

  const gastoLabel = GASTO_OPTS.find((o) => o.value === survey.gasto_mensual_agua)?.label
  if (gastoLabel) lines.push(`- Gasto mensual: ${gastoLabel}`)

  if (survey.preocupaciones && survey.preocupaciones.length > 0) {
    const labels = survey.preocupaciones
      .map((p) => PREOCUPACIONES_OPTS.find((o) => o.value === p)?.label ?? p)
      .join(', ')
    lines.push(`- Preocupaciones: ${labels}`)
  }

  const personasLabel = PERSONAS_OPTS.find((o) => o.value === survey.personas_hogar)?.label
  if (personasLabel) lines.push(`- Personas en casa: ${personasLabel}`)

  if (survey.hay_ninos !== null) lines.push(`- Niños en casa: ${survey.hay_ninos ? 'Sí' : 'No'}`)

  const decisorLabel = survey.decisor ? (DECISOR_LABEL[survey.decisor] ?? survey.decisor) : null
  if (decisorLabel) lines.push(`- Decisor: ${decisorLabel}`)

  if (survey.decisor_presente !== null) lines.push(`- Decisor presente: ${survey.decisor_presente ? 'Sí' : 'No'}`)

  const interesLabel = INTERES_OPTS.find((o) => o.value === survey.interes_revision)?.label
  if (interesLabel) lines.push(`- Interés revisión: ${interesLabel}`)

  lines.push(`- Score: ${survey.score}`)
  lines.push(`- Temperatura: ${TEMP_LABEL[survey.temperatura ?? 'frio']}`)

  if (survey.notas && survey.notas.trim()) lines.push(`- Notas encuesta: ${survey.notas.trim()}`)

  return lines.join('\n')
}

// ─── ChipBtn ─────────────────────────────────────────────────────────────────

function ChipBtn({
  label,
  icon,
  selected,
  onClick,
}: {
  label: string
  icon?: ReactNode
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        padding: '10px 8px',
        minHeight: '48px',
        borderRadius: '8px',
        border: selected ? '2px solid #2563eb' : '2px solid #cbd5e1',
        background: selected ? '#eff6ff' : '#fff',
        color: selected ? '#1d4ed8' : '#1e293b',
        fontWeight: selected ? 600 : 500,
        fontSize: '0.875rem',
        cursor: 'pointer',
        textAlign: 'center',
        transition: 'border-color 0.1s, background 0.1s',
        lineHeight: 1.3,
      }}
    >
      {icon}
      {label}
    </button>
  )
}

// ─── ScoreBadge ───────────────────────────────────────────────────────────────

function ScoreBadge({ score, temp, size = 'sm' }: { score: number; temp: string; size?: 'sm' | 'lg' }) {
  const color = TEMP_COLOR[temp] ?? TEMP_COLOR.frio
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: size === 'lg' ? '2.5rem' : '1.25rem', fontWeight: 800, color, lineHeight: 1 }}>
        {score}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: size === 'lg' ? '1rem' : '0.7rem', fontWeight: 600, color, whiteSpace: 'nowrap' }}>
        {TEMP_ICON[temp]}
        {TEMP_LABEL[temp] ?? temp}
      </div>
    </div>
  )
}

// ─── SurveyCard ───────────────────────────────────────────────────────────────

function SurveyCard({
  survey,
  onCall,
  onWhatsApp,
  onLinkLead,
  onAgendarDemo,
  linking,
}: {
  survey: WaterSurvey
  onCall: (phone: string | null) => void
  onWhatsApp: (phone: string | null) => void
  onLinkLead: (survey: WaterSurvey) => void
  onAgendarDemo: (survey: WaterSurvey) => void
  linking: boolean
}) {
  const temp = survey.temperatura ?? 'frio'
  const fuente = FUENTE_OPTS.find((o) => o.value === survey.fuente_agua)?.label ?? survey.fuente_agua ?? '—'
  const gasto  = GASTO_OPTS.find((o) => o.value === survey.gasto_mensual_agua)?.label ?? survey.gasto_mensual_agua ?? '—'
  const interes = INTERES_OPTS.find((o) => o.value === survey.interes_revision)?.label ?? survey.interes_revision ?? '—'

  return (
    <div className="seller-lead" style={{ borderLeft: `4px solid ${TEMP_COLOR[temp]}` }}>
      <div className="seller-lead-main">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="seller-lead-name">{survey.nombre ?? '—'}</div>
          <div className="seller-lead-meta">
            <span>{survey.telefono ?? '—'}</span>
            {survey.direccion && <><span>·</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{survey.direccion}</span></>}
          </div>
          <div className="seller-lead-meta" style={{ marginTop: '2px', gap: '6px' }}>
            <span>{fuente}</span>
            <span>·</span>
            <span>{gasto}</span>
            <span>·</span>
            <span>{interes}</span>
          </div>
        </div>
        <div style={{ flexShrink: 0, paddingLeft: '8px' }}>
          <ScoreBadge score={survey.score} temp={temp} />
        </div>
      </div>
      <div className="seller-lead-actions">
        <button
          className="seller-chip"
          onClick={() => onCall(survey.telefono)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}
        >
          <IconPhone width={14} height={14} /> Llamar
        </button>
        <button
          className="seller-chip"
          onClick={() => onWhatsApp(survey.telefono)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}
        >
          <IconWhatsapp width={14} height={14} /> WhatsApp
        </button>
        {temp !== 'frio' && (
          survey.lead_id ? (
            <>
              <span
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#16a34a', fontWeight: 600 }}
              >
                <IconCheck width={14} height={14} /> Lead conectado
              </span>
              <button
                className="seller-chip"
                onClick={() => onAgendarDemo(survey)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}
              >
                <IconCalendar width={14} height={14} /> Agendar demo
              </button>
            </>
          ) : (
            <button
              className="seller-chip"
              onClick={() => onLinkLead(survey)}
              disabled={linking}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}
            >
              <IconUser width={14} height={14} /> {linking ? 'Enlazando…' : 'Crear/enlazar lead'}
            </button>
          )
        )}
      </div>
    </div>
  )
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginBottom: '20px' }}>
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <div
          key={n}
          style={{
            width: n === current ? '24px' : '8px',
            height: '8px',
            borderRadius: '4px',
            background: n <= current ? '#2563eb' : '#e2e8f0',
            transition: 'all 0.2s',
          }}
        />
      ))}
    </div>
  )
}

// ─── Grid helper ──────────────────────────────────────────────────────────────

function ChipGrid({
  cols = 2,
  children,
}: {
  cols?: number
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: '8px',
        marginTop: '6px',
      }}
    >
      {children}
    </div>
  )
}

// ─── Live score preview ───────────────────────────────────────────────────────

function LiveScore({ score }: { score: number }) {
  const temp = calcTemperatura(score)
  const color = TEMP_COLOR[temp]
  return (
    <div
      style={{
        padding: '12px',
        borderRadius: '10px',
        background: `${color}12`,
        border: `1px solid ${color}40`,
        textAlign: 'center',
        marginTop: '8px',
      }}
    >
      <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '2px' }}>Score actual</div>
      <div style={{ fontSize: '1.75rem', fontWeight: 800, color, lineHeight: 1 }}>{score}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '0.875rem', fontWeight: 600, color }}>
        {TEMP_ICON[temp]}
        {TEMP_LABEL[temp]}
      </div>
    </div>
  )
}

// ─── EncuestasAguaPage ────────────────────────────────────────────────────────

type TempFilter = 'all' | 'frio' | 'tibio' | 'caliente'

export function EncuestasAguaPage() {
  const { session } = useAuth()
  const { currentRole } = useUsers()
  const { showToast } = useToast()
  const configured = isSupabaseConfigured
  const userId = session?.user.id ?? null

  // List
  const [surveys, setSurveys]   = useState<WaterSurvey[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [tempFilter, setTempFilter] = useState<TempFilter>('all')

  // Form
  const [formOpen, setFormOpen]       = useState(false)
  const [step, setStep]               = useState(1)
  const [form, setForm]               = useState<SurveyForm>(EMPTY_FORM)
  const [formError, setFormError]     = useState<string | null>(null)
  const [submitting, setSubmitting]   = useState(false)
  const [savedResult, setSavedResult] = useState<WaterSurvey | null>(null)

  // Lead link + cita
  const [linkingId, setLinkingId]   = useState<string | null>(null)
  const [citaOpen, setCitaOpen]     = useState(false)
  const [citaInitial, setCitaInitial] = useState<Partial<CitaForm>>({})

  const liveScore = useMemo(() => calcScore(form), [form])
  const liveTemp  = useMemo(() => calcTemperatura(liveScore), [liveScore])

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadSurveys = useCallback(async () => {
    if (!configured || !userId) return
    setLoading(true)
    setError(null)
    const isAdmin = currentRole === 'admin' || currentRole === 'distribuidor'
    let q = supabase
      .from('water_surveys')
      .select('*')
      .order('created_at', { ascending: false })
    if (!isAdmin) q = q.eq('created_by', userId)
    const { data, error: fetchError } = await q
    if (fetchError) {
      setError(fetchError.message)
      setSurveys([])
    } else {
      setSurveys((data ?? []) as WaterSurvey[])
    }
    setLoading(false)
  }, [configured, userId, currentRole])

  useEffect(() => {
    if (!configured) return
    const t = window.setTimeout(() => void loadSurveys(), 0)
    return () => window.clearTimeout(t)
  }, [configured, loadSurveys])

  // ── Lead link ─────────────────────────────────────────────────────────────

  const findLeadByPhone = useCallback(async (telefono: string): Promise<string | null> => {
    const target = normalizePhoneDigits(telefono)
    if (!target) return null
    const { data, error: searchError } = await supabase
      .from('leads')
      .select('id, telefono')
      .is('deleted_at', null)
      .not('telefono', 'is', null)
    if (searchError || !data) return null
    const match = (data as { id: string; telefono: string | null }[]).find(
      (l) => normalizePhoneDigits(l.telefono ?? '') === target,
    )
    return match?.id ?? null
  }, [])

  const linkOrCreateLead = useCallback(async (survey: WaterSurvey) => {
    if (!userId) return
    const telefono = survey.telefono?.trim()
    if (!telefono) {
      showToast('La encuesta no tiene telefono; no se puede enlazar un lead.', 'error')
      return
    }
    setLinkingId(survey.id)
    try {
      let leadId = await findLeadByPhone(telefono)
      let created = false

      if (!leadId) {
        const { data: inserted, error: insertError } = await supabase
          .from('leads')
          .insert({
            nombre: survey.nombre,
            telefono,
            direccion: survey.direccion,
            tipo_vivienda: survey.tipo_vivienda,
            fuente: 'encuesta_agua',
            owner_id: userId,
            vendedor_id: userId,
            next_action: 'Agendar demo de agua',
            next_action_date: new Date().toISOString().slice(0, 10),
          })
          .select('id')
          .single()

        if (insertError) {
          if (insertError.code === '23505') {
            leadId = await findLeadByPhone(telefono)
            if (!leadId) throw insertError
          } else {
            throw insertError
          }
        } else {
          leadId = (inserted as { id: string }).id
          created = true
        }
      }

      const { error: updateError } = await supabase
        .from('water_surveys')
        .update({ lead_id: leadId })
        .eq('id', survey.id)
      if (updateError) throw updateError

      setSurveys((prev) => prev.map((s) => (s.id === survey.id ? { ...s, lead_id: leadId } : s)))
      setSavedResult((prev) => (prev && prev.id === survey.id ? { ...prev, lead_id: leadId } : prev))
      showToast(created ? 'Lead creado y enlazado' : 'Lead existente enlazado', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo enlazar el lead', 'error')
    } finally {
      setLinkingId(null)
    }
  }, [userId, showToast, findLeadByPhone])

  const handleAgendarDemo = useCallback((survey: WaterSurvey) => {
    if (!survey.lead_id || !userId) return
    const now = new Date()
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    setCitaInitial({
      owner_id: userId,
      start_at: local.toISOString().slice(0, 16),
      tipo: 'demo',
      estado: 'programada',
      assigned_to: userId,
      contacto_tipo: 'lead',
      contacto_id: survey.lead_id,
      contacto_nombre: survey.nombre ?? '',
      contacto_telefono: survey.telefono ?? '',
      direccion: survey.direccion ?? '',
      notas: buildDemoNotas(survey),
    })
    setCitaOpen(true)
  }, [userId])

  const handleCitaSaved = useCallback(() => {
    setCitaOpen(false)
    void loadSurveys()
  }, [loadSurveys])

  // ── Filtered list ─────────────────────────────────────────────────────────

  const filtered = useMemo(
    () => tempFilter === 'all' ? surveys : surveys.filter((s) => s.temperatura === tempFilter),
    [surveys, tempFilter],
  )

  const counts = useMemo(() => ({
    all:      surveys.length,
    caliente: surveys.filter((s) => s.temperatura === 'caliente').length,
    tibio:    surveys.filter((s) => s.temperatura === 'tibio').length,
    frio:     surveys.filter((s) => s.temperatura === 'frio').length,
  }), [surveys])

  // ── Form helpers ──────────────────────────────────────────────────────────

  function setField<K extends keyof SurveyForm>(key: K, value: SurveyForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function togglePreocupacion(val: string) {
    setForm((f) => {
      if (val === 'ninguna') return { ...f, preocupaciones: ['ninguna'] }
      const next = f.preocupaciones.filter((p) => p !== 'ninguna')
      return {
        ...f,
        preocupaciones: next.includes(val)
          ? next.filter((p) => p !== val)
          : [...next, val],
      }
    })
  }

  function openForm() {
    setForm(EMPTY_FORM)
    setStep(1)
    setFormError(null)
    setSavedResult(null)
    setFormOpen(true)
  }

  function closeForm() {
    const hadResult = savedResult !== null
    setFormOpen(false)
    setSavedResult(null)
    if (hadResult) void loadSurveys()
  }

  function validateStep(): string | null {
    if (step === 1) {
      if (!form.nombre.trim()) return 'El nombre es obligatorio'
      if (!form.telefono.trim()) return 'El teléfono es obligatorio'
    }
    return null
  }

  function nextStep() {
    const err = validateStep()
    if (err) { setFormError(err); return }
    setFormError(null)
    setStep((s) => s + 1)
  }

  async function handleSubmit() {
    const err = validateStep()
    if (err) { setFormError(err); return }
    if (!userId) return
    setSubmitting(true)
    setFormError(null)

    const finalScore = calcScore(form)
    const finalTemp  = calcTemperatura(finalScore)

    const payload = {
      created_by:         userId,
      assigned_to:        userId,
      nombre:             form.nombre.trim(),
      telefono:           form.telefono.trim(),
      direccion:          form.direccion.trim() || null,
      idioma_preferido:   form.idioma_preferido  || null,
      tipo_vivienda:      form.tipo_vivienda      || null,
      propiedad:          form.propiedad          || null,
      personas_hogar:     form.personas_hogar     || null,
      hay_ninos:          form.hay_ninos,
      decisor:            form.decisor            || null,
      decisor_presente:   form.decisor_presente,
      fuente_agua:        form.fuente_agua         || null,
      preocupaciones:     form.preocupaciones.length > 0 ? form.preocupaciones : null,
      gasto_mensual_agua: form.gasto_mensual_agua  || null,
      interes_revision:   form.interes_revision    || null,
      notas:              form.notas.trim()        || null,
      score:              finalScore,
      temperatura:        finalTemp,
      status:             'encuesta_completada',
    }

    const { data, error: insertError } = await supabase
      .from('water_surveys')
      .insert(payload)
      .select()
      .single()

    if (insertError) {
      setFormError(insertError.message)
    } else {
      setSavedResult(data as WaterSurvey)
      setStep(5)
    }
    setSubmitting(false)
  }

  // ── Quick actions ─────────────────────────────────────────────────────────

  function callPhone(phone: string | null) {
    if (phone) window.location.href = `tel:${phone}`
  }

  function openWhatsApp(phone: string | null) {
    if (!phone) return
    const n = phone.replace(/\D/g, '')
    window.open(`https://wa.me/${n}`, '_blank')
  }

  // ── Modal title ───────────────────────────────────────────────────────────

  const modalTitle =
    step === 5
      ? 'Encuesta guardada'
      : `Nueva encuesta — Paso ${step} de 4`

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page-stack">
      <SectionHeader
        title="Encuestas de Agua"
        subtitle={`${surveys.length} encuesta${surveys.length !== 1 ? 's' : ''} registrada${surveys.length !== 1 ? 's' : ''}`}
        action={<Button onClick={openForm}>+ Nueva encuesta</Button>}
      />

      {/* Filter chips */}
      <div className="seller-chips">
        {(['all', 'caliente', 'tibio', 'frio'] as TempFilter[]).map((t) => (
          <button
            key={t}
            className={`seller-chip${tempFilter === t ? ' active' : ''}`}
            onClick={() => setTempFilter(t)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            {t !== 'all' && TEMP_ICON[t]}
            {t === 'all' ? `Todos (${counts.all})` : `${TEMP_LABEL[t]} (${counts[t]})`}
          </button>
        ))}
      </div>

      {error && <div className="form-error">{error}</div>}

      {/* List */}
      {loading ? (
        <div className="seller-skeleton-grid">
          {[1, 2, 3].map((n) => (
            <div key={n} className="skeleton-card">
              <div className="skeleton-line wide" />
              <div className="skeleton-line" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-mini">
          <p>
            {tempFilter === 'all'
              ? 'Sin encuestas todavía.'
              : `Sin encuestas ${TEMP_LABEL[tempFilter]?.toLowerCase() ?? tempFilter}.`}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((s) => (
            <SurveyCard
              key={s.id}
              survey={s}
              onCall={callPhone}
              onWhatsApp={openWhatsApp}
              onLinkLead={linkOrCreateLead}
              onAgendarDemo={handleAgendarDemo}
              linking={linkingId === s.id}
            />
          ))}
        </div>
      )}

      {/* ── Form Modal ─────────────────────────────────────────────────────── */}
      <Modal
        open={formOpen}
        title={modalTitle}
        onClose={closeForm}
        actions={
          step === 5 ? (
            <Button onClick={closeForm}>Cerrar</Button>
          ) : (
            <>
              {step > 1 && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => { setFormError(null); setStep((s) => s - 1) }}
                >
                  ← Atrás
                </Button>
              )}
              {step < 4 ? (
                <Button type="button" onClick={nextStep}>
                  Siguiente →
                </Button>
              ) : (
                <Button type="button" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? 'Guardando…' : '✓ Guardar'}
                </Button>
              )}
            </>
          )
        }
      >
        <div style={{ paddingBottom: '4px' }}>

          {step < 5 && <StepDots current={step} total={4} />}

          {formError && (
            <div className="form-error" style={{ marginBottom: '12px' }}>
              {formError}
            </div>
          )}

          {/* ── Step 1: Contacto ───────────────────────────────────────── */}
          {step === 1 && (
            <div className="form-grid">
              <label className="form-field">
                <span>Nombre *</span>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={(e) => setField('nombre', e.target.value)}
                  placeholder="Nombre del prospecto"
                  style={{ fontSize: '16px' }}
                  autoFocus
                />
              </label>
              <label className="form-field">
                <span>Teléfono *</span>
                <input
                  type="tel"
                  value={form.telefono}
                  onChange={(e) => setField('telefono', e.target.value)}
                  placeholder="+1 (305) 555-0000"
                  style={{ fontSize: '16px' }}
                />
              </label>
              <label className="form-field">
                <span>Dirección</span>
                <input
                  type="text"
                  value={form.direccion}
                  onChange={(e) => setField('direccion', e.target.value)}
                  placeholder="Calle, ciudad"
                  style={{ fontSize: '16px' }}
                />
              </label>
              <div className="form-field">
                <span>Idioma preferido</span>
                <ChipGrid cols={2}>
                  <ChipBtn label="Español" selected={form.idioma_preferido === 'espanol'} onClick={() => setField('idioma_preferido', 'espanol')} />
                  <ChipBtn label="English" selected={form.idioma_preferido === 'ingles'}  onClick={() => setField('idioma_preferido', 'ingles')} />
                </ChipGrid>
              </div>
            </div>
          )}

          {/* ── Step 2: Hogar ──────────────────────────────────────────── */}
          {step === 2 && (
            <div className="form-grid">
              <div className="form-field">
                <span>Tipo de vivienda</span>
                <ChipGrid cols={3}>
                  <ChipBtn label="Casa"    icon={<IconHome width={18} height={18} />}     selected={form.tipo_vivienda === 'casa'}        onClick={() => setField('tipo_vivienda', 'casa')} />
                  <ChipBtn label="Apto"    icon={<IconBuilding width={18} height={18} />} selected={form.tipo_vivienda === 'apartamento'} onClick={() => setField('tipo_vivienda', 'apartamento')} />
                  <ChipBtn label="Negocio" icon={<IconStore width={18} height={18} />}    selected={form.tipo_vivienda === 'negocio'}     onClick={() => setField('tipo_vivienda', 'negocio')} />
                </ChipGrid>
              </div>
              <div className="form-field">
                <span>Propiedad</span>
                <ChipGrid cols={3}>
                  <ChipBtn label="Dueño" icon={<IconKey width={18} height={18} />}        selected={form.propiedad === 'dueno'}   onClick={() => setField('propiedad', 'dueno')} />
                  <ChipBtn label="Renta" icon={<IconFile width={18} height={18} />}       selected={form.propiedad === 'renta'}   onClick={() => setField('propiedad', 'renta')} />
                  <ChipBtn label="No sé" icon={<IconHelpCircle width={18} height={18} />} selected={form.propiedad === 'no_sabe'} onClick={() => setField('propiedad', 'no_sabe')} />
                </ChipGrid>
              </div>
              <div className="form-field">
                <span>Personas en el hogar</span>
                <ChipGrid cols={3}>
                  {PERSONAS_OPTS.map((o) => (
                    <ChipBtn key={o.value} label={o.label} selected={form.personas_hogar === o.value} onClick={() => setField('personas_hogar', o.value)} />
                  ))}
                </ChipGrid>
              </div>
              <div className="form-field">
                <span>¿Hay niños en casa?</span>
                <ChipGrid cols={2}>
                  <ChipBtn label="Sí" icon={<IconBaby width={18} height={18} />} selected={form.hay_ninos === true}  onClick={() => setField('hay_ninos', true)} />
                  <ChipBtn label="No" icon={<IconX width={18} height={18} />}    selected={form.hay_ninos === false} onClick={() => setField('hay_ninos', false)} />
                </ChipGrid>
              </div>
              <div className="form-field">
                <span>¿Quién decide la compra?</span>
                <ChipGrid cols={2}>
                  <ChipBtn label="Yo"        icon={<IconUser width={18} height={18} />}      selected={form.decisor === 'yo'}     onClick={() => setField('decisor', 'yo')} />
                  <ChipBtn label="Mi pareja" icon={<IconUsers width={18} height={18} />}      selected={form.decisor === 'pareja'} onClick={() => setField('decisor', 'pareja')} />
                  <ChipBtn label="Ambos"     icon={<IconHandshake width={18} height={18} />} selected={form.decisor === 'ambos'}  onClick={() => setField('decisor', 'ambos')} />
                  <ChipBtn label="Otro"      icon={<IconMoreHorizontal width={18} height={18} />} selected={form.decisor === 'otro'}   onClick={() => setField('decisor', 'otro')} />
                </ChipGrid>
              </div>
              <div className="form-field">
                <span>¿El decisor está presente?</span>
                <ChipGrid cols={2}>
                  <ChipBtn label="Sí" icon={<IconCheck width={18} height={18} />} selected={form.decisor_presente === true}  onClick={() => setField('decisor_presente', true)} />
                  <ChipBtn label="No" icon={<IconX width={18} height={18} />}     selected={form.decisor_presente === false} onClick={() => setField('decisor_presente', false)} />
                </ChipGrid>
              </div>
            </div>
          )}

          {/* ── Step 3: Agua ───────────────────────────────────────────── */}
          {step === 3 && (
            <div className="form-grid">
              <div className="form-field">
                <span>¿De dónde obtienen su agua?</span>
                <ChipGrid cols={2}>
                  {FUENTE_OPTS.map((o) => (
                    <ChipBtn key={o.value} label={o.label} icon={o.icon} selected={form.fuente_agua === o.value} onClick={() => setField('fuente_agua', o.value)} />
                  ))}
                </ChipGrid>
              </div>
              <div className="form-field">
                <span>¿Qué les preocupa del agua? <span style={{ fontWeight: 400, fontSize: '0.75rem', color: '#64748b' }}>(varias)</span></span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                  {PREOCUPACIONES_OPTS.map((o) => (
                    <ChipBtn
                      key={o.value}
                      label={o.label}
                      icon={o.icon}
                      selected={form.preocupaciones.includes(o.value)}
                      onClick={() => togglePreocupacion(o.value)}
                    />
                  ))}
                </div>
              </div>
              <div className="form-field">
                <span>¿Cuánto gastan al mes en agua?</span>
                <ChipGrid cols={3}>
                  {GASTO_OPTS.map((o) => (
                    <ChipBtn key={o.value} label={o.label} selected={form.gasto_mensual_agua === o.value} onClick={() => setField('gasto_mensual_agua', o.value)} />
                  ))}
                </ChipGrid>
              </div>
              <LiveScore score={liveScore} />
            </div>
          )}

          {/* ── Step 4: Interés ────────────────────────────────────────── */}
          {step === 4 && (
            <div className="form-grid">
              <div className="form-field">
                <span>¿Cuándo podemos hacer una revisión del agua?</span>
                <ChipGrid cols={2}>
                  {INTERES_OPTS.map((o) => (
                    <ChipBtn key={o.value} label={o.label} icon={o.icon} selected={form.interes_revision === o.value} onClick={() => setField('interes_revision', o.value)} />
                  ))}
                </ChipGrid>
              </div>
              <label className="form-field">
                <span>Notas</span>
                <textarea
                  value={form.notas}
                  onChange={(e) => setField('notas', e.target.value)}
                  placeholder="Mejor horario, observaciones…"
                  rows={3}
                  style={{ fontSize: '16px', resize: 'vertical' }}
                />
              </label>
              {/* Final score card */}
              <div
                style={{
                  padding: '16px',
                  borderRadius: '12px',
                  background: `${TEMP_COLOR[liveTemp]}12`,
                  border: `2px solid ${TEMP_COLOR[liveTemp]}`,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>
                  {form.nombre || 'Prospecto'}
                </div>
                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: TEMP_COLOR[liveTemp], lineHeight: 1 }}>
                  {liveScore}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '1.1rem', fontWeight: 700, color: TEMP_COLOR[liveTemp] }}>
                  {TEMP_ICON[liveTemp]}
                  {TEMP_LABEL[liveTemp]}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 5: Resultado ──────────────────────────────────────── */}
          {step === 5 && savedResult && (
            <ResultCard
              survey={savedResult}
              onCall={callPhone}
              onWhatsApp={openWhatsApp}
              onLinkLead={linkOrCreateLead}
              onAgendarDemo={handleAgendarDemo}
              linking={linkingId === savedResult.id}
            />
          )}

        </div>
      </Modal>

      <CitaModal
        open={citaOpen}
        onClose={() => setCitaOpen(false)}
        onSaved={handleCitaSaved}
        initialData={citaInitial}
      />
    </div>
  )
}

// ─── ResultCard ───────────────────────────────────────────────────────────────

function LeadStatusAction({
  survey,
  onLinkLead,
  linking,
}: {
  survey: WaterSurvey
  onLinkLead: (survey: WaterSurvey) => void
  linking: boolean
}) {
  if (survey.lead_id) {
    return (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#16a34a', fontWeight: 600, fontSize: '0.875rem', padding: '10px 4px' }}
      >
        <IconCheck width={16} height={16} /> Lead conectado
      </span>
    )
  }
  return (
    <button
      type="button"
      className="seller-chip"
      onClick={() => onLinkLead(survey)}
      disabled={linking}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', padding: '10px 16px', minHeight: '44px' }}
    >
      <IconUser width={16} height={16} /> {linking ? 'Enlazando…' : 'Crear/enlazar lead'}
    </button>
  )
}

function AgendarDemoAction({
  survey,
  onAgendarDemo,
  label,
}: {
  survey: WaterSurvey
  onAgendarDemo: (survey: WaterSurvey) => void
  label: string
}) {
  if (!survey.lead_id) return null
  return (
    <button
      type="button"
      className="seller-chip"
      onClick={() => onAgendarDemo(survey)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', padding: '10px 16px', minHeight: '44px' }}
    >
      <IconCalendar width={16} height={16} /> {label}
    </button>
  )
}

function ResultCard({
  survey,
  onCall,
  onWhatsApp,
  onLinkLead,
  onAgendarDemo,
  linking,
}: {
  survey: WaterSurvey
  onCall: (p: string | null) => void
  onWhatsApp: (p: string | null) => void
  onLinkLead: (survey: WaterSurvey) => void
  onAgendarDemo: (survey: WaterSurvey) => void
  linking: boolean
}) {
  const temp  = survey.temperatura ?? 'frio'
  const color = TEMP_COLOR[temp]

  return (
    <div style={{ textAlign: 'center', paddingTop: '4px' }}>
      {/* Score card */}
      <div
        style={{
          padding: '20px',
          borderRadius: '14px',
          background: `${color}12`,
          border: `2px solid ${color}`,
          marginBottom: '20px',
        }}
      >
        <div style={{ fontSize: '3rem', fontWeight: 800, color, lineHeight: 1 }}>
          {survey.score}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '1.5rem', fontWeight: 700, color, margin: '4px 0 8px' }}>
          {TEMP_ICON[temp]}
          {TEMP_LABEL[temp]}
        </div>
        <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{survey.nombre}</div>
        <div style={{ color: '#64748b', fontSize: '0.875rem' }}>{survey.telefono}</div>
      </div>

      {/* Recommended action */}
      {temp === 'caliente' && (
        <>
          <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 500, marginBottom: '12px' }}>
            <IconFlame width={18} height={18} /> ¡Lead caliente! Agenda la demo ahora mismo.
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="seller-chip active"
              onClick={() => onWhatsApp(survey.telefono)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', padding: '10px 16px', minHeight: '44px' }}
            >
              <IconWhatsapp width={16} height={16} /> WhatsApp
            </button>
            <LeadStatusAction survey={survey} onLinkLead={onLinkLead} linking={linking} />
            <AgendarDemoAction survey={survey} onAgendarDemo={onAgendarDemo} label="Agendar demo" />
          </div>
          <button
            type="button"
            className="inline-link"
            onClick={() => onCall(survey.telefono)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', marginTop: '8px' }}
          >
            <IconPhone width={14} height={14} /> Llamar
          </button>
        </>
      )}

      {temp === 'tibio' && (
        <>
          <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: 500, marginBottom: '12px' }}>
            <IconSun width={18} height={18} /> Lead tibio — dale seguimiento esta semana.
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <LeadStatusAction survey={survey} onLinkLead={onLinkLead} linking={linking} />
            <button
              type="button"
              className="seller-chip"
              onClick={() => onCall(survey.telefono)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.875rem', padding: '10px 20px', minHeight: '44px' }}
            >
              <IconPhone width={16} height={16} /> Llamar
            </button>
            <AgendarDemoAction survey={survey} onAgendarDemo={onAgendarDemo} label="Agendar seguimiento" />
          </div>
        </>
      )}

      {temp === 'frio' && (
        <p style={{ color: '#64748b', marginTop: '4px' }}>
          Encuesta guardada. Continúa con tu ruta.
        </p>
      )}
    </div>
  )
}
