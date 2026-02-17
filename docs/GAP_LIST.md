# GAP List — MVP v2 (Solo MVP acordado)

## A) Pipeline Kanban
- Falta frontend completo (routing, UI, data).
- Falta enforcement de regla: “producto objetivo siempre visible”.
- Falta regla de “$ solo cierre ganado u orden confirmada”.

## B) Cliente/Contacto 360
- No existe pantalla ni tabs.
- Falta data model para tabs nuevas (órdenes/servicio/agua/cartera/notas).
- Falta vista `contactos_canonical`.

## C) Servicio/Postventa (multi-producto)
- Faltan tablas: `servicios`, `servicio_items`, `cliente_productos`.
- Falta UI y flujos mínimos (crear ticket, items, estados).

## D) Agua (scheduler)
- Faltan tablas: `agua_sistemas`, `agua_componentes`, `agua_reglas`,
  `cliente_sistemas`, `cliente_componentes`.
- Faltan seeds de reglas (FrescaFlow, FrescaPure 3000/5500, Ducha).
- Faltan vistas: Hoy / 7 días / 30 días / Vencidos.

## E) Cartera (Aging + Cargo de vuelta)
- Faltan tablas: `cob_gestiones`, `cargo_vuelta_cases`, `rp_import_batches`.
- Falta lógica aging + “próxima acción”.
- Falta regla >90 días => caso “Cargo de vuelta” + PTP.

## F) Team Hub básico
- Falta módulo y tablas (canales, anuncios).

## Multi-tenant & Seguridad
- RLS ON solo en `profiles`; resto OFF => gap crítico.
- Falta `organizations`, `memberships`, `org_branding`, `plan_limits`.
- Falta `org_id` en tablas core y backfill.

## Deploy
- Falta documentación concreta en repo.
- Falta `.htaccess` y proceso build en el repo (si aplica).
