# Skills para Codex — Módulo Cartera / DFP / Cargo de Vuelta / Statements

## 1. Principio general

Este módulo maneja cuentas financieras de clientes. Cualquier cambio puede afectar saldos, intereses, fechas de vencimiento, statements, PDF y comunicación con clientes.

Regla principal para Codex:

**Primero auditar, después proponer, después validar en staging, y solo con autorización explícita avanzar a commit, push o producción.**

Nunca asumir. Nunca modificar producción sin autorización. Nunca cambiar datos históricos sin reporte previo.

---

## 2. Ambientes y seguridad

### Staging autorizado

El staging autorizado para este módulo es:

```text
ahdefxyvfgjkwgkfkaxd
```

Antes de cualquier operación remota, Codex debe verificar el project-ref activo.

Si el project-ref activo no es exactamente:

```text
ahdefxyvfgjkwgkfkaxd
```

debe detenerse inmediatamente.

### Prohibido sin autorización explícita

- No tocar producción.
- No ejecutar `db push` contra producción.
- No correr migraciones destructivas.
- No borrar datos.
- No modificar datos históricos sin reporte previo.
- No hacer commit.
- No hacer push.
- No hacer force push.
- No enviar emails reales a clientes.
- No activar automatizaciones de envío sin aprobación.

---

## 3. Conceptos de negocio

### DFP

DFP significa cuenta financiada directamente por nosotros.

Es una cuenta donde el cliente tiene un balance financiado, APR, pagos, intereses y ciclos de statement.

### Cargo de Vuelta

Cargo de Vuelta es una cuenta que HyCite devuelve después de intentos de cobranza.

HyCite puede dejar la cuenta en cero de su lado y cargar/devolver el balance. Nosotros luego buscamos llegar a un nuevo acuerdo con el cliente para recuperar o refinanciar ese balance.

### Regla clave

Cuando existe un acuerdo aprobado con el cliente, DFP y Cargo de Vuelta deben seguir la misma lógica conceptual para el primer statement:

- acuerdo aprobado
- fecha de aprobación
- statement programado
- due date
- interés diario simple
- pago aplicado
- próximo ciclo mensual

---

## 4. Regla financiera aprobada

Para el primer statement de un acuerdo aprobado:

```text
approval_date = fecha de aprobación del acuerdo
statement_date = approval_date + 10 días
due_date = statement_date + 10 días
due_date = approval_date + 20 días
```

El due date es solo la fecha límite de pago.

El due date no debe ser la fecha final del periodo de interés.

---

## 5. Regla de interés

El interés debe ser diario simple:

```text
interest = principal_pending * APR / 365 * number_of_days
```

Método:

```text
daily_simple_365
```

Para el primer statement:

```text
interest_period_start = approval_date
interest_period_end = statement_date
```

No calcular el interés hasta `due_date`.

No calcular interés sobre:

- intereses acumulados
- late fees
- balance total con cargos
- interés sobre interés

La base del interés debe ser el principal pendiente.

---

## 6. Ejemplo obligatorio de validación — Teresa González

Codex debe usar este ejemplo como prueba de referencia:

```text
principal = 2499.11
APR = 0.18
approval_date = 2025-08-14
```

Resultado esperado:

```text
statement_date = 2025-08-24
due_date = 2025-09-03
interest_period_start = 2025-08-14
interest_period_end = 2025-08-24
interest_days = 10
interest_amount ≈ 12.32
projected_total ≈ 2511.43
```

No debe salir:

```text
statement_date = 2025-08-19
due_date = 2025-08-29
interest_days = 15
interest_amount = 18.49
```

Eso corresponde a la regla vieja y no debe seguir aplicándose.

---

## 7. Regla vieja que debe evitarse

La lógica vieja de Cargo de Vuelta era:

```text
statement_date = approval_date + 5 días
due_date = approval_date + 15 días
interest_period_end = due_date
```

Esta lógica no debe usarse para nuevos agreements.

Debe reemplazarse por:

```text
statement_date = approval_date + 10 días
due_date = statement_date + 10 días
interest_period_end = statement_date
```

---

## 8. Diferencia entre CV y DFP en el sistema

Codex debe recordar que históricamente CV y DFP están implementados por caminos separados.

### Cargo de Vuelta

Usa campos y funciones como:

