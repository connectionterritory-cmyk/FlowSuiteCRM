-- Reconciliación previa a Fase 1. Versión propia entre 20260919012125 y 20260920162342.
-- Fuente: pg_get_functiondef de producción, consultada en modo lectura.
-- El cuerpo debe conservar exactamente md5(prosrc)=d7e46a5c18298d9dc3ee8593bd6ed08b.
-- Esta versión NO autoriza usuarios: queda inaccesible a PUBLIC/anon/authenticated.
-- Fase 1 incorpora auth.uid(), autorización y vuelve a conceder EXECUTE.
BEGIN;

-- No sobrescribir una implementación distinta (incluida Fase 1 ya instalada).
DO $$
DECLARE installed_hash text;
BEGIN
  SELECT md5(prosrc) INTO installed_hash FROM pg_proc
    WHERE oid = to_regprocedure('public.fn_convertir_lead_a_cliente(uuid,uuid)');
  IF installed_hash IS NOT NULL AND installed_hash <> 'd7e46a5c18298d9dc3ee8593bd6ed08b' THEN
    RAISE EXCEPTION 'La conversión instalada difiere de la base canónica; reconciliar explícitamente antes de continuar';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_convertir_lead_a_cliente(p_lead_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead record;
  v_cliente_id uuid;
begin
  -- Lock the row so a concurrent call blocks here instead of racing past this check.
  select * into v_lead from leads where id = p_lead_id and deleted_at is null for update;
  if not found then
    return jsonb_build_object('error', 'lead_not_found');
  end if;

  if v_lead.estado_pipeline in ('cierre', 'descartado') then
    return jsonb_build_object('error', 'lead_not_active');
  end if;

  insert into clientes (
    nombre, apellido, email, telefono, direccion, ciudad, estado_region, codigo_postal, apartamento,
    vendedor_id, org_id, persona_id, fecha_nacimiento,
    origen, fecha_cierre, activo, saldo_actual, monto_moroso, dias_atraso,
    whatsapp_opt_in, whatsapp_no_molestar, whatsapp_consent_source, whatsapp_consented_at
  )
  values (
    v_lead.nombre, v_lead.apellido, v_lead.email, v_lead.telefono, v_lead.direccion, v_lead.ciudad, v_lead.estado_region, v_lead.codigo_postal, v_lead.apartamento,
    v_lead.vendedor_id, v_lead.org_id, v_lead.persona_id, v_lead.fecha_nacimiento,
    'lead_convertido', current_date, true, 0, 0, 0,
    v_lead.whatsapp_opt_in, v_lead.whatsapp_no_molestar, v_lead.whatsapp_consent_source, v_lead.whatsapp_consented_at
  )
  returning id into v_cliente_id;

  update leads
     set estado_pipeline = 'cierre',
         updated_at = now(),
         updated_by = coalesce(p_actor_id, updated_by)
   where id = p_lead_id;

  return jsonb_build_object('cliente_id', v_cliente_id, 'lead_id', p_lead_id);
end;
$function$;
REVOKE ALL ON FUNCTION public.fn_convertir_lead_a_cliente(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc
      WHERE oid = 'public.fn_convertir_lead_a_cliente(uuid,uuid)'::regprocedure)
      IS DISTINCT FROM 'd7e46a5c18298d9dc3ee8593bd6ed08b' THEN
    RAISE EXCEPTION 'Hash de conversión reconciliada incorrecto';
  END IF;
END;
$$;

COMMIT;
