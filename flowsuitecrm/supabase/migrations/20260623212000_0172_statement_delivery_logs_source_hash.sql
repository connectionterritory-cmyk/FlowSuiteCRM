begin;

-- 0172: agregar source_hash a statement_delivery_logs
--
-- Problema resuelto:
--   El binario PDF generado por @react-pdf/renderer no es determinista:
--   dos renders del mismo contenido producen hashes binarios diferentes
--   por metadata interna (CreationDate, ID, etc.).
--
-- Solución:
--   Deduplicar por source_hash = SHA-256 del contenido canónico del statement
--   (statementAdapters output), calculado antes del render.
--   El mismo statement_data → mismo source_hash → reutilizar PDF existente.
--
-- Invariante:
--   - source_hash identifica el *contenido fuente*, no el binario.
--   - pdf_hash sigue guardándose para diagnóstico, pero no para dedupe.
--   - force_regenerate=true ignora source_hash y crea nueva versión,
--     por eso source_hash no tiene unique constraint.
--
-- Rollback:
--   drop index if exists statement_delivery_logs_source_hash_idx;
--   alter table public.statement_delivery_logs drop column if exists source_hash;

alter table public.statement_delivery_logs
  add column if not exists source_hash text;

comment on column public.statement_delivery_logs.source_hash is
  'SHA-256 del contenido canónico normalizado del statement data antes del render PDF. '
  'Usado como criterio principal de deduplicación. '
  'Distinto de pdf_hash (hash del binario), que varía entre renders por metadata interna del renderer. '
  'force_regenerate=true ignora este campo y crea nueva versión aunque el source_hash sea igual.';

-- Índice compuesto para lookup eficiente de deduplicación:
--   WHERE document_type = $1 AND document_id = $2 AND source_hash = $3
-- No unique: permitir múltiples versiones del mismo source (forzadas)
create index if not exists statement_delivery_logs_source_hash_idx
  on public.statement_delivery_logs (document_type, document_id, source_hash)
  where source_hash is not null;

commit;
