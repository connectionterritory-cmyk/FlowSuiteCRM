# Auditoria frontend actual (FlowSuiteCRM)

Este documento resume el frontend existente para integrar el nuevo modulo MarketingFlow sin modificar nada. Se revisan dos frontends en el repo: el app principal en `flowsuitecrm/` y un frontend legacy en `frontend/`.

## 1) Rutas y paginas (sidebar) - app principal (flowsuitecrm)

Fuente: `flowsuitecrm/src/app/navigation.ts`, `flowsuitecrm/src/components/Sidebar.tsx`, `flowsuitecrm/src/app/App.tsx`.

- /dashboard (Dashboard)
- /hoy (Hoy)
- /cierres (Cierres)
- /pipeline (Oportunidades)
- /leads (Leads / Prospectos)
- /clientes (Clientes)
- /ventas (Ventas)
- /productos (Productos)
- /programas (Programas)
  - /4en14 (Programa 4 en 14)
  - /conexiones-infinitas (Conexiones Infinitas)
- /servicio-cliente (Servicio)
- /telemercadeo (Telemercadeo)
  - /telemercadeo/cartera (Cartera)
  - /telemercadeo/cumpleanos (Cumpleanos)
  - /telemercadeo/filtros (Filtros)
  - /telemercadeo/referidos (Referidos)
- /importaciones (Importaciones)
- /usuarios (Usuarios)
- /perfil (Perfil)
- /login, /reset-password (Auth)

## 2) Paginas clave y comportamiento (app principal - flowsuitecrm)

### Clientes (`flowsuitecrm/src/modules/clientes/ClientesPage.tsx`)

- Supabase (lecturas)
  - `clientes` (lista + detalle)
  - `notasrp` (notas por cliente, ultimas 20)
- Supabase (acciones)
  - `clientes.insert` (crear) con `origen: 'manual'`
  - `clientes.update` (editar)
  - `clientes.delete` (eliminar fisico, solo admin/distribuidor)
- Filtros
  - Busqueda (nombre, telefono, cuenta)
  - Estado de cuenta (actual, cancelacion_total, inactivo)
  - Morosidad (segmentos por dias)
  - Vendedor
  - Ciudad, Estado/Region, ZIP
- Acciones UI
  - Exportar CSV
  - Crear/Editar cliente (Modal)
  - Duplicados por telefono (panel modal)
  - WhatsApp (usa MessageModal)
- Componentes reutilizables
  - `SectionHeader`, `DataTable`, `Modal`, `DetailPanel`, `Button`, `EmptyState`, `Toast`, `MessageModal`

### Leads / Prospectos (`flowsuitecrm/src/modules/leads/LeadsPage.tsx`)

- Supabase (lecturas)
  - `leads`
  - `embajadores` (map de embajador)
  - `clientes` (map de referido)
  - `usuarios` (owners)
  - `v_lead_last_activity` (ultima actividad)
- Supabase (acciones)
  - `leads.insert` (crear)
  - `leads.update` (reasignar, reschedule, soft delete / restore)
  - `lead_notas.insert` (notas / seguimiento)
- Filtros
  - Busqueda (nombre, telefono)
  - Estado pipeline (nuevo, contactado, cita, demo, cierre, descartado, en_proceso)
  - Fuente
  - Owner (vendedor)
  - Vencidos (next_action_date <= hoy)
  - Mobile chips: mine, new, followup, appointment, urgent
- Acciones UI
  - Exportar CSV
  - Crear lead (Modal)
  - Reschedule (update next_action + next_action_date)
  - Papelera (soft delete / restore)
  - Reasignar lead (admin/distribuidor)
  - WhatsApp (MessageModal)
- Componentes reutilizables
  - `SectionHeader`, `DataTable`, `Modal`, `Button`, `EmptyState`, `Toast`, `Badge`, `MessageModal`

### Telemercadeo - Cartera (`flowsuitecrm/src/modules/telemercadeo/TelemercadeoCarteraPage.tsx`)

