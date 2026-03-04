# MarketingFlow — Sprint 1 Blueprint
**Fecha:** 2026-03-03 | **Base:** commit 03d58c3

---

## 1. Alcance del Sprint 1

Envíos manuales one-by-one. Sin automatización, sin broadcast, sin API de WhatsApp.

**Entrega mínima viable:**
- Crear campañas basadas en segmentos predefinidos
- Generar lista de contactos por campaña
- Ejecutar envíos manuales (abre WhatsApp/SMS del dispositivo)
- Registrar resultado por contacto
- Dashboard básico de KPIs

---

## 2. Estructura de Rutas

Sigue el mismo patrón que `/telemercadeo` (parent layout + sub-rutas).

```
/marketing-flow                    ← MarketingFlowPage (parent layout con sub-nav)
  /marketing-flow/segmentos        ← SegmentosPage
  /marketing-flow/campanas         ← CampanasPage
  /marketing-flow/envios           ← EnviosPage  (?campana=<uuid>)
```

### 2.1 Archivos a crear

```
flowsuitecrm/src/modules/marketing-flow/
  MarketingFlowPage.tsx            ← parent layout + sub-nav tabs
  SegmentosPage.tsx
  CampanasPage.tsx
  EnviosPage.tsx
  hooks/
    useMkCampaigns.ts              ← CRUD de mk_campaigns
    useMkMessages.ts               ← generación y lectura de mk_messages
    useMkResponses.ts              ← registro de mk_responses
  lib/
    segments.ts                    ← definición de los 12 segmentos (keys, labels, query builders)
    responseActions.ts             ← acciones automáticas por resultado
    templateVariables.ts           ← builders de variables para cada segmento
```

### 2.2 Cambios en archivos existentes

| Archivo | Cambio |
|---------|--------|
| `src/app/App.tsx` | Agregar `<Route path="/marketing-flow" element={<MarketingFlowPage />}>` con sub-rutas |
| `src/app/navigation.ts` | Agregar item `marketing-flow` a `navItems` + `marketingFlowSubItems` array |
| `src/components/Sidebar.tsx` | Agregar bloque colapsable para marketing-flow (igual que telemercadeo) |
| `src/i18n/locales/es.json` | Agregar claves `nav.marketingFlow`, `marketingFlow.*` |

### 2.3 Roles con acceso

| Rol | Acceso |
|-----|--------|
| admin | Completo — ve todo |
| distribuidor | Ve campañas de su equipo, puede ejecutar |
| vendedor | Ve y ejecuta solo sus campañas |
| telemercadeo | Solo ejecuta campañas asignadas (owner_id = su vendedor) |

---

## 3. Flujo de Usuario (paso a paso)

```
[1] SELECCIONAR SEGMENTO
   /marketing-flow/segmentos
   └─ El usuario ve las 12 cards de segmentos
   └─ Cada card muestra: nombre, descripción, tablas fuente, # estimado de contactos
   └─ Botón "Crear campaña →" pre-rellena el formulario en /campanas

        ↓

[2] CREAR CAMPAÑA
   /marketing-flow/campanas → modal "Nueva campaña"
   └─ Campos: nombre, segmento (dropdown), canal (WA/SMS), plantilla
   └─ Estado inicial: 'borrador'
   └─ Guarda en mk_campaigns

        ↓

[3] GENERAR LISTA
   /marketing-flow/campanas → botón "Generar lista" en la campaña borrador
   └─ Frontend ejecuta la query del segmento (ver segments.ts)
   └─ Deduplica por teléfono (un mensaje por teléfono único en esta campaña)
   └─ Inserta batch en mk_messages (con mensaje_texto pre-renderizado)
   └─ Actualiza mk_campaigns: estado='activa', total_contactos=N
   └─ Navega a /marketing-flow/envios?campana=<id>

        ↓

[4] EJECUTAR ENVÍOS (one-by-one)
   /marketing-flow/envios?campana=<id>
   └─ Muestra lista de mk_messages de esta campaña
   └─ Por cada contacto (card expandida):
      ├─ Info del contacto (nombre, teléfono, contexto según segmento)
      ├─ Mensaje pre-renderizado (copyable)
      ├─ Botón [WhatsApp] → buildWhatsappUrl() → abre app
      ├─ Botón [SMS] (si canal = sms)
      └─ Al hacer click en WA/SMS → registra mk_messages.abierto_at

        ↓

[5] REGISTRAR RESPUESTA
   Mismo card del contacto (después de regresar de WhatsApp)
   └─ Dropdown: seleccionar resultado (del catálogo normalizado)
   └─ Campos opcionales según resultado:
      - reagendar → followup_at (date picker)
      - pago_prometido → monto_prometido (input numérico)
      - todos → notas (textarea libre)
   └─ Botón "Guardar y continuar →"
   └─ Inserta en mk_responses

        ↓

[6] ACCIÓN RÁPIDA (automática según resultado)
   responseActions.ts ejecuta:
   ├─ cita_agendada    → lead_notas.insert({tipo:'cita', nota: 'Cita agendada via campaña X'})
   ├─ pago_prometido   → llamadas_telemercadeo.insert({monto_prometido, followup_at})
   ├─ no_interesado    → (ninguna acción en Sprint 1 — marcar solo en mk_responses)
   ├─ reagendar        → (ninguna acción — la fecha queda en mk_responses.followup_at)
   └─ numero_incorrecto → (ninguna acción en Sprint 1)

        ↓

[7] PROGRESO
   - Progress bar: X/N contactos con resultado registrado
   - Cuando X === N → campaña puede marcarse 'completada'
   - KPIs actualizados en tiempo real
```

