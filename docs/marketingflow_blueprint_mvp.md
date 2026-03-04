# MarketingFlow MVP — Blueprint
**Fase 1: Envíos manuales (copy-paste WhatsApp/SMS/Email)**
**Fecha:** 2026-03-03

---

## 1. Propósito y Alcance

MarketingFlow es el módulo que permite a vendedores y distribuidores ejecutar campañas de contacto dirigido usando los datos ya existentes en FlowSuiteCRM (clientes, leads, referidos, equipos, ciclos 4en14).

**Fase 1 (este blueprint):**
- Segmentación automática de contactos según criterios predefinidos
- Pre-llenado de plantillas con variables del contacto
- Apertura directa de WhatsApp/SMS por contacto (manual, one-by-one)
- Registro del resultado de cada contacto
- Dashboard de KPIs de campaña

**Fuera de alcance Fase 1:**
- Envío masivo automatizado (broadcast)
- Integración API WhatsApp Business
- Email automation
- A/B testing de mensajes

---

## 2. Flujo Principal

```
CAMPAÑA
  │
  ├─ Tipo de campaña (catálogo)
  ├─ Segmento: criterios de filtro → lista de contactos
  ├─ Plantilla de mensaje (con variables {cliente}, {vendedor}, etc.)
  └─ Canal: WhatsApp / SMS / Email
        │
        ▼
EJECUCIÓN (por vendedor)
  │
  ├─ Lista de contactos filtrada y sin duplicados por teléfono
  ├─ Por cada contacto:
  │     ├─ Ver info del contacto (saldo, días atraso, nivel, etc.)
  │     ├─ Mensaje pre-llenado → click → abre WhatsApp/SMS
  │     └─ Registrar resultado (desplegable)
  └─ Progress bar: X/N contactados
        │
        ▼
RESULTADOS
  │
  ├─ Resultado registrado → acción automática:
  │     ├─ "cita_agendada" → crear cita en leads/HoyPage
  │     ├─ "pago_prometido" → registrar en llamadas_telemercadeo
  │     ├─ "no_interesado" → marcar para no volver a contactar en esta campaña
  │     └─ "reagendar" → mover fecha de follow-up
  └─ KPIs actualizados en tiempo real
```

---

## 3. Catálogo de Campañas

### 3.1 COBRANZA (Cartera)
| Subcampaña | Segmento | Prioridad |
|-----------|----------|-----------|
| Cartera 0-30 | `estado_morosidad = '0-30'` | Alta |
| Cartera 31-60 | `estado_morosidad = '31-60'` | Urgente |
| Cartera 61-90 | `estado_morosidad = '61-90'` | Crítica |
| Cartera 90+ | `estado_morosidad = '91+'` | Crítica |

**Fuente de datos:** `clientes`
**Contexto en mensaje:** saldo_actual, monto_moroso, dias_atraso, nombre
**Resultados relevantes:** pago_prometido, pago_realizado, disputa, sin_respuesta, numero_incorrecto, buzon

---

### 3.2 CUMPLEAÑOS
| Subcampaña | Segmento | Timing |
|-----------|----------|--------|
| Cumpleaños hoy | `fecha_nacimiento: mes+día = hoy` | Día exacto |
| Cumpleaños esta semana | `fecha_nacimiento: mes+día en próx. 7 días` | Anticipado |
| Cumpleaños clientes | `clientes.fecha_nacimiento` | Mensual |
| Cumpleaños leads | `leads.fecha_nacimiento` | Mensual |

**Fuente de datos:** `clientes` + `leads`
**Resultados relevantes:** cita_agendada, reagendar, sin_respuesta, no_interesado

---

### 3.3 CONEXIONES INFINITAS (CI)
| Subcampaña | Segmento | Propósito |
|-----------|----------|-----------|
| Referidos tele pendientes | `ci_referidos.modo_gestion = 'telemercadeo' AND estado = 'pendiente'` | Telemarketing trabaja referidos |
| CI sin mensaje enviado | `ci_activaciones.whatsapp_mensaje_enviado_at IS NULL` | Activaciones sin iniciar |
| CI con referidos sin lead | `ci_referidos.lead_id IS NULL AND estado != 'telemercadeo'` | Convertir referidos a leads |
| Recontactar referidos | `ci_referidos.estado = 'contactado' AND contactado_at < NOW()-'14 days'` | Follow-up |

**Fuente de datos:** `ci_referidos JOIN ci_activaciones JOIN clientes/leads`
**Resultados relevantes:** cita_agendada, reagendar, no_interesado, sin_respuesta

---

### 3.4 PROGRAMA 4EN14
| Subcampaña | Segmento | Propósito |
|-----------|----------|-----------|
| 4en14 activos - referidos pendientes | `programa.estado='activo' AND referido.estado_presentacion='pendiente'` | Confirmar demos |
| 4en14 por vencer (7 días) | `fecha_fin BETWEEN NOW() AND NOW()+7days AND estado='activo'` | Urgente: cerrar programa |
| 4en14 sin demos agendadas | `presentaciones_logradas = 0 AND estado='activo'` | Activar programa |
| Follow-up post-demo | `estado_presentacion IN ('agendada','show')` | Convertir a venta |