- Supabase (lecturas)
  - `clientes` (via `useTelemercadeoClientes`)
  - `llamadas_telemercadeo` (ultimo contacto por cliente)
  - `tele_vendedor_assignments` / `usuarios` (scope telemercadeo)
- Supabase (acciones)
  - `llamadas_telemercadeo.insert` (registro de llamada)
- Filtros
  - Segmentos (0-30, 31-60, 61-90, +90, hoy, promesas vencidas)
  - Busqueda (nombre, telefono, Hycite ID)
  - Sin contacto (sin registros previos)
- Acciones UI
  - Registrar llamada (TelemercadeoCallModal)
  - WhatsApp (MessageModal)
- Componentes reutilizables
  - `ClienteCard`, `TelemercadeoCallModal`, `Modal`, `Button`, `MessageModal`

### Telemercadeo - Cumpleanos (`flowsuitecrm/src/modules/telemercadeo/TelemercadeoCumpleanosPage.tsx`)

- Supabase (lecturas)
  - `clientes` (via `useTelemercadeoClientes`)
- Supabase (acciones)
  - `llamadas_telemercadeo.insert` (desde modal)
- Filtros
  - Dia especifico o solo hoy
- Acciones UI
  - Registrar llamada
  - WhatsApp (MessageModal)
- Componentes reutilizables
  - `ClienteCard`, `TelemercadeoCallModal`, `Button`, `MessageModal`

### Telemercadeo - Filtros (equipos) (`flowsuitecrm/src/modules/telemercadeo/TelemercadeoFiltrosPage.tsx`)

- Supabase (lecturas)
  - `equipos_instalados` + join `clientes` (via `useTelemercadeoEquipos`)
- Supabase (acciones)
  - `llamadas_telemercadeo.insert` (desde modal)
- Filtros
  - Cambio de filtros por meses desde instalacion (>= 6 meses)
- Acciones UI
  - Registrar llamada
  - WhatsApp (MessageModal)
- Componentes reutilizables
  - `ClienteCard`, `TelemercadeoCallModal`, `MessageModal`

### Telemercadeo - Referidos (`flowsuitecrm/src/modules/telemercadeo/TelemercadeoReferidosPage.tsx`)

- Supabase (lecturas)
  - `ci_referidos` (hasta 100)
- Supabase (acciones)
  - `ci_referidos.update` (notas / estado)
- Filtros
  - Tabs: pendientes vs todos
- Acciones UI
  - Registrar contacto (Modal)
  - WhatsApp (MessageModal)
- Componentes reutilizables
  - `Modal`, `Button`, `Toast`, `MessageModal`

### Servicio (`flowsuitecrm/src/modules/servicio-cliente/ServicioClientePage.tsx`)

- Supabase (lecturas)
  - `clientes`, `productos`, `equipos_instalados`, `componentes_equipo`, `servicios`, `ventas`
- Supabase (acciones)
  - `servicios.insert` (nuevo servicio)
- Filtros
  - No hay filtros, solo listas
- Acciones UI
  - Crear servicio (Modal)
- Componentes reutilizables
  - `SectionHeader`, `DataTable`, `Modal`, `Button`, `Toast`, `EmptyState`

### Programas - landing (`flowsuitecrm/src/modules/programas/ProgramasPage.tsx`)

- Supabase
  - No consulta directa (solo links)
- Acciones UI
  - Entrar a Conexiones Infinitas o 4 en 14
- Componentes reutilizables
  - `SectionHeader`, `Button`

### Programa 4 en 14 (`flowsuitecrm/src/modules/4en14/Programa4en14Page.tsx`)

- Supabase (lecturas)
  - `programa_4en14` (ciclos)
  - `programa_4en14_referidos`
  - `clientes`, `embajadores`, `usuarios`, `productos`, `leads`