---

## 4. Páginas — Especificación Detallada

### 4.1 `/marketing-flow/segmentos` — SegmentosPage

**Estado:**
```typescript
segments: SegmentDefinition[]          // estático — importado de segments.ts
previewCounts: Record<string, number>  // resultado de count queries
loadingPreview: Record<string, boolean>
```

**UI:**
- Grid de cards (2 columnas en desktop)
- Cada card:
  - Título + badge de tipo (leads / clientes / CI)
  - Descripción 1 línea
  - `[Previsualizar]` → ejecuta COUNT query, muestra N contactos
  - `[Crear campaña]` → navega a `/marketing-flow/campanas?segmento=<key>`
- Sin paginación en Sprint 1 (son solo 12)

---

### 4.2 `/marketing-flow/campanas` — CampanasPage

**Estado:**
```typescript
campaigns: MkCampaign[]
loading: boolean
modalOpen: boolean
form: { nombre, segmento_key, canal, template_key }
```

**UI:**
- Header: título + botón `[+ Nueva campaña]`
- Lista de campañas (tabla o cards):
  - Nombre, segmento, canal, estado, total_contactos, # respuestas
  - Estado badge: borrador | activa | pausada | completada | archivada
  - Acciones según estado:
    - borrador → `[Generar lista]` / `[Eliminar]`
    - activa → `[Ejecutar envíos →]` / `[Pausar]`
    - pausada → `[Reanudar]` / `[Archivar]`
    - completada → `[Ver resultados]` / `[Archivar]`

**Modal "Nueva campaña":**
```
Nombre: [______________]
Segmento: [Dropdown 12 opciones]
Canal: [● WhatsApp  ○ SMS]
Plantilla: [Dropdown de whatsapp_templates_org filtrado por canal]
[Cancelar] [Guardar borrador]
```

**Generar lista (acción inline):**
- Spinner mientras ejecuta el query del segmento
- Toast: "Lista generada: N contactos. Duplicados eliminados: M."
- Transición automática a estado 'activa'

---

### 4.3 `/marketing-flow/envios?campana=<id>` — EnviosPage

**Estado:**
```typescript
campaignId: string                    // de query param
campaign: MkCampaign | null
messages: MkMessageWithResponse[]    // mk_messages LEFT JOIN mk_responses
currentIndex: number
responseForm: {
  resultado: string | null
  notas: string
  followup_at: string
  monto_prometido: string
}
saving: boolean
```

**UI — Layout:**
```
┌─────────────────────────────────────────────────────┐
│ ← Campañas      [Nombre campaña]   12/47 ████░░░    │
│─────────────────────────────────────────────────────│
│                                                     │
│  ┌─ BETTY LOPEZ ─────────────────────────────────┐  │
│  │ 📱 (786) 262-9516   Segmento: Cartera 0-30   │  │
│  │ Saldo: $1,082  ·  Morosidad: 0-30 días        │  │
│  │                                               │  │
│  │ Mensaje:                                      │  │
│  │ ┌───────────────────────────────────────────┐ │  │
│  │ │ Hola Betty, te saluda [vendedor]...       │ │  │
│  │ │                           [📋 Copiar]     │ │  │
│  │ └───────────────────────────────────────────┘ │  │
│  │                                               │  │
│  │ Canal: [💬 WhatsApp]  [📱 SMS]               │  │
│  │                                               │  │
│  │ Resultado: [Seleccionar ▼]                   │  │
│  │                                               │  │
│  │ (si reagendar) Fecha: [__________]            │  │
│  │ (si pago_prometido) Monto: [$_____]           │  │
│  │ Notas: [____________________________]         │  │
│  │                                               │  │
│  │              [← Anterior]  [Guardar →]        │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Pendientes: 35  ·  Con resultado: 12  ·  Sin WA: 0 │
└─────────────────────────────────────────────────────┘
```