**Fuente de datos:** `programa_4en14 JOIN programa_4en14_referidos`
**Resultados relevantes:** cita_agendada, demo_calificada, venta, no_interesado

---

### 3.5 GARANTÍA / SERVICIO (Mantenimiento)
| Subcampaña | Segmento | Timing |
|-----------|----------|--------|
| Mantenimiento este mes | `componentes.fecha_proximo_cambio BETWEEN NOW() AND NOW()+30d` | Proactivo |
| Mantenimiento vencido | `componentes.fecha_proximo_cambio < NOW()` | Urgente |
| Revisión garantía | `equipos_instalados.fecha_instalacion > NOW()-2years` (garantía activa) | Beneficio |

**Fuente de datos:** `componentes_equipo JOIN equipos_instalados JOIN clientes`
**Resultados relevantes:** cita_servicio, sin_respuesta, no_interesado, reagendar

---

### 3.6 RECLUTAMIENTO
| Subcampaña | Segmento | Propósito |
|-----------|----------|-----------|
| Leads interesados en negocio | `leads.fuente = 'reclutamiento' AND estado_pipeline != 'descartado'` | Pipeline vendedores |
| Clientes nivel alto sin negocio | `clientes.nivel >= 5 AND NO existe usuarios record` | Invitar al negocio |
| Referidos CI con calificación alta | `ci_referidos.calificacion >= 4` | Alto potencial |

**Fuente de datos:** `leads` + `clientes`
**Resultados relevantes:** cita_agendada, solicita_info, no_interesado, reagendar

---

### 3.7 REACTIVACIÓN
| Subcampaña | Segmento | Propósito |
|-----------|----------|-----------|
| Inactivos 6 meses | `fecha_ultimo_pedido < NOW()-'6 months' AND estado_cuenta='actual'` | Reactivar compra |
| Inactivos 12 meses | `fecha_ultimo_pedido < NOW()-'12 months' AND estado_cuenta='actual'` | Rescatar cliente |
| Add-on elegibles | `elegible_addon = true AND NOT tiene_addon` | Venta cruzada |

**Fuente de datos:** `clientes`
**Resultados relevantes:** cita_agendada, pago_realizado, solicita_info, no_interesado

---

## 4. Catálogo de Resultados Normalizados

| Código | Label | Descripción | Acción automática |
|--------|-------|-------------|-------------------|
| `cita_agendada` | Cita agendada | Confirmó cita de demo o servicio | Crear nota en lead/cliente |
| `cita_servicio` | Cita servicio | Confirmó cita de mantenimiento | Crear nota en cliente |
| `reagendar` | Reagendar | Quiere ser contactado después | Crear followup_at + N días |
| `pago_prometido` | Pago prometido | Prometió pagar en fecha X | Registrar en llamadas_telemercadeo |
| `pago_realizado` | Pago realizado | Confirmó que ya pagó | Actualizar estado |
| `no_interesado` | No interesado | No quiere ser contactado | Excluir de futuros envíos |
| `solicita_info` | Solicita información | Pide más detalles | Marcar para seguimiento |
| `sin_respuesta` | Sin respuesta | No contestó | Re-intentar en N días |
| `buzon` | Buzón de voz | Llamada fue a buzón | Re-intentar |
| `numero_incorrecto` | Número incorrecto | Teléfono no válido | Marcar teléfono inválido |
| `disputa` | En disputa | Reclama cobro incorrecto | Escalar a supervisor |
| `ya_pago` | Ya pagó | Confirma pago reciente | Verificar en sistema |
| `demo_calificada` | Demo calificada | 4en14: demo exitosa | Incrementar presentaciones_logradas |
| `venta_cerrada` | Venta cerrada | Se cerró venta | Crear registro en ventas |

---

## 5. Variables de Plantilla por Tipo de Campaña

### Variables universales (todos los tipos)
```
{cliente}          → primer nombre
{nombre_completo}  → nombre + apellido
{vendedor}         → nombre del vendedor que envía
{organizacion}     → nombre de la organización
{telefono}         → teléfono del vendedor
```

### Variables de cartera
```
{saldo_actual}     → saldo total
{monto_moroso}     → monto vencido
{dias_atraso}      → días de atraso
{estado_morosidad} → 0-30, 31-60, etc.
```

### Variables de 4en14
```
{presentaciones_logradas}  → demos hechas
{meta_presentaciones}      → meta (4)
{fecha_fin}                → fecha límite del ciclo
{presentaciones_faltantes} → meta - logradas
```

### Variables de servicio/garantía
```
{componente}       → nombre del componente (prefiltro, etc.)
{fecha_proximo}    → fecha de próximo cambio
{producto}         → nombre del equipo
```

---

## 6. Roles y Permisos en MarketingFlow

