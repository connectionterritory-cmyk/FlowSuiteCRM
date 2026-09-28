# FlowSuiteCRM — Proyecto

## Prioridad actual
Construir el módulo de cartera/cobranza priorizando operación real, reutilización y compatibilidad con n8n.

## Reglas de arquitectura
- El caso es la entidad central del módulo de cartera.
- `clientes` es la ficha maestra del cliente, no el workflow de cobranza.
- Hy-Cite es la fuente de verdad del saldo externo.
- FlowSuiteCRM es la fuente de verdad operativa de gestiones, PTPs, planes de pago y automatizaciones.
- No mezclar cartera con pipeline comercial.

## Disciplina de cambios

### 1. Pensar antes de modificar

No asumir silenciosamente cuando exista ambigüedad relevante.

Antes de implementar:
- identificar qué se está intentando resolver;
- identificar el dominio afectado;
- exponer supuestos relevantes;
- distinguir hechos verificados de inferencias;
- detenerse y preguntar cuando una ambigüedad pueda cambiar la arquitectura,
  el alcance o el comportamiento esperado.

No ocultar incertidumbre eligiendo una interpretación arbitraria.

### 2. Simplicidad primero

Implementar la solución mínima que resuelva completamente el problema verificado.

No agregar:
- features no solicitadas;
- abstracciones especulativas;
- capas de flexibilidad sin necesidad actual;
- refactors no requeridos para resolver el objetivo.

La simplicidad aplica al código final, NO al análisis de impacto previo.

Un cambio puede requerir análisis amplio y terminar correctamente en pocas líneas.

Por tanto, esta regla nunca elimina ni reduce el blast-radius obligatorio de
CodeGraph para código SHARED.

### 3. Cambios quirúrgicos

Tocar únicamente lo necesario para cumplir el objetivo aprobado.

No:
- refactorizar código adyacente porque "podría mejorarse";
- reformatear archivos fuera del scope;
- renombrar elementos no relacionados;
- corregir deuda técnica no requerida;
- ampliar silenciosamente el alcance.

Cada línea modificada debe poder relacionarse razonablemente con el objetivo
del cambio.

Sí se permite limpiar imports, variables u otros residuos creados directamente
por el propio cambio.

Si durante la implementación aparece otro problema real fuera del scope:
documentarlo y reportarlo; no incorporarlo silenciosamente al cambio actual.

### 4. Ejecución orientada a objetivos

Antes de implementar una tarea no trivial, definir cómo se comprobará que está
terminada.

Preferir objetivos verificables:

BUG
→ reproducir
→ corregir
→ verificar que ya no se reproduce.

FEATURE
→ definir comportamiento esperado
→ implementar
→ verificar comportamiento.

REFACTOR
→ definir comportamiento que debe preservarse
→ modificar
→ verificar que permanece intacto.

Para tareas multi-step:
PLAN
→ IMPLEMENT
→ VERIFY
→ REVIEW.

La implementación no se considera terminada únicamente porque el código fue
escrito.

Debe existir evidencia proporcional al riesgo: tests, build, lint scoped,
CodeGraph impact check, QA o revisión independiente según corresponda.

## CodeGraph / Structural Analysis

FlowSuiteCRM tiene CodeGraph indexado en `flowsuitecrm/` (`.codegraph/`, gitignored).

Antes de modificar un símbolo compartido — especialmente en
`src/components/`, `src/hooks/`, `src/lib/`, `src/modals/`, `src/data/`
o `src/app/` — consultar CodeGraph para revisar callers, dependencias y
blast radius ANTES de editar.

También es obligatorio consultar CodeGraph antes de:
- cambiar la firma de una función o componente exportado;
- eliminar o renombrar un archivo, componente, hook o export;
- realizar cambios que puedan cruzar los dominios RP, CARTERA o SHARED.

Usar `codegraph_explore` vía MCP o `codegraph explore "<símbolo>"` vía CLI.

Antes de confiar en el grafo:
- ejecutar `codegraph status`;
- si el índice está stale, ejecutar `codegraph sync`.

Si el blast radius revela una dependencia cross-domain inesperada entre
RP, CARTERA o SHARED, detenerse y reportarla antes de ampliar el alcance
del cambio.

CodeGraph NO reemplaza:
- revisión de SQL o Supabase migrations;
- RLS;
- contratos RPC;
- comportamiento runtime de Edge Functions;
- tests;
- lógica de negocio documentada;
- revisión independiente;
- aprobación humana.

Taxonomía de dominio previa a cualquier cambio:
RP / CARTERA / SHARED / INFRA / UNKNOWN.

Si el cambio toca SHARED, el blast-radius de CodeGraph es obligatorio.

Flujo recomendado:

REQUEST
→ DOMAIN IDENTIFICATION
→ CODEGRAPH EXPLORE
→ BLAST RADIUS
→ SCOPE DEFINITION
→ IMPLEMENTATION
→ TESTS
→ CODEGRAPH IMPACT RECHECK
→ INDEPENDENT REVIEW
→ HUMAN APPROVAL
→ COMMIT
→ PRODUCTION APPROVAL
→ PUSH MAIN
→ VERCEL AUTO-DEPLOY
→ PRODUCTION SMOKE

Importante: `git push origin main` puede disparar automáticamente un
deployment de producción en Vercel. Por tanto, push a `main` requiere
aprobación explícita de producción.

## Decisiones de arquitectura tomadas

### llamadas_telemercadeo vs cob_gestiones (2026-04-25)
- `cob_gestiones` es la tabla canónica de gestiones de cobranza.
- `TelemercadeoCallModal` ya escribe solo en `cob_gestiones` (Paso 1).
- `TelemercadeoCarteraPage` ya lee solo desde `cob_gestiones` (Paso 2).
- **`EnviosPage` sigue escribiendo en `llamadas_telemercadeo`** para `pago_prometido` de campañas WhatsApp — esto es intencional. Las respuestas de campaña son contexto de marketing, no gestiones de cobranza. No mezclar hasta que exista lógica explícita para abrir/actualizar un caso desde ese flujo.
- `TelemercadeoCallModal` todavía lee `llamadas_telemercadeo` para mostrar historial legacy en el modal. No eliminar esa lectura sin backfill previo.
- 16 clientes tienen historial solo en `llamadas_telemercadeo` (sin caso activo hoy). Pendiente backfill opcional.

## Reutilizar primero
- clientes
- cob_gestiones
- llamadas_telemercadeo (legacy — solo lectura de historial y escritura de campañas WhatsApp)
- cargo_vuelta_cases
- contacto_actividades
- outbox_messages
- message_templates
- TelemercadeoCarteraPage
- TelemercadeoCallModal
- ContactoTimeline
- MessageModal
- MessagingProvider

## Huecos conocidos
- falta tabla de pagos
- falta plan de pagos con cuotas
- falta detalle de caso
- consolidación llamadas_telemercadeo → cob_gestiones: escritura y lectura principal migradas; pendiente backfill 16 clientes legacy y decisión final sobre EnviosPage
- falta RLS granular para cobrador
- falta PTP como entidad formal

## Estilo de trabajo
- Para trabajo Royal Prestige, leer primero `docs/rp/FLOW-MAESTRO-RP.md`;
  trabajar únicamente la fase autorizada y auditar/reutilizar antes de crear.
- no inventes tablas ni archivos existentes
- cita rutas exactas
- haz primero auditoría rápida antes de cambiar
- propone MVP antes de arquitectura completa
- cuando hagas migraciones, explica impacto y rollback
