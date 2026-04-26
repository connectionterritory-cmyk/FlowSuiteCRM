-- ============================================================
-- 0050_ventas_rls_no_org.sql
-- Legacy compatibility shim.
--
-- Context:
--   The original file in this path was corrupted and broke
--   migration resets. The effective no-org RLS rewrite lived in
--   the root supabase tree, but this app-local copy must stay
--   syntactically valid so future resets do not fail.
--
-- Current status:
--   Superseded by 0111_ventas_multitenancy_reproducibility.sql,
--   which reintroduces org-aware tenancy on ventas, venta_items,
--   and venta_transacciones in a reproducible way.
-- ============================================================

begin;
commit;
