begin;

-- Hardening: Supabase puede otorgar EXECUTE a anon automáticamente
-- en funciones creadas dentro del schema public.
-- Las funciones mutadoras ya validan auth.uid(), pero este revoke
-- cierra explícitamente el acceso anónimo formal.

revoke execute on function public.fn_cob_acuerdo_generar_cobros(uuid, integer) from anon;
revoke execute on function public.fn_cob_acuerdo_crear(jsonb) from anon;
revoke execute on function public.fn_cob_acuerdo_pausar(uuid, text) from anon;
revoke execute on function public.fn_cob_acuerdo_cancelar(uuid, text) from anon;
revoke execute on function public.fn_cob_acuerdo_reactivar(uuid, date) from anon;

commit;
