# Puntos de integracion para MarketingFlow (frontend)

Este documento lista componentes reutilizables, propuesta de navegacion, acciones rapidas y guardrails por rol para integrar MarketingFlow sin tocar modulos existentes.

## 1) Componentes reutilizables (UI/UX)

Componentes base disponibles en `flowsuitecrm/src/components/`:

- Tabla y layout
  - `DataTable` (tabla principal con rows/cells y detail)
  - `SectionHeader` (titulo + acciones)
  - `StatCard` (kpis)
  - `EmptyState` (estado sin datos)
  - `DetailPanel` (detalle lateral)
- Acciones y feedback
  - `Button`, `Badge`, `Modal`, `Toast`
  - `QuickActionsSheet` (acciones rapidas globales)
- Mensajeria
  - `MessageModal` + `useMessaging` (WhatsApp/SMS/Email)
  - `WhatsappTemplateModal` (alias de `MessageModal`)
- Telemercadeo
  - `ClienteCard` (cards de cliente con acciones)
  - `TelemercadeoCallModal` (registro de llamadas)

Notas:
- Plantillas y categorias de mensajes en `flowsuitecrm/src/lib/whatsappTemplates.ts`.
- Registro de mensajes: `lead_notas` (leads) y `notasrp` (clientes).

## 2) Propuesta de navegacion (sidebar)

Contexto actual del sidebar (orden principal): Dashboard, Hoy, Cierres, Pipeline, Leads, Clientes, Ventas, Productos, Programas, Servicio, Telemercadeo, Importaciones, Usuarios.

Propuesta:
- Insertar `MarketingFlow` debajo de `Leads` y encima de `Clientes`.
  - Razon: se alinea con flujo de prospectos y campanas, y evita mezclarlo con Telemercadeo o Servicio.
  - Ruta sugerida: `/marketing-flow`.
- Si se requiere subnav: usar patron de `Programas` y `Telemercadeo` (nav group con subitems).

## 3) Acciones rapidas sugeridas (sin cambiar modulos existentes)

Accion: Crear cita
- Tabla: `leads`
- Update sugerido:
  - `estado_pipeline = 'cita'`
  - `next_action = 'Cita'` (o texto libre)
  - `next_action_date = <fecha>`
- Log:
  - `lead_notas.insert` con `tipo = 'seguimiento'` o `tipo = 'mensajeria'`.

Accion: Crear tarea / follow-up
- Tabla: `leads`
- Update sugerido:
  - `next_action`, `next_action_date`
- Log:
  - `lead_notas.insert` con `tipo = 'seguimiento'`.

Accion: Marcar no interesado
- Tabla: `leads`
- Update sugerido:
  - `estado_pipeline = 'descartado'`
  - (opcional) `deleted_at` solo si se quiere mover a papelera (se usa en Leads)
- Para referidos CI / Tele:
  - `ci_referidos.update({ estado: 'no_interesado' })`
  - O registrar en `llamadas_telemercadeo` con `resultado = 'no_interesado'` si proviene de Cartera.

## 4) Guardrails por rol (frontend)

Basado en `flowsuitecrm/src/components/Sidebar.tsx`, `LeadsPage`, `ClientesPage`, `telemercadeoData`.

- Vendedor
  - Vista seller (viewMode = seller): no ve `usuarios`, `importaciones`, `productos`.
  - Leads: solo propios (`vendedor_id` o `owner_id`), sin reasignar ni eliminar.
  - Clientes: vista limitada a propios, sin crear/editar/eliminar.

- Distribuidor
  - Ve `usuarios`, `importaciones`, `productos`.
  - Leads: puede reasignar y eliminar (papelera) en viewMode distributor.
  - Clientes: puede crear/editar/eliminar.

- Admin
  - Mismo alcance que distribuidor en sidebar.
  - Leads: reasignar/eliminar habilitado en viewMode distributor.
  - Clientes: crear/editar/eliminar.

- Telemercadeo / Supervisor Telemercadeo
  - Sidebar: acceso a Telemercadeo segun rol.
  - Data scope: `tele_vendedor_assignments` limita vendedores visibles.
  - Acciones: registro de llamadas en `llamadas_telemercadeo`.

Sugerencia de guardrail para MarketingFlow:
- Reutilizar el patron de scope de Leads/Clientes.
- Para vendedores: solo ver leads propios.
- Para tele: solo leads de vendedores asignados.
- Para admin/distribuidor: acceso total + reasignacion.