| Rol | Puede crear campaña | Puede ejecutar | Ve resultados de |
|-----|--------------------|--------------|--------------------|
| admin | ✅ (globales) | ✅ (todas) | Todos |
| distribuidor | ✅ (su equipo) | ✅ (su equipo) | Su equipo |
| vendedor | ✅ (propias) | ✅ (propias) | Solo propias |
| telemercadeo | ❌ | ✅ (asignadas) | Solo asignadas |

---

## 7. KPIs del Dashboard de Marketing (mínimo 10)

| # | KPI | Fórmula | Granularidad |
|---|-----|---------|--------------|
| 1 | **Total envíos** | COUNT(mk_envios) | Por campaña / mes / vendedor |
| 2 | **Tasa de respuesta** | (envíos con resultado != 'sin_respuesta') / total × 100 | Por campaña |
| 3 | **Tasa de conversión citas** | (resultado = 'cita_agendada') / total × 100 | Por campaña |
| 4 | **Tasa pago prometido** | (resultado = 'pago_prometido') / total × 100 | Cartera |
| 5 | **Monto comprometido total** | SUM(mk_envios.monto_prometido) | Cartera / mes |
| 6 | **Contactos por canal** | COUNT GROUP BY canal | Semana |
| 7 | **Top vendedor por citas** | COUNT cita_agendada GROUP BY vendedor | Mes |
| 8 | **Campañas por resultado** | % de cada resultado por campaña | Por campaña |
| 9 | **Envíos sin resultado** | COUNT(resultado IS NULL) / total × 100 | Por vendedor |
| 10 | **Contactos únicos alcanzados** | COUNT DISTINCT(telefono) | Por campaña |
| 11 | **Efectividad por tipo de campaña** | citas / envíos GROUP BY tipo | Global |
| 12 | **Reintento promedio** | AVG(COUNT envíos) por telefono | Por campaña |

---

## 8. Wireframe de Pantallas (descripción)

### 8.1 Lista de Campañas (`/marketing`)
```
┌─────────────────────────────────────────────────────┐
│ MarketingFlow                    [+ Nueva Campaña]  │
│ ─────────────────────────────────────────────────── │
│ Filtros: [Tipo ▼] [Estado ▼] [Vendedor ▼]          │
│                                                     │
│ ┌─ Cartera 0-30 (Cobranza) ──────────────── ACTIVA ┐│
│ │ 47 contactos · WA · Última ejec: hoy             ││
│ │ Respuesta: 68% · Citas: 12% · [Ejecutar]        ││
│ └──────────────────────────────────────────────────┘│
│                                                     │
│ ┌─ Cumpleaños Marzo ───────────────────── ACTIVA ──┐│
│ │ 23 contactos · WA · Pendiente                    ││
│ │ Sin resultados aún · [Ejecutar]                  ││
│ └──────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### 8.2 Ejecución de Campaña (`/marketing/:id/ejecutar`)
```
┌─────────────────────────────────────────────────────┐
│ ← Cartera 0-30           Progreso: 12/47 ████░░░   │
│ ─────────────────────────────────────────────────── │
│ ┌─ BETTY LOPEZ ──────────────────────────────────┐  │
│ │ Tel: (786) 262-9516   Saldo: $1,082   0-30 días│  │
│ │ Nivel: 3 · Emprendedor: DOMO0002               │  │
│ │                                                │  │
│ │ Mensaje:                                       │  │
│ │ Hola Betty 👋, te saluda Patricia...           │  │
│ │                                    [WA] [SMS]  │  │
│ │                                                │  │
│ │ Resultado: [Seleccionar ▼]                     │  │
│ │ ○ Cita agendada  ○ Pago prometido              │  │
│ │ ○ Sin respuesta  ○ Reagendar  ○ No interesado  │  │
│ │                                    [Guardar →] │  │
│ └────────────────────────────────────────────────┘  │
│                  [← Anterior]  [Siguiente →]        │
└─────────────────────────────────────────────────────┘
```

### 8.3 Dashboard KPIs (`/marketing/dashboard`)
- Cards: Total envíos, Tasa respuesta, Citas generadas, Monto comprometido
- Tabla: Campañas activas con métricas inline
- Gráfico: Resultados por tipo (donut)
- Ranking: Top vendedores por citas

---

## 9. Roadmap Incremental

### Fase 1 (MVP — este blueprint)
- [ ] Tablas: mk_campaigns, mk_envios
- [ ] UI: Lista campañas + Ejecución one-by-one
- [ ] Segmentos predefinidos (query estática por tipo)
- [ ] Registro manual de resultados
- [ ] KPIs básicos (card stats)

### Fase 2
- [ ] Segmentos personalizables (criterios dinámicos via JSONB)
- [ ] Deduplicación automática por teléfono entre campañas
- [ ] Follow-up scheduler (reagendar con fecha)
- [ ] Exportar lista de contactos (CSV)
- [ ] Integración con `lead_notas` al registrar resultado

### Fase 3
- [ ] WhatsApp Business API (envío automatizado)
- [ ] Respuestas automáticas básicas
- [ ] Secuencias de mensajes (drip)
- [ ] Analytics avanzado con cohort analysis