**Comportamiento:**
- Lista de mensajes navega con [Anterior] / [Guardar →] (avance automático)
- Mensajes ya respondidos muestran badge de resultado (verde/naranja/rojo)
- Filtro rápido: `[Todos] [Pendientes] [Con resultado]`
- Si `mk_messages.abierto_at IS NULL` → click WA lo registra (fire & forget)
- Guardar sin resultado → válido (marca como "visto" pero sin respuesta)

---

### 4.4 `/marketing-flow` — Dashboard (índice, redirige a /campanas)

Por Sprint 1: `<Navigate to="/marketing-flow/campanas" replace />`

En Sprint 2 se convierte en dashboard con KPIs.

---

## 5. Catálogo de Resultados (mk_responses.resultado)

```typescript
export const RESULTADO_OPTIONS = [
  { value: 'sin_respuesta',    label: 'Sin respuesta',     color: 'gray'   },
  { value: 'buzon',            label: 'Buzón de voz',      color: 'gray'   },
  { value: 'cita_agendada',    label: 'Cita agendada',     color: 'green'  },
  { value: 'pago_prometido',   label: 'Pago prometido',    color: 'green'  },
  { value: 'pago_realizado',   label: 'Pago realizado',    color: 'green'  },
  { value: 'reagendar',        label: 'Reagendar',         color: 'yellow' },
  { value: 'solicita_info',    label: 'Solicita info',     color: 'yellow' },
  { value: 'no_interesado',    label: 'No interesado',     color: 'red'    },
  { value: 'numero_incorrecto',label: 'Número incorrecto', color: 'red'    },
  { value: 'disputa',          label: 'En disputa',        color: 'red'    },
  { value: 'ya_pago',          label: 'Ya pagó',           color: 'blue'   },
  { value: 'demo_calificada',  label: 'Demo calificada',   color: 'green'  },
  { value: 'venta_cerrada',    label: 'Venta cerrada',     color: 'green'  },
] as const
```

**Campos adicionales por resultado:**
| Resultado | Campo extra |
|-----------|-------------|
| `reagendar` | `followup_at` (date) |
| `pago_prometido` | `monto_prometido` (numeric) |
| cualquiera | `notas` (texto libre, opcional) |

---

## 6. Variables de Plantilla por Segmento

`templateVariables.ts` — función `buildVariables(segmento_key, contactRow)`:

### Variables universales
```typescript
{
  cliente:       contacto.nombre,
  nombre_completo: `${contacto.nombre} ${contacto.apellido}`.trim(),
  vendedor:      currentUser.nombre,
  telefono:      currentUser.telefono ?? '',
  organizacion:  currentUser.organizacion ?? '',
}
```

### Variables adicionales por segmento
| Segmento | Variables extra |
|----------|-----------------|
| `clientes_cartera_*` | `saldo_actual`, `monto_moroso`, `dias_atraso`, `estado_morosidad` |
| `clientes_cumpleanos_*` | (solo universales) |
| `leads_*` | `estado_pipeline`, `fuente` |
| `ci_referidos_tele_pendientes` | `calificacion`, `modo_gestion` |

---

## 7. Acciones Rápidas por Resultado (`responseActions.ts`)

```typescript
async function executeResponseAction(
  resultado: string,
  message: MkMessage,
  response: MkResponseForm,
  session: Session
): Promise<void>
```

| Resultado | Acción |
|-----------|--------|
| `cita_agendada` | Si `contacto_tipo = 'lead'`: `lead_notas.insert` con tipo='cita' |
| `cita_agendada` | Si `contacto_tipo = 'cliente'`: `notasrp.insert` con tipo_mensaje='citas' |
| `pago_prometido` | `llamadas_telemercadeo.insert` con `monto_prometido`, `followup_at` |
| `numero_incorrecto` | Sin acción en Sprint 1 |
| `no_interesado` | Sin acción en Sprint 1 |
| `reagendar` | Sin acción extra — fecha queda en `mk_responses.followup_at` |
| (resto) | Sin acción extra |

---

## 8. Generación de Lista — Algoritmo

