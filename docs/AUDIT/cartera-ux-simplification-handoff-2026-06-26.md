# Handoff Tecnico — Simplificacion UX Cartera

Date: 2026-06-26
Status: Handoff for implementation by another agent
Scope: UI/UX simplification only

## Objetivo

Implementar la simplificacion visual y operativa del modulo Cartera en:

`flowsuitecrm/src/modules/cartera/CarteraPage.tsx`

La meta es reducir ruido visual, priorizar la accion correcta para el cobrador y reorganizar el detalle del caso sin tocar backend, migraciones ni logica financiera.

Este trabajo debe basarse en el diff plan aprobado, con estos ajustes finales:

- Header simplificado
- Accion recomendada como boton principal
- `PTP` fuera del primer nivel
- `Statement` como accion secundaria solo cuando aplique
- `Registrar pago` condicionado segun contexto
- Menu `Mas` agrupado por categorias
- Estado vacio claro cuando no hay caso seleccionado
- Metricas/KPIs no eliminadas, pero si bajadas de prioridad visual o plegables

## Archivos a tocar

### Permitido

- `flowsuitecrm/src/modules/cartera/CarteraPage.tsx`

### Evitar tocar salvo necesidad real

- componentes compartidos globales
- logica de API
- tipos globales
- utilidades financieras
- Supabase client
- migraciones

## Reglas estrictas

No tocar:

- backend
- migraciones
- produccion
- logica financiera
- calculos de saldo
- calculos de interes
- generacion real de statements
- flujo de autenticacion
- RLS
- datos de staging o produccion
- commits/push sin autorizacion

No operar si el project-ref activo no es:

`ahdefxyvfgjkwgkfkaxd`

Si aparece:

`mrkovgikkgzxjqwcpxyq`

detenerse inmediatamente. No ejecutar limpieza, migraciones, cambios de datos, commit ni push.

## Direccion UX aprobada

### Header del detalle

El header debe quedar reducido a:

1. `Accion recomendada`
2. `Registrar contacto`
3. `Registrar pago`
4. `Mas`

La logica debe ser visual y de presentacion. No crear nuevas reglas financieras profundas.

## Accion recomendada

Debe mostrar la accion mas util segun el estado del caso.

### Casos esperados

#### Sin acuerdo activo

Mostrar como principal:

`Crear acuerdo`

#### Con acuerdo activo y proximo pago pendiente

Mostrar como principal algo tipo:

- `Registrar gestion`
- `Contactar cliente`

#### Con pago vencido

Mostrar accion enfocada en cobranza:

- `Contactar por pago vencido`
- `Registrar contacto`

#### Caso sin informacion suficiente

Mostrar una accion neutral:

`Registrar contacto`

### Nota

No introducir logica nueva de cobranza. La recomendacion debe salir de reglas locales simples usando datos ya presentes en `CarteraPage.tsx`.

## Registrar pago

No debe sentirse siempre como accion principal.

### Regla sugerida

- visible si hay acuerdo activo
- visible si hay saldo recuperable
- visible si hay pagos esperados o historial de pagos
- si no hay acuerdo ni pago esperado, puede mantenerse visible pero con menor prioridad visual o dentro de `Mas`

Objetivo:

Evitar que el cobrador piense que siempre debe registrar pago antes de establecer contacto o acuerdo.

## Crear acuerdo

Debe funcionar asi:

- como `Accion recomendada` cuando no hay acuerdo activo
- dentro de `Mas` cuando ya existe un acuerdo o no es la accion principal

No debe duplicarse innecesariamente en el header.

## PTP

`PTP` no debe estar como boton principal.

Debe quedar absorbido por:

- `Registrar contacto`
- `Crear acuerdo`
- gestion dentro del flujo del acuerdo

Si se mantiene como opcion, debe estar en `Mas`, dentro del grupo de cuenta/acuerdo, no en el primer nivel.

## Statement

`Generar statement` debe moverse fuera del primer nivel.

Debe aparecer en `Mas` solo cuando aplique:

- casos DFP
- casos con statement aplicable
- casos donde el sistema ya tenga soporte visual/logico para statement

No mostrar statement por defecto para todos los cargos de vuelta.

## Menu Mas

El menu `Mas` no debe ser una lista plana larga.

Agrupar visualmente en secciones:

### Comunicacion

- enviar mensaje
- copiar datos de contacto
- registrar intento de contacto

### Cuenta / acuerdo

- crear acuerdo
- refinanciar
- PTP, si todavia existe como accion separada
- ajustes relacionados al acuerdo

### Escalacion

- marcar para revision
- escalar caso
- cambiar prioridad, si existe

### Auditoria / admin

- generar statement
- ver logs
- acciones tecnicas
- opciones solo admin/supervisor, si aplican

## Layout del detalle del caso

Reordenar el contenido del detalle con esta jerarquia:

1. Resumen financiero
2. Acuerdo activo
3. Proximo pago
4. Ultima gestion
5. Historial

La pantalla debe responder primero:

- cuanto se debe
- hay acuerdo
- que pago viene o esta vencido
- que fue lo ultimo que paso
- que debo hacer ahora

## Estado sin caso seleccionado

Debe existir un estado vacio claro.

Cuando no hay caso seleccionado, mostrar un mensaje tipo:

> Selecciona un caso de la lista para ver el resumen, acuerdo activo, proximo pago e historial de gestion.

