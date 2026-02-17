# Migration Plan — Incremental (No drops, no refactors masivos)

## Fase 1 — Audit (ya realizado, sin cambios)
- Inventario repo + Supabase (snapshot).
- Documentos de gap.

## Fase 2 — Supabase (migraciones idempotentes)
1) Crear multi-tenant core:
   - `organizations`, `memberships`, `org_branding`, `plan_limits`.
2) Agregar `org_id` a tablas core UI:
   - `clientes`, `contactos`, `oportunidades`, `ordenesrp`, `ordenitemsrp`,
     `enviosrp`, `cuentarp`, `transaccionesrp`, `mensajescrm`, `notasrp`,
     `auditoriaacciones`, `programas*`, `referidos*`.
   - Backfill incremental (sin borrar data).
3) RLS ON en tablas UI + policies por `membership`.
4) Crear vista `contactos_canonical` (sin borrar columnas duplicadas).
5) Tablas MVP nuevas:
   - Servicio: `servicios`, `servicio_items`, `cliente_productos`.
   - Agua: `agua_sistemas`, `agua_componentes`, `agua_reglas`,
     `cliente_sistemas`, `cliente_componentes` + seeds reglas.
   - Cartera: `cob_gestiones`, `cargo_vuelta_cases`, `rp_import_batches`.
   - DFP (add-on): `dfp_contracts`, `dfp_installments`, `dfp_payments`.

## Fase 3 — Frontend (Vite/React)
- Agregar Tailwind + shadcn/ui + fonts (Space Grotesk, Instrument Sans).
- Supabase Auth + contexto de org.
- Pantallas mínimas: Pipeline, Cliente360, Servicio, Agua, Cartera, Team Hub.
- Reglas UI:
  - “Producto objetivo” siempre visible.
  - “$” solo si cierre=Ganado u orden confirmada.
  - Alto contraste; sin opacidades bajas en Kanban.

## Fase 4 — Deploy (Namecheap)
- `vite build` => `dist/`
- `.htaccess` con SPA rewrite a `index.html`
- Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## DoD (Definition of Done)
- Migraciones re-ejecutables sin romper.
- RLS ON + policies por org en tablas UI.
- Flujo extremo a extremo:
  oportunidad → cierre/orden → producto/servicio → scheduler agua →
  vencidos → gestión cartera.
- Build frontend OK y navegación completa.
