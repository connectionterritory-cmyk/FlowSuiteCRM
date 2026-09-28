# Instrucciones para agentes

## Royal Prestige

Antes de cualquier trabajo sobre el flujo RP, leer
`docs/rp/FLOW-MAESTRO-RP.md`. Respetar la fase autorizada y auditar primero
la lógica y módulos existentes para reutilizarlos y evitar duplicación.

## Disciplina de cambios

Aplicar cambios mínimos y verificables: pensar antes de modificar, evitar
sobreingeniería, mantener el scope quirúrgico y definir evidencia de éxito.

Las reglas completas están en `CLAUDE.md` § Disciplina de cambios.

## Análisis estructural

Antes de tocar código compartido, usar CodeGraph (MCP o CLI
`codegraph explore`) para revisar dependientes y blast radius.

Si aparece una dependencia cross-domain inesperada, detenerse y reportar
antes de ampliar el scope.

Las reglas completas están en `CLAUDE.md` § CodeGraph / Structural Analysis.