- Supabase (acciones)
  - `programa_4en14.insert` (crear ciclo)
  - `programa_4en14_referidos.update` (calificar referido)
  - `leads.update` (actualizar score/campos de calificacion)
- Filtros
  - No hay filtros explicitos; hay expansion por ciclo y formularios
- Acciones UI
  - Crear ciclo
  - Registrar/calificar referidos
  - Mensajeria (WhatsApp/SMS/Email via MessageModal)
- Componentes reutilizables
  - `SectionHeader`, `DataTable`, `StatCard`, `Modal`, `Badge`, `Button`, `MessageModal`, `Toast`

### Conexiones Infinitas (`flowsuitecrm/src/modules/conexiones-infinitas/ConexionesInfinitasPage.tsx` + `flowsuitecrm/src/hooks/useConexiones.ts`)

- Supabase (lecturas)
  - `programas` (programa activo)
  - `ci_activaciones` (activacion activa del representante)
  - `ci_referidos`
  - `clientes`, `leads`
  - `productos`
  - `embajadores`, `periodos_programa`, `embajador_programas`
  - `usuarios` (roles)
- Supabase (acciones)
  - `programas.insert` (si no existe programa Conexiones Infinitas)
  - `ci_activaciones.insert` / `ci_activaciones.update`
  - `ci_referidos.insert` / `ci_referidos.update`
  - `leads.insert` (crear lead desde referido / embajador)
  - `embajador_programas.update` (conteos)
  - `programa_4en14_referidos.insert` (sincroniza cuando aplica)
  - `embajadores.insert`, `periodos_programa.insert`, `embajador_programas.insert`
  - Storage: `supabase.storage.from('conexiones-infinitas')` (fotos)
- Filtros
  - Busqueda de owner (cliente/prospecto) y referidos
  - Estados del referido (CI) y validaciones de min referidos
  - Segmentos y niveles de embajadores
- Acciones UI
  - Crear activacion (cliente/prospecto)
  - Agregar referidos
  - Subir foto / enviar difusion WhatsApp
  - Convertir referido a lead
  - Gestion de embajadores (periodos, programas)
  - Mensajeria (WhatsApp/SMS/Email)
- Componentes reutilizables
  - `SectionHeader`, `DataTable`, `StatCard`, `Modal`, `Badge`, `Button`, `ActivacionReferidosPanel`, `MessageModal`, `Toast`

## 3) Frontend legacy (frontend/)

Fuente: `frontend/src/App.jsx` + `frontend/src/components/AppShell.jsx`.

- /pipeline (Pipeline Kanban) -> `oportunidades`
- /cliente-360 (Cliente 360) -> `clientes`, `oportunidades`, `ordenesrp`, `servicios`, `cliente_sistemas`, `transaccionesrp`, `notas` (ver archivo)
- /servicio (Servicio/Postventa) -> `servicios`, `servicio_items` (crear ticket)
- /agua (Agua) -> `inventario_agua` (ver archivo)
- /cartera (Cartera) -> `transaccionesrp`, `cargo_vuelta_cases`
- /team-hub (Team Hub) -> `team_channels`, `team_posts` (ver archivo)

Nota: este frontend filtra por `org_id` (multi-org). El app principal `flowsuitecrm/` no usa `org_id`.

## 4) Confirmaciones requeridas

- Calendar/appointments: NO hay modulo calendario dedicado. Las citas se modelan con `leads.next_action_date` y `leads.estado_pipeline = 'cita'` (ver `LeadsPage` y `HoyPage`).
- Activities/log: SI existe registro de actividad via `lead_notas` (seguimiento, checkin, mensajeria) y `notasrp` para clientes. Vista `v_lead_last_activity` se usa para ultimas actividades.
- Templates: SI existen plantillas de mensajeria en `flowsuitecrm/src/lib/whatsappTemplates.ts` y editor/gestion local en `MessageModal` (custom templates en localStorage).
- Export CSV: SI (Clientes y Leads tienen export CSV local).
