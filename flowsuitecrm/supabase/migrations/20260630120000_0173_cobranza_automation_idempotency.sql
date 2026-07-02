begin;

-- 0173: idempotencia para cobranza automatica
--
-- Objetivo:
--   Evitar duplicados por caso/campana/etapa/dia/canal en
--   automatizaciones de cobranza que insertan en outbox_messages.
--
-- Regla:
--   cobranza_automation_key =
--     {case_id}:{campaign_type}:{cadence_step}:{local_date}:{channel}
--
-- Seguridad:
--   - No modifica mensajes existentes.
--   - No reescribe provider status.
--   - Solo agrega columna e indice unico para filas nuevas.

alter table public.outbox_messages
  add column if not exists cobranza_automation_key text;

comment on column public.outbox_messages.cobranza_automation_key is
  'Llave idempotente de cobranza automatica: {case_id}:{campaign_type}:{cadence_step}:{local_date}:{channel}. Permite bloquear duplicados sin tocar mensajes legacy.';

create unique index if not exists uq_outbox_messages_cobranza_automation_key
  on public.outbox_messages (cobranza_automation_key)
  where cobranza_automation_key is not null;

commit;
