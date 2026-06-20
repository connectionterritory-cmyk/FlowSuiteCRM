# ADR: CWG Business Hub Fase 1

## 1. Estado
**Propuesto / Pending Approval**

## 2. Contexto
FlowSuiteCRM ya funciona como aplicación principal autenticada y cuenta con piezas reutilizables para un portal madre:
- routing protegido en [App.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/app/App.tsx)
- navegación centralizada en [navigation.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/app/navigation.ts)
- shell responsivo en [AppShell.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/app/layouts/AppShell.tsx)
- sidebar y bottom nav en [Sidebar.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/components/Sidebar.tsx) y [BottomNav.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/components/BottomNav.tsx)
- widgets reutilizables como [StatCard.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/components/StatCard.tsx), [AgendaHoy.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/components/AgendaHoy.tsx), [useDashboardMetrics.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/hooks/useDashboardMetrics.ts) y [useConversionKpis.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/hooks/useConversionKpis.ts).

Objetivo de Fase 1:
- agregar una landing page post-login en `/hub`
- reorganizar navegación por líneas de negocio
- mantener intactas las rutas existentes
- no tocar schema Supabase, Edge Functions ni módulos legacy funcionales

Hallazgos del estado actual:
- Existe una ruta duplicada de `/citas` en [App.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/app/App.tsx).
- El redirect post-login actual apunta a `/dashboard`.
- La navegación actual mezcla elementos CRM, RP y administración dentro de un bloque general `mas`.
- El repo real usa `flowsuitecrm/src/...`, no `src/...` en la raíz. Cualquier implementación futura debe apuntar a esa carpeta.

## 3. Decisión
Se adopta `/hub` como nueva ruta de inicio post-login para Fase 1.

Principios:
- `/dashboard` se mantiene operativo durante la transición.
- `/hub` se implementa como orquestador de componentes existentes y placeholders claros para capacidades futuras.
- Las líneas de negocio futuras se muestran desde Fase 1 en navegación con estado visual `disabled`, `coming_soon` o `requires_license`.
- La implementación futura debe ser additive-only: no eliminar rutas ni romper flujos actuales.

## 4. Ruta y comportamiento de acceso
Ruta nueva propuesta:
- `/hub`

Comportamiento:
- usuario autenticado entra por `/hub`
- `/dashboard` sigue accesible como ruta secundaria
- `/` y `*` redirigen a `/hub` cuando hay sesión

Motivos para elegir `/hub`:
- `/dashboard` ya tiene semántica y lógica propias
- `/hub` evita ambiguedad con `inicio`
- permite transición controlada sin deprecación inmediata

## 5. Composición funcional del Hub
La `HubPage` debe contener:
- `HubHeader`: saludo personalizado, branding "CWG Business Hub" y subtítulo "Powered by FlowSuite CRM"
- fila 1 de métricas operativas: leads nuevos, citas de hoy, tareas pendientes
- fila 2 de métricas de comisiones: placeholders `—` en Fase 1
- `BusinessUnitGrid`: tarjetas de Royal Prestige, Telecom, Seguros y Servicios Financieros
- `AgendaHoy`: reutilización directa del componente actual
- `QuickActionsGrid`: accesos rápidos a rutas ya existentes

Wireframe base:
- hero corto con resumen del día
- dos filas de stats
- grid de líneas de negocio 2x2 en desktop y 1 columna en mobile
- agenda de hoy
- acciones rápidas

## 6. Arquitectura de navegación propuesta
Desktop sidebar:
- `Inicio`: Hub, Hoy, Inbox
- `CRM`: Leads, Clientes, Pipeline, Citas, Campo
- `Royal Prestige`: Ventas, Catálogo, Cartera, Cobranza, Marketing, Programas
- `Telecom`: placeholder `Próximamente`
- `Seguros`: placeholder `Requiere licencia`
- `Finanzas`: placeholder `Próximamente`
- `Comisiones`: placeholder `Próximamente`
- `Entrenamiento`: placeholder `Próximamente`
- `Administración`: Usuarios, Importaciones, Servicio al Cliente

Mobile bottom nav:
- Hub
- Leads
- botón `+`
- Clientes
- Más

Nota de aterrizaje al repo:
- hoy el último tab es `Inbox`, no `Más`
- para soportar el diseño propuesto, el patrón esperado es conservar la apertura del drawer/sidebar desde mobile y mover esa acción al quinto tab

