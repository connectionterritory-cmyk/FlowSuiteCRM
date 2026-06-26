# Cartera Phase 1 Follow-ups

Fecha: 2026-06-26

## Alcance pendiente deliberadamente fuera de Phase 1

### 1. Telemercadeo: promesas vencidas

Estado actual:
- `flowsuitecrm/src/modules/telemercadeo/TelemercadeoCarteraPage.tsx` sigue calculando promesas vencidas desde `cob_gestiones.resultado = 'pago_prometido'`.

Motivo:
- En Phase 1 se priorizó integridad operativa del registro canónico de pagos y PTPs.
- Cambiar badges, conteos y filtros de telemercadeo a `cob_ptps` requiere validar impactos en segmentos, seguimiento diario y métricas existentes.

Siguiente paso recomendado:
- Reemplazar la inferencia por lectura directa de `cob_ptps` con estados `pendiente` y `vencido`.
- Mantener `cob_gestiones` solo como historial de contacto, no como lifecycle financiero.

### 2. Superficie legacy duplicada de `/cartera`

Estado actual:
- `flowsuitecrm/src/app/App.tsx` expone `/cartera` con `CarteraPage` case-centric.
- `frontend/src/App.jsx` también expone `/cartera` con una vista legacy basada en `transaccionesrp`.

Riesgo:
- Dos superficies con semántica distinta pueden producir KPIs, listas y prioridades contradictorias.
- La experiencia operativa depende del bundle/app que el usuario esté ejecutando.

Fase separada sugerida:
- Definir cuál superficie queda activa.
- Redirigir o desactivar la legacy con reporte previo y validación funcional.
- Comunicar explícitamente el cambio a operación antes de removerla.