```typescript
async function generarLista(campaign: MkCampaign): Promise<void> {
  // 1. Obtener segmento definition
  const seg = SEGMENTS[campaign.segmento_key]

  // 2. Ejecutar query del segmento (Supabase, respeta RLS)
  const contactos = await seg.fetchContacts(supabase, session)

  // 3. Deduplicar por teléfono normalizado (ignorar nulos)
  const seen = new Set<string>()
  const deduped = contactos.filter(c => {
    const tel = normalizarTelefono(c.telefono)
    if (!tel || seen.has(tel)) return false
    seen.add(tel)
    return true
  })

  // 4. Renderizar mensaje por contacto
  const messages = deduped.map((c, i) => ({
    campaign_id:   campaign.id,
    owner_id:      campaign.owner_id,
    contacto_tipo: seg.contacto_tipo,
    contacto_id:   c.id,
    telefono:      c.telefono,
    nombre:        `${c.nombre} ${c.apellido ?? ''}`.trim(),
    mensaje_texto: renderTemplate(campaign.template_key, buildVariables(campaign.segmento_key, c)),
    canal:         campaign.canal,
    orden:         i + 1,
  }))

  // 5. Batch insert
  await supabase.from('mk_messages').insert(messages)

  // 6. Actualizar campaña
  await supabase.from('mk_campaigns')
    .update({ estado: 'activa', total_contactos: messages.length })
    .eq('id', campaign.id)
}
```

---

## 9. Navegación — Cambios en navigation.ts

```typescript
// Agregar a navItems (después de telemercadeo):
{
  key: 'marketing-flow',
  labelKey: 'nav.marketingFlow',
  path: '/marketing-flow',
  icon: IconMarketing,  // nuevo icono o reusar IconLeads
}

// Nuevo array de sub-items:
export const marketingFlowSubItems: NavSubItem[] = [
  { key: 'mf-segmentos', labelKey: 'nav.mfSegmentos', path: '/marketing-flow/segmentos' },
  { key: 'mf-campanas',  labelKey: 'nav.mfCampanas',  path: '/marketing-flow/campanas'  },
  { key: 'mf-envios',    labelKey: 'nav.mfEnvios',    path: '/marketing-flow/envios'    },
]
```

---

## 10. Claves i18n a agregar en es.json

```json
"nav": {
  "marketingFlow": "MarketingFlow",
  "mfSegmentos": "Segmentos",
  "mfCampanas": "Campañas",
  "mfEnvios": "Envíos"
},
"marketingFlow": {
  "title": "MarketingFlow",
  "segmentos": {
    "title": "Segmentos",
    "preview": "Previsualizar",
    "createCampaign": "Crear campaña"
  },
  "campanas": {
    "title": "Campañas",
    "new": "Nueva campaña",
    "generateList": "Generar lista",
    "execute": "Ejecutar envíos",
    "estados": {
      "borrador": "Borrador",
      "activa": "Activa",
      "pausada": "Pausada",
      "completada": "Completada",
      "archivada": "Archivada"
    }
  },
  "envios": {
    "title": "Envíos",
    "progress": "{{current}}/{{total}} contactados",
    "save": "Guardar y continuar",
    "resultado": "Resultado",
    "notas": "Notas",
    "followupAt": "Fecha seguimiento",
    "montoPrometido": "Monto prometido"
  }
}
```

---

## 11. Dependencias / No-Dependencias

**Usa (sin modificar):**
- `buildWhatsappUrl` de `src/lib/whatsappTemplates.ts`
- `MessageModal` NO se usa — envío es directo via link, no modal
- `useUsers` / `useAuth` para contexto del usuario
- `whatsapp_templates_org` para listar plantillas disponibles
- `leads`, `clientes`, `ci_referidos`, `ci_activaciones` (solo READ para generar lista)
- `lead_notas`, `notasrp`, `llamadas_telemercadeo` (WRITE para acciones rápidas)

**No toca:**
- Pipeline de leads — ninguna modificación
- Telemercadeo existente — ninguna modificación
- Tablas core — solo lectura para segmentos

---

## 12. Roadmap Incrementos Post-Sprint 1

| Sprint | Feature |
|--------|---------|
| Sprint 2 | Dashboard KPIs real (/marketing-flow home), exportar CSV, reagendar con scheduler |
| Sprint 2 | Segmentos personalizables (JSONB criteria en mk_campaigns) |
| Sprint 3 | WhatsApp Business API (envío automatizado desde la app) |
| Sprint 3 | Secuencias (drip): envío de follow-up programado N días después |
