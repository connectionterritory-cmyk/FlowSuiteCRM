# Runbook — Statement real de Martha Ocon, 2026-07-25

**Solo ejecutar este runbook el 2026-07-25 o después.** No antes; el ciclo cierra ese día.

## Datos fijos de referencia

- `case_id` (Cargo de Vuelta): `0bea0f30-a593-419b-8bfa-4f5f49996621`
- `revolving_account_id`: `b94f97c5-a1a1-4597-8d56-7eb36fff9eab`
- `cliente_id`: `c412ad34-cb42-4c9c-9b4b-a567a91ba249`
- `acuerdo_id` (pago mínimo $100/mes, borrador): `469dce1d-a27d-434a-8dfb-f3ce4e3a35a4`
- Ciclo: `2026-07-04` → `2026-07-25`, corte `2026-07-25`
- Usuario para `set_config` / `auth.uid()` en llamadas RPC: `df37164a-0306-4183-85cf-38074059afec` (Moisés)
- `x-worker-secret` de los Edge Functions: `c93f0788596c831e23020e23971924b84d91b1fe4ade27c0bb8a2cb4243bd1ea`

## Nota crítica antes de empezar

**NO usar `test_email_override` en ningún paso de este runbook.** Ese día el envío es real, a Martha Ocon directamente. `test_email_override` fue solo para las pruebas de diseño con el statement de Johanna Gonzalez y no debe aparecer en el `curl` del paso 4.

## Paso 1 — Prechecks

Confirmar que no existe ya un statement para este período para evitar duplicados:

```sql
SELECT id, periodo_inicio, periodo_fin, status
FROM cob_statements
WHERE revolving_account_id = 'b94f97c5-a1a1-4597-8d56-7eb36fff9eab'
  AND periodo_inicio = '2026-07-04'
  AND periodo_fin = '2026-07-25';
```

Debe devolver `0` filas. Si devuelve una fila, detenerse: ya se generó y no hay que reejecutar el paso 2.

Confirmar balance actual de la cuenta:

```sql
SELECT saldo_principal_actual, saldo_interes_actual, saldo_total_actual, fecha_ultimo_devengo
FROM cob_revolving_accounts
WHERE id = 'b94f97c5-a1a1-4597-8d56-7eb36fff9eab';
```

## Paso 2 — Devengar interés hasta el corte y generar el statement

```sql
SELECT set_config('request.jwt.claims', json_build_object('sub','df37164a-0306-4183-85cf-38074059afec')::text, true);

SELECT public.fn_devengar_interes_revolving(
  'b94f97c5-a1a1-4597-8d56-7eb36fff9eab'::uuid,
  '2026-07-25'::date
);
```

Luego, en la misma sesión o repitiendo el `set_config` si es una llamada nueva:

```sql
SELECT set_config('request.jwt.claims', json_build_object('sub','df37164a-0306-4183-85cf-38074059afec')::text, true);

SELECT public.fn_cob_statement_generar(
  'b94f97c5-a1a1-4597-8d56-7eb36fff9eab'::uuid,
  '2026-07-04'::date,
  '2026-07-25'::date,
  '2026-07-25'::date
) as statement_id;
```

Guardar el `statement_id` que devuelve; se usa en los pasos 3 y 4.

## Paso 3 — Validar el registro generado antes de enviar

```sql
SELECT id, periodo_inicio, periodo_fin, fecha_corte, fecha_vencimiento,
       balance_previo, compras_periodo, pagos_periodo, cargos_interes_periodo,
       nuevo_balance, pago_minimo, status
FROM cob_statements
WHERE id = '<statement_id del paso 2>';
```

Verificar a ojo:

- `pago_minimo` debe ser `$100.00` o menos si el balance restante es menor a `$100`.
- `pago_minimo` nunca debe ser igual a `nuevo_balance` completo, salvo que el balance ya sea `<= $100`.
- `fecha_vencimiento` debe ser aproximadamente `21` días después del `2026-07-25`, es decir cerca de `2026-08-15`.
- `nuevo_balance` debe ser coherente con el balance revisado en el paso 1 más el interés del período.

Si algo no cuadra, no continuar al paso 4.

## Paso 4 — Envío real

**Sin `test_email_override`.**

```bash
curl -X POST 'https://rxiarmbosgivaplygqug.supabase.co/functions/v1/send-cv-statement' \
  -H 'Content-Type: application/json' \
  -H 'x-worker-secret: c93f0788596c831e23020e23971924b84d91b1fe4ade27c0bb8a2cb4243bd1ea' \
  -d '{"statement_id":"<statement_id del paso 2>"}'
```

Respuesta esperada:

```json
{"ok":true,"email_to":"mjazmina65@gmail.com","pdf_storage_path":"...","test_mode":false}
```

No debe venir `skipped`.

## Paso 5 — Verificación final

```sql
SELECT status, enviado_at, pdf_url
FROM cob_statements
WHERE id = '<statement_id>';
```

Esperado:

- `status = 'enviado'`
- `enviado_at` con timestamp del día
- `pdf_url` con ruta real, no `_test/...`

```sql
SELECT document_type, email_to, email_status, email_sent_at, pdf_storage_path
FROM statement_delivery_logs
WHERE document_type = 'dfp_statement'
  AND document_id = '<statement_id>';
```

Esperado:

- `1` fila
- `email_status = 'sent'`
- `email_to = 'mjazmina65@gmail.com'`

Si ambas verificaciones salen bien, el statement mensual de Martha quedó enviado correctamente.