```text
cv_approval_date
cv_statement_date
cv_due_date
cv_interest_period_start
cv_interest_period_end
cv_projected_interest_amount
cv_projected_total_due
fn_cv_calcular_statement_schedule
fn_cv_calcular_interes_proyectado
fn_cv_resumen_generar
cob_cv_resumenes
cob_cv_resumen_lines
```

### DFP

Usa estructura revolving/ledger:

```text
cob_revolving_accounts
cob_financial_ledger
cob_statements
cob_statement_lines
fn_calcular_due_date
fn_cob_statement_generar
```

DFP puede tener ciclos recurrentes que no deben romperse.

La regla nueva aplica especialmente al primer statement cuando existe un `agreement_date` o fecha de acuerdo aprobado.

---

## 9. Fuente de verdad

La UI no debe inventar fechas financieras.

La fuente de verdad debe ser backend/base de datos.

Frontend debe mostrar:

- approval date
- statement date
- due date
- interest period
- interest amount
- projected total
- statement status
- PDF status
- email status

Si hay lógica duplicada en frontend, Codex debe reportarla y proponer moverla a una función compartida o al backend.

---

## 10. Statements

Un statement debe ser una foto fija del estado financiero en la fecha de corte.

Debe guardar snapshots, no depender de recalcular todo dinámicamente cada vez que se abre.

Un statement debe incluir:

```text
statement_id
customer_id / case_id / account_id
statement_date
due_date
interest_period_start
interest_period_end
principal_balance
interest_amount
late_fees
payments_applied
total_due
minimum_payment o payment_agreement_amount
APR
interest_method
status
created_at
created_by/system
```

---

## 11. Due date

El due date sirve para:

- fecha límite de pago
- seguimiento de cobranza
- alertas
- marcar vencido
- aplicar late fee si la política lo permite

El due date no debe usarse como fecha final del cálculo de interés del statement.

---

## 12. Aplicación de pagos

Cuando se registre un pago, la política recomendada es:

```text
1. late fees
2. interest
3. principal
```

El sistema debe guardar cómo se aplicó el pago.

Ejemplo:

```text
interest_due = 12.32
principal = 2499.11
payment = 150.00

payment_to_interest = 12.32
payment_to_principal = 137.68
new_principal = 2361.43
```

Nunca perder trazabilidad del pago.

---

## 13. Ciclos siguientes

Después del primer statement, los ciclos siguientes deben operar mensualmente:

```text
next_statement_date = previous_statement_date + 1 mes
next_due_date = next_statement_date + 10 días
interest_period_start = previous_statement_date
interest_period_end = next_statement_date
```

El interés debe calcularse sobre el principal pendiente actualizado después de pagos.

Si DFP ya tiene lógica revolving existente, Codex no debe romperla. Debe distinguir entre:

- primer statement por agreement date
- ciclos recurrentes existentes
- statements históricos

---

## 14. PDF

El PDF no debe calcular la lógica financiera principal.

El PDF debe renderizar datos ya calculados y guardados.

El PDF debe mostrar claramente:

```text
Statement Date
Due Date
Interest Period
APR
Interest Method
Principal Balance
Interest Amount
Total Due
Payment Instructions
Customer Information
Company Information
```

Evitar textos incorrectos como:

```text
interés hasta vencimiento
```

Usar textos como:

```text
interés calculado hasta la fecha del statement
```

O:

```text
interés acumulado al corte del statement
```

---

## 15. Automatización de PDF

No activar PDF automático hasta que:

1. La regla financiera esté validada en staging.
2. El ejemplo Teresa salga correcto.
3. El statement manual salga correcto.
4. El PDF manual salga correcto.
5. Exista control para evitar duplicados.

Automatización futura deseada:

```text
1. Job diario busca statements con statement_date = hoy
2. Verifica que no exista statement generado
3. Genera statement
4. Genera PDF
5. Guarda PDF o URL
6. Marca statement como generado
7. Guarda log de auditoría
```

---

## 16. Envío automático por email

No enviar emails reales hasta que exista aprobación explícita.

Antes de activar email automático, Codex debe validar:

```text
1. Cliente tiene email válido
2. Cliente tiene permiso/contactabilidad
3. Statement existe
4. PDF existe
5. No fue enviado antes
6. Hay plantilla aprobada
7. Hay log de envío
8. Hay manejo de error
9. Hay opción de reenvío manual
```

El sistema debe guardar:

```text
statement_id
customer_id
email_to
email_subject
sent_at
status
provider_message_id
error_message
attempt_count
pdf_url / attachment_reference
```

