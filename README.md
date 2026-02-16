# FlowSuiteCRM

FlowSuiteCRM es un CRM + plataforma de seguimiento para ventas, postventa/servicio y cartera, diseñado para negocios de venta directa y equipos con alto volumen de clientes.

## Arquitectura (v2)
- **Frontend**: React + Vite + Tailwind (hosting estático)
- **Backend de datos**: **Supabase (Postgres + Auth + RLS + Storage)**
- **Multi-tenant / White-label**:
  - La app siempre muestra **FlowSuiteCRM**
  - Cada organización puede cargar su **logo propio**
  - En documentos/correspondencia: logo de la organización + “Powered by FlowSuiteCRM”

## Principios clave
- Seguridad primero: **RLS obligatorio** antes de conectar el frontend a Supabase.
- Incremental: migraciones SQL **sin drops** (no borrar tablas por default).
- En el pipeline:
  - Mostrar **Producto objetivo**
  - Mostrar **$ solo si hay cierre** (orden/venta confirmada)

## Estructura del repo
- `/frontend` React/Vite UI
- `/supabase` migraciones, policies RLS, seeds
- `/docs` PRD/MVP, arquitectura, auditoría
- `/assets` brand kit y logos
- `/tools` utilidades (importadores, scripts local-only)

> ⚠️ Nunca subir keys, tokens, archivos .env o logs al repo.
