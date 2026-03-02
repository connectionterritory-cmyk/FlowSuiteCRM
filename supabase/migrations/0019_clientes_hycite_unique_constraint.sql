begin;

-- Replace partial unique index with a full unique constraint so that
-- PostgREST can use onConflict:'hycite_id' in upsert calls.
-- PostgreSQL's UNIQUE constraint naturally allows multiple NULLs, so
-- existing rows without hycite_id are unaffected.

drop index if exists public.clientes_hycite_id_uidx;

alter table public.clientes
  add constraint clientes_hycite_id_key unique (hycite_id);

commit;