Estados recomendados:

```text
pending
sent
failed
skipped_no_email
skipped_duplicate
manual_resend
```

---

## 17. No duplicados

Todo proceso automático debe ser idempotente.

Si el statement ya fue generado, no generarlo otra vez.

Si el email ya fue enviado, no enviarlo otra vez salvo acción manual autorizada.

Usar constraints, unique keys o locks donde corresponda.

---

## 18. Tests mínimos requeridos

### Cargo de Vuelta

```text
approval_date = 2025-08-14
principal = 2499.11
APR = 0.18

expected:
statement_date = 2025-08-24
due_date = 2025-09-03
interest_days = 10
interest = 12.32
projected_total = 2511.43
```

### APR cero

```text
principal = 2499.11
APR = 0
interest = 0
```

### Principal cero

```text
principal = 0
APR = 0.18
interest = 0
```

### Fecha fin de mes

```text
approval_date = 2025-01-31
statement_date = 2025-02-10
due_date = 2025-02-20
```

### Regla vieja no permitida

Validar que no aparezca:

```text
statement_date = approval + 5
due_date = approval + 15
interest_period_end = due_date
```

### DFP

Validar que DFP con `agreement_date` use primer statement correcto.

Validar que ciclos recurrentes existentes no se rompan.

---

## 19. Auditoría antes de cambios

Antes de modificar, Codex debe entregar:

```text
1. git status --short
2. project-ref activo
3. archivos afectados
4. migraciones relacionadas
5. funciones SQL afectadas
6. componentes frontend afectados
7. tests existentes
8. datos en staging que podrían violar nuevos constraints
9. plan de cambio
10. riesgos
```

---

## 20. Staging antes de producción

Después de aplicar en staging, Codex debe entregar:

```text
1. project-ref confirmado
2. confirmación de que producción no fue tocada
3. migraciones aplicadas
4. backfill realizado, si hubo
5. número de registros afectados
6. resultado del ejemplo Teresa
7. resultado de tests
8. resultado de build
9. capturas o descripción de UI/PDF
10. riesgos pendientes
11. recomendación final
```

---

## 21. Comandos de validación esperados

Codex debe ejecutar, cuando corresponda:

```bash
git status --short
npm run build
npx playwright test tests/e2e/cv-financial-schedule.spec.ts
```

Y las consultas SQL necesarias para validar funciones y datos en staging.

---

## 22. Reglas para migraciones

Toda migración debe ser:

- segura
- reversible cuando sea posible
- no destructiva
- probada en staging
- con comentarios claros
- con backfill explícito si cambia constraints
- sin afectar producción sin autorización

Si hay datos existentes que violan un nuevo constraint, Codex debe reportarlos antes de aplicar el cambio.

---

## 23. Reglas para UI

La UI debe ser clara para el usuario operativo.

Debe evitar lenguaje confuso.

Usar etiquetas como:

```text
Fecha de aprobación
Fecha de statement
Fecha de vencimiento
Periodo de interés
Interés acumulado al statement
Total proyectado
Estado del statement
PDF
Email
```

No usar:

```text
interés hasta vencimiento
```

si el interés termina en statement date.

---

## 24. Reglas para reportes de Codex

Cada reporte debe ser concreto.

Debe incluir:

```text
Qué revisé
Qué encontré
Qué cambié
Qué no toqué
Qué pruebas ejecuté
Qué pasó
Qué riesgos quedan
Cuál es el siguiente paso recomendado
```

No debe decir “listo para producción” si no se validó en staging y no hubo autorización.

---

## 25. Orden correcto de fases

El módulo debe avanzar en este orden:

```text
Fase 1: corregir calendario e interés
Fase 2: validar statement manual
Fase 3: validar PDF manual
Fase 4: automatizar generación de statement/PDF
Fase 5: automatizar envío por email
Fase 6: logs, reintentos y reenvío manual
Fase 7: producción con autorización
```

No saltar fases.

---

## 26. Resumen de la regla final

La regla financiera aprobada es:

```text
statement_date = approval_date + 10 días
due_date = statement_date + 10 días
interest_period_start = approval_date
interest_period_end = statement_date
interest = principal_pending * APR / 365 * days
```

El due date es solo fecha límite de pago.

El PDF muestra el statement.

El email envía el PDF solo cuando todo esté validado y autorizado.

Producción no se toca sin autorización explícita.