Evitar que el panel derecho se vea roto, vacio o como si faltara informacion.

## Panel izquierdo

La banda actual de KPIs puede reducirse o reemplazarse visualmente por filtros operativos:

- Todos
- Hoy
- Vencidos
- Sin acuerdo

Pero mantener acceso a metricas para supervisor/admin, idealmente plegable.

Ejemplo:

- `Ver metricas`
- seccion compacta colapsable

No eliminar informacion util de supervision; solo bajarla de prioridad para el cobrador.

## Reglas visuales

Priorizar:

- menos botones visibles
- mas claridad de siguiente accion
- separacion clara entre accion operativa y accion tecnica
- jerarquia visual simple
- evitar duplicacion
- evitar que `Mas` se convierta en desorden

No introducir cambios grandes de diseno global.

## Orden sugerido de implementacion

### Paso 1 — Estado vacio

Implementar o mejorar el estado cuando no hay caso seleccionado.

Validar desktop y movil.

### Paso 2 — Header simplificado

Reducir acciones visibles a:

- Accion recomendada
- Registrar contacto
- Registrar pago
- Mas

Mantener handlers existentes. No reescribir logica profunda.

### Paso 3 — Accion recomendada

Crear helper local simple dentro de `CarteraPage.tsx`, por ejemplo:

`getRecommendedAction(caso, contexto)`

Debe devolver:

- `label`
- `action`
- `tone` o variant visual
- `disabled`

No mover esta logica a backend.

### Paso 4 — Condicionar Registrar pago

Ajustar visibilidad o prioridad segun:

- acuerdo activo
- saldo recuperable
- pago esperado
- historial de pagos

Si los datos no estan disponibles de forma confiable, usar condicion conservadora y no romper el boton.

### Paso 5 — Menu Mas agrupado

Reorganizar acciones secundarias en grupos:

- Comunicacion
- Cuenta/acuerdo
- Escalacion
- Auditoria/admin

Mover ahi:

- PTP
- Refinanciar
- Statement
- acciones tecnicas

### Paso 6 — Reordenar detalle

Ordenar cards/secciones asi:

1. Resumen financiero
2. Acuerdo activo
3. Proximo pago
4. Ultima gestion
5. Historial

No cambiar calculos. Solo reorganizar presentacion.

### Paso 7 — Panel izquierdo y metricas

Cambiar enfoque hacia filtros operativos:

- Todos
- Hoy
- Vencidos
- Sin acuerdo

Mantener metricas en modo plegable o secundario para supervisor/admin.

## QA esperado

Validar al menos estos escenarios:

### 1. Sin caso seleccionado

- se muestra estado vacio claro
- no hay errores en consola
- no aparecen botones sin contexto

### 2. Caso sin acuerdo

- accion recomendada = `Crear acuerdo`
- `PTP` no aparece como boton principal
- `Registrar contacto` esta visible
- `Registrar pago` no domina visualmente

### 3. Caso con acuerdo activo

- se muestra acuerdo activo arriba del historial
- proximo pago visible
- `Registrar pago` visible o accesible
- `Crear acuerdo` no debe duplicarse como accion principal

### 4. Caso con pago vencido

- la accion recomendada debe orientar a contacto/cobranza
- proximo pago o vencimiento debe verse sin buscar en historial

### 5. Caso DFP con statement aplicable

- `Statement` aparece dentro de `Mas`
- no aparece como boton principal

### 6. Cargo de vuelta sin statement aplicable

- `Statement` no debe destacarse
- si no aplica, no mostrarlo o dejarlo deshabilitado con claridad

### 7. Menu Mas

- acciones agrupadas visualmente
- no queda una lista plana confusa
- PTP/refinanciar/statement quedan fuera del primer nivel

### 8. Mobile

- header no se rompe
- acciones principales caben o colapsan bien
- el detalle mantiene jerarquia clara

## Criterio de aceptacion

El cambio pasa si:

- el cobrador puede entender en menos de 5 segundos que hacer con el caso
- el header ya no parece una barra tecnica llena de botones
- `PTP` no aparece como accion principal
- `Statement` no aparece para todos los casos
- `Registrar pago` no domina cuando no hay acuerdo ni pago esperado
- la informacion critica aparece antes del historial
- no se toca backend, migraciones ni produccion
- no hay errores nuevos en consola
- no hay cambios de logica financiera

## Riesgos

- esconder una accion usada con frecuencia por usuarios avanzados
- duplicar `Crear acuerdo` si aparece como recomendada y tambien en tarjeta/menu
- mover tabs tecnicos demasiado abajo y generar resistencia en usuarios actuales
- convertir `Mas` en un contenedor demasiado largo
- accion recomendada imprecisa por datos incompletos

## Mitigaciones

- no eliminar acciones, solo reubicarlas
- mantener `Mas` siempre visible
- mantener tabs tecnicos disponibles durante transicion
- implementar recomendacion con reglas simples y explicables
- validar visualmente con casos sin acuerdo, con acuerdo, vencidos, DFP, cargo de vuelta y cerrados

## Nota final

Este cambio es una fase UX. El objetivo no es perfeccionar la logica de cobranza todavia, sino mejorar la experiencia operativa usando los datos y handlers existentes.

Cualquier mejora profunda de estados financieros, reglas de statement, reglas de promesa de pago o automatizacion debe quedar para una fase posterior.