## 7. Datos permitidos en Fase 1
Fuentes ya existentes que sí pueden alimentar el Hub:
- `leads`: nuevos
- `citas`: del día
- `crm_tareas`: pendientes
- `ventas`: recientes
- `clientes`: mora
- `conversations` o `inbox_tasks`: pendientes

Reglas:
- no crear migraciones nuevas
- no depender de auth compartida con Izzyphone
- comisiones quedan como placeholder visual hasta Fase 4
- `AgendaHoy` se reutiliza sin reescritura

## 8. Aterrizaje técnico al repo actual
Archivos existentes a modificar en futura implementación:
- [App.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/app/App.tsx): agregar `/hub`, cambiar redirect default a `/hub`, eliminar duplicado de `/citas`
- [navigation.ts](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/app/navigation.ts): reorganizar grupos y placeholders
- [Sidebar.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/components/Sidebar.tsx): soportar disabled badges y futura noción de `business_unit`
- [BottomNav.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/components/BottomNav.tsx): reemplazar primer tab por Hub y redefinir quinto tab como `Más`
- [AppShell.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/app/layouts/AppShell.tsx): incluir `/hub` en títulos
- [icons.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/components/icons.tsx): agregar iconografía de negocio faltante

Archivos nuevos propuestos:
- `flowsuitecrm/src/modules/hub/HubPage.tsx`
- `flowsuitecrm/src/modules/hub/HubHeader.tsx`
- `flowsuitecrm/src/modules/hub/BusinessUnitCard.tsx`
- `flowsuitecrm/src/modules/hub/BusinessUnitGrid.tsx`
- `flowsuitecrm/src/modules/hub/QuickActionsGrid.tsx`
- `flowsuitecrm/src/modules/hub/useHubStats.ts`
- `flowsuitecrm/src/modules/hub/hub.types.ts`

Fuera de alcance en Fase 1:
- `DashboardPage.tsx`
- schema Supabase
- Edge Functions
- tablas `izzy_*`
- auth PIN de Izzyphone
- `user_business_access`
- refactors grandes de cartera o telemercadeo

## 9. Divergencias detectadas frente al borrador original
Para evitar una implementación equivocada, se registran estos ajustes:
- la ruta real del código es `flowsuitecrm/src`, no `src`
- existe `IconDashboard` en [icons.tsx](/Users/connectionworldwidemoisescaicedo/Desktop/FlowSuiteCRM/flowsuitecrm/src/components/icons.tsx), por lo que no hace falta crearlo
- el documento sugiere eliminar `frontend/` legacy, pero eso no debe ejecutarse automáticamente en esta fase de diseño porque es un cambio de repo separado del Hub
- el estado actual del bottom nav no tiene tab `Más`; esa parte requiere una decisión de UX/implementación explícita, no solo un rename de labels

## 10. Riesgos y mitigaciones
- Duplicidad `/dashboard` vs `/hub`
  Mitigación: mantener ambas rutas en Fase 1 y mover solo el redirect por defecto.
- Datos incompletos en tarjetas
  Mitigación: `useHubStats` debe devolver loading, error y placeholders seguros.
- Sidebar más largo
  Mitigación: grupos nuevos inician colapsados.
- Dependencia temprana de Izzyphone
  Mitigación: ningún dato `izzy_*` en Fase 1.
- Deriva entre diseño y repo real
  Mitigación: implementar únicamente sobre `flowsuitecrm/src` y tomar este ADR como fuente de verdad.

## 11. Orden recomendado de implementación
1. Corregir duplicado de `/citas`.
2. Crear tipos y hook del Hub.
3. Crear componentes visuales del módulo `hub`.
4. Componer `HubPage`.
5. Conectar `/hub` al router y redirect post-login.
6. Actualizar títulos del shell.
7. Reorganizar navegación desktop.
8. Adaptar bottom nav mobile.
9. Agregar placeholders visuales y badges para líneas futuras.
10. QA manual de rutas existentes, roles y mobile.

## 12. Checklist previo a implementación
- [ ] Aprobado que Fase 1 es additive-only
- [ ] Aprobado `/hub` como nuevo default post-login
- [ ] Validado que `/dashboard` se mantiene visible en transición
- [ ] Validada estrategia de mobile tab `Más`
- [ ] Confirmado que no habrá migraciones ni cambios Supabase
- [ ] Confirmado que `frontend/` legacy queda fuera del PR del Hub
- [ ] Confirmado copy final de branding CWG

## 13. Notas de alcance
Este ADR documenta diseño técnico y adaptación al repo real. No ejecuta implementación, no modifica rutas productivas y no implica cambios de datos.
