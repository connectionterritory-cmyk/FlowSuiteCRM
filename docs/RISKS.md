# Risks & Mitigations

## Seguridad
- **Riesgo:** RLS OFF en tablas criticas -> fuga de datos multi-tenant.
  **Mitigacion:** habilitar RLS + policies por `membership` antes de conectar frontend.

## Integridad multi-tenant
- **Riesgo:** faltan `org_id` y backfill -> mezcla de datos.
  **Mitigacion:** migraciones incrementales con backfill controlado y auditoria.

## Data duplicada
- **Riesgo:** campos duplicados en `contactos` (ES/EN).
  **Mitigacion:** crear `contactos_canonical` sin borrar columnas.

## Alcance MVP
- **Riesgo:** agregar extras fuera del MVP.
  **Mitigacion:** limitar a modulos A-F definidos, backlog separado para extras.

## UI/UX (Safari legacy)
- **Riesgo:** bajo contraste u opacidades en Kanban.
  **Mitigacion:** tokens de color con contraste alto, sin opacidades bajas.

## Deploy
- **Riesgo:** SPA rewrite mal configurado -> 404 en rutas.
  **Mitigacion:** `.htaccess` SPA rewrite verificado.

## Datos financieros
- **Riesgo:** Cartera >90 y "cargo de vuelta" sin reglas claras.
  **Mitigacion:** reglas explicitas en tabla y UI; PTP requerido.
