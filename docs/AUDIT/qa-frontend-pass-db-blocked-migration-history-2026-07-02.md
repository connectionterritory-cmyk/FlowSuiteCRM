# QA Frontend PASS / DB Blocked by Divergent Migration History

Date: 2026-07-02

## Resumen ejecutivo

Commits evaluados:

- `76d6815 feat(clientes): add customer opportunity MVP`
- `5af14b8 fix(outbox): guard real dispatch and retry whatsapp`

Resultado:

- Frontend QA: PASS
- Build: PASS
- Playwright local con Supabase mockeado: PASS
- DB funcional real: BLOQUEADA

Razón del bloqueo DB:

- El staging autorizado `ahdefxyvfgjkwgkfkaxd` tiene historial de migraciones divergente frente al árbol local `flowsuitecrm/supabase/migrations`.
- `supabase migration list` muestra pocas migraciones registradas en remoto y muchas migraciones locales pendientes, incluyendo duplicados semánticos y una migración con PII fuera de scope.
- Bajo estas condiciones no es seguro usar `supabase db push`, `supabase migration repair` ni SQL manual sin autorización puntual separada.

## Evidencia QA frontend

Validaciones completadas:

- `npm run build` OK
- Validación JSON de `docs/n8n/cargo_vuelta_recordatorio_diario.json` OK
- `rg "dia_1|dia_2|dia_3|dia_4|dia_8_plus" docs/n8n/cargo_vuelta_recordatorio_diario.json` sin matches
- Playwright local OK con Supabase completamente mockeado
- `/clientes` OK
- `/oportunidades-cliente` OK
- navegación cliente -> oportunidades OK
- fallback por columnas faltantes OK
- errores operativos visibles sin pantalla rota OK
- `VITE_ENABLE_REAL_OUTBOX_DISPATCH` no está en `true`
- dispatch real bloqueado por flag
- invocaciones a `dispatch-outbox-message`: `0`
- no hubo WhatsApp real, email real, Evolution real ni `provider_message_id` real

Estado de los commits:

- `76d6815 feat(clientes): add customer opportunity MVP`
  - Estado: PASS frontend / pendiente prueba real DB
- `5af14b8 fix(outbox): guard real dispatch and retry whatsapp`
  - Estado: PASS frontend seguro / pendiente QA worker con fixture DB

## Hallazgo crítico de entorno

El frontend local apunta a un remoto no autorizado para QA real:

- `flowsuitecrm/.env` -> `VITE_SUPABASE_URL=https://rxiarmbosgivaplygqug.supabase.co`
- `flowsuitecrm/.env.local` -> `VITE_SUPABASE_URL=https://rxiarmbosgivaplygqug.supabase.co`

Implicación:

- No está autorizada QA real contra ese remoto.
- Para evitar tráfico no autorizado, toda la QA frontend funcional se ejecutó con mocking completo de Supabase.

## Diagnóstico migraciones

Project-ref auditado:

- `ahdefxyvfgjkwgkfkaxd`

Migraciones aplicadas en remoto:

- `0168`
- `0169`
- `20260623113000`
- `20260623201000`
- `20260630120000`

Pendientes locales por grupos:

1. Serie histórica numerada:

- `0001–0146`

2. Serie timestamped que reempaqueta o reemplaza parte de la serie numerada:

- `20260426232649`
- `20260427163925`
- `20260427170307`
- `20260427180143`
- `20260427224918`
- `20260427235627`
- `20260430161022`
- `20260430161039`
- muchas `202605*`
- varias `202606*`

3. Candidatas futuras relacionadas con los cambios auditados:

- `20260626220821_cliente_opportunities_mvp.sql`
- `20260630120000_0173_cobranza_automation_idempotency.sql` ya está aplicada en remoto

Duplicados semánticos detectados:

- `0112_rpc_ventas_completas.sql` vs `20260426232649_0112_rpc_ventas_completas.sql`
- `0121_cob_dfp_terminologia_comments.sql` vs `20260427163925_0121_cob_dfp_terminologia_comments.sql`
- `0122_cob_revolving_security_definer_functions.sql` vs `20260427170307_0122_cob_revolving_security_definer_functions.sql`
- `0123_v_dfp_caso_resumen.sql` vs `20260427180143_0123_v_dfp_caso_resumen.sql`
- `0124_cob_dfp_rls_hardening.sql` vs `20260427224918_0124_cob_dfp_rls_hardening.sql`
- `0125_fn_registrar_pago_revolving.sql` vs `20260427235627_0125_fn_registrar_pago_revolving.sql`
- `0131_outbox_n8n_dispatch_tracking.sql` vs `20260430161022_0131_outbox_n8n_dispatch_tracking.sql`
- `0132_whatsapp_campaign_consent.sql` vs `20260430161039_0132_whatsapp_campaign_consent.sql`
- `0133_fn_abrir_o_actualizar_cargo_vuelta_case.sql` vs `20260502235918_fn_abrir_o_actualizar_cargo_vuelta_case.sql`
- `0134_fix_cargo_vuelta_pending_amount.sql` vs `20260503002532_fix_cargo_vuelta_pending_amount.sql`
- `0135_cargo_vuelta_proceso_legal.sql` vs `20260503012352_cargo_vuelta_proceso_legal.sql`
- `0136_outbox_cc_emails.sql` vs `20260503015856_0136_outbox_cc_emails.sql`
- `0137_fn_get_cargo_vuelta_campaign_targets.sql` vs `20260503191733_fn_get_cargo_vuelta_campaign_targets.sql`
- `0138_fix_fn_outbox_log_activity_owner_null.sql` vs `20260504021949_0138_fix_fn_outbox_log_activity_owner_null.sql`
- `0138_fix_fn_outbox_log_activity_owner_null.sql` vs `20260504022000_0138_fix_fn_outbox_log_activity_owner_null_v2.sql`
- `0139_fix_inbox_status_constraints.sql` vs `20260504161934_0139_fix_inbox_status_constraints.sql`
- `0140_backfill_pago_prometido_from_llamadas.sql` vs `20260505002045_0140_backfill_pago_prometido_from_llamadas.sql`
- `0141_cob_ptps_hardening_ptp_id_gestiones.sql` vs `20260505003625_0141_cob_ptps_hardening_ptp_id_gestiones.sql`
- `0142_rpc_fn_case_next_step_agreement.sql` vs `20260505011555_0142_rpc_fn_case_next_step_agreement.sql`
- `0143_add_resultado_to_contacto_actividades.sql` vs `20260505013115_0143_add_resultado_to_contacto_actividades.sql`
- `0144_rpc_cerrar_cargo_vuelta_case.sql` vs `20260505014536_0144_rpc_cerrar_cargo_vuelta_case.sql`
- `0145_exclude_negotiated_cases_campaign.sql` vs `20260505015014_0145_exclude_negotiated_cases_campaign.sql`
- `0146_cob_statements_and_lines.sql` vs `20260506030247_0146_cob_statements_and_lines.sql`

Mismatch clave:

- remoto `0168`
- local `20260621173000_0168_cv_statement_schedule_and_interest.sql`

Esto apunta a un mismo cambio con version ids distintos.

Riesgo relevante fuera de scope:

- `20260623210000_upsert_clientes_batch.sql`
- implica PII/import masivo
- está pendiente localmente
- no debe aplicarse en esta fase

## Decisión

Decisiones de esta fase:

- no `supabase db push`
- no `supabase migration repair`
- no SQL manual
- no QA DB real en este staging todavía

Razón:

- el historial remoto/local no está reconciliado
- hay duplicados semánticos
- hay mismatch de ids para cambios aparentemente equivalentes
- existe una migración con PII pendiente y fuera de scope

## Recomendación

Opción más segura:

- crear staging limpio/nuevo con raíz canónica de migraciones

Opción alternativa:

- auditoría formal completa archivo por archivo y luego plan de `migration repair`

Opción puntual si urge probar MVP de oportunidades:

- SQL controlado solo para `20260626220821_cliente_opportunities_mvp.sql`
- únicamente con autorización separada
- con checklist previo de prerequisitos
- con documentación posterior de todo lo aplicado

## Estado final

`git status --short` al cierre:

```text
 M .gitignore
?? docs/AUDIT/cartera-ux-simplification-proposal-2026-06-26.md
?? docs/AUDIT/stellar-audit-2026-06-11.md
?? docs/AUDIT/stellar-phase2-checklist-2026-06-11.md
?? docs/AUDIT/stellar-phase2A-collection-report-2026-06-11.md
?? docs/AUDIT/stellar-phase2A-runbook-2026-06-11.md
?? flowsuitecrm/supabase/migrations/0169_add_cv_statement_fields_to_cargo_vuelta_cases.sql
?? flowsuitecrm/supabase/migrations/20260623210000_upsert_clientes_batch.sql
```

Archivos fuera de scope:

- `.gitignore`
- `docs/AUDIT/cartera-ux-simplification-proposal-2026-06-26.md`
- `docs/AUDIT/stellar-audit-2026-06-11.md`
- `docs/AUDIT/stellar-phase2-checklist-2026-06-11.md`
- `docs/AUDIT/stellar-phase2A-collection-report-2026-06-11.md`
- `docs/AUDIT/stellar-phase2A-runbook-2026-06-11.md`
- `flowsuitecrm/supabase/migrations/0169_add_cv_statement_fields_to_cargo_vuelta_cases.sql`
- `flowsuitecrm/supabase/migrations/20260623210000_upsert_clientes_batch.sql`

Riesgos pendientes:

- no existe base confiable para QA funcional real de DB en este staging
- cualquier intento de `db push` podría aplicar decenas de migraciones fuera de scope
- cualquier intento de `repair` sin tabla canónica de equivalencias puede dejar historia falsa o inconsistente
