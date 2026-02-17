# Risks & Mitigations

## Seguridad
- **Riesgo:** RLS OFF en tablas críticas ⇒ fuga de datos multi-tenant.
  **Mitigación:** habilitar RLS + policies por `membership` antes de conectar frontend.

## Integridad multi-tenant
- **Riesgo:** faltan `org_id` y backfill ⇒ mezcla de datos.
  **Mitigación:** migraciones incrementales con backfill controlado y auditoría.

## Data duplicada
- **Riesgo:** campos duplicados en `contactos` (ES/EN).
  **Mitigación:** crear `contactos_canonical` sin borrar columnas.

## Alcance MVP
- **Riesgo:** agregar extras fuera del MVP.
  **Mitigación:** limitar a módulos A–F definidos, backlog separado para extras.

## UI/UX (Safari legacy)
- **Riesgo:** bajo contraste u opacidades en Kanban.
  **Mitigación:** tokens de color con contraste alto, sin opacidades bajas.

## Deploy
- **Riesgo:** SPA rewrite mal configurado ⇒ 404 en rutas.
  **Mitigación:** `.htaccess` SPA rewrite verificado.

## Datos financieros
- **Riesgo:** Cartera >90 y “cargo de vuelta” sin reglas claras.
  **Mitigación:** reglas explícitas en tabla y UI; PTP requerido.
