# FlowSuiteCRM v2 — Audit Report (MVP)

Fecha: 2026-02-16
Modo: AUDIT-ONLY (sin cambios)

## 1) GitHub / Repo
**Estructura**
- `/frontend/` Vite + React template base.
- `/supabase/` solo placeholders: `migrations/`, `policies/`, `seeds/` con `.gitkeep`.
- `/docs/` vacío (solo `.gitkeep`).
- `/assets/` y `/tools/` placeholders.

**Packages & scripts**
- `frontend/package.json`: `react`, `react-dom`. Scripts: `dev`, `build`, `lint`, `preview`.

**Rutas/Modulos**
- No hay rutas de app. `App.jsx` es template Vite.
- No hay código de Supabase ni auth.

## 2) Frontend (React/Vite)
**Estado**
- Template Vite sin routing, sin auth, sin Supabase client.
- No hay pantallas MVP.

**UI/UX**
- No hay tokens de UI (tipografías/paleta).
- No hay ajustes Safari ni contraste alto.
- Sin Kanban ni módulos de CRM.

## 3) Supabase
**Snapshot (provisto por usuario)**
Tablas existentes:
- `clientes`, `contactos`, `oportunidades`, `ordenesrp`, `ordenitemsrp`, `enviosrp`,
  `cuentarp`, `transaccionesrp`, `mensajescrm`, `notasrp`, `auditoriaacciones`,
  `programas*`, `referidos*`, `usuarios`, `sesiones`, `profiles`.

RLS:
- ON solo en `profiles`.
- OFF en el resto.

Policies:
- Solo `profiles`.

Triggers:
- En `oportunidades` y `profiles`.

**Observaciones**
- No hay tablas de multi-tenant (`organizations`, `memberships`, etc.).
- No hay vistas canonicalizadas (`contactos_canonical`).
- No hay tablas MVP nuevas (servicio/agua/cartera/team hub/dfp).

## 4) Hosting (Namecheap)
**Supuesto (provisto por usuario)**
- Hosting estático para frontend: `crm.flowiadigital.com`.
- SPA rewrite con `.htaccess` hacia `index.html`.
- Variables de entorno: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Sin backend Node ni rutas `/api`.

## Conclusión
- Repo en estado "bootstrap": frontend template y carpeta supabase vacía.
- Supabase real existe fuera del repo; RLS incompleto para multi-tenant.
- MVP v2 requiere construcción incremental en DB + UI + deploy.
