-- Fase 1: orden RP desde lead; conversión únicamente al aprobar.
-- Producción inspeccionada en modo lectura el 2026-09-20. No depende del
-- backfill untracked 20260919012125, que omite protecciones de producción.
-- Pipeline real: nuevo, contactado, calificado, descartado, cita, demo, cierre.
BEGIN;

ALTER TABLE public.ventas
  ADD COLUMN lead_id uuid REFERENCES public.leads(id),
  ADD COLUMN decision_aprobacion_por uuid REFERENCES public.usuarios(id),
  ADD COLUMN decision_aprobacion_at timestamptz,
  ADD COLUMN estado_aprobacion text NOT NULL DEFAULT 'no_aplica'
    CHECK (estado_aprobacion IN ('no_aplica', 'pendiente_aprobacion', 'aprobada', 'rechazada'));
ALTER TABLE public.ventas ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE public.ventas ADD CONSTRAINT ventas_lead_aprobacion_check CHECK (
  (lead_id IS NULL AND estado_aprobacion = 'no_aplica')
  OR (lead_id IS NOT NULL AND (
    (estado_aprobacion IN ('pendiente_aprobacion', 'rechazada') AND cliente_id IS NULL)
    OR (estado_aprobacion = 'aprobada' AND cliente_id IS NOT NULL)
  ))
);
ALTER TABLE public.ventas ADD CONSTRAINT ventas_decision_auditoria_check CHECK (
  (decision_aprobacion_por IS NULL) = (decision_aprobacion_at IS NULL)
  AND (estado_aprobacion NOT IN ('aprobada', 'rechazada') OR decision_aprobacion_por IS NOT NULL)
);
CREATE INDEX ventas_lead_id_idx ON public.ventas (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX ventas_org_aprobacion_idx ON public.ventas (org_id, estado_aprobacion);
CREATE UNIQUE INDEX ventas_lead_pendiente_unique ON public.ventas (lead_id)
  WHERE estado_aprobacion = 'pendiente_aprobacion';
COMMENT ON COLUMN public.ventas.estado_aprobacion IS
  'Aprobación comercial RP, independiente del estado operativo de la venta. Legacy/clientes: no_aplica.';

-- Definición reconciliada mediante pg_get_functiondef en producción el 2026-09-20.
-- Se conserva firma/OID en public y el cuerpo de conversión (incluidos locks,
-- lead_not_active y copia de datos). Solo se añaden autorización y guardia RP.
-- Fallar ante drift: nunca reconstruir a partir del backfill stale.
DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc
      WHERE oid = 'public.fn_convertir_lead_a_cliente(uuid,uuid)'::regprocedure)
      IS DISTINCT FROM 'd7e46a5c18298d9dc3ee8593bd6ed08b' THEN
    RAISE EXCEPTION 'La conversión instalada no coincide con la definición reconciliada de producción; verificar sus protecciones antes de aplicar Fase 1';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_convertir_lead_a_cliente(p_lead_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_lead record;
  v_cliente_id uuid;
  actor uuid := auth.uid();
  usuario public.usuarios%ROWTYPE;
begin
  -- Lock the row so a concurrent call blocks here instead of racing past this check.
  select * into v_lead from leads where id = p_lead_id and deleted_at is null for update;
  if not found then
    return jsonb_build_object('error', 'lead_not_found');
  end if;

  if v_lead.estado_pipeline in ('cierre', 'descartado') then
    return jsonb_build_object('error', 'lead_not_active');
  end if;

  -- p_actor_id se conserva por compatibilidad, pero no es confiable.
  SELECT * INTO usuario FROM public.usuarios WHERE id = actor;
  IF actor IS NULL OR usuario.org_id IS NULL OR v_lead.org_id IS DISTINCT FROM usuario.org_id THEN
    RAISE EXCEPTION 'No autorizado para convertir este lead';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ventas WHERE lead_id = p_lead_id) THEN
    -- La RPC marca la auditoría bajo locks ANTES de llamar aquí. Los roles API
    -- no pueden escribir esa marca. No se confía en parámetros ni GUC del cliente.
    IF NOT EXISTS (
      SELECT 1 FROM public.ventas v
      WHERE v.lead_id = p_lead_id AND v.org_id = usuario.org_id
        AND v.estado_aprobacion = 'pendiente_aprobacion'
        AND v.decision_aprobacion_por = actor AND v.decision_aprobacion_at IS NOT NULL
        AND usuario.rol::text IN ('admin', 'distribuidor')
        AND (usuario.rol::text = 'admin' OR v.vendedor_id = actor
          OR public.is_distribuidor_of(v.vendedor_id)
          OR v_lead.owner_id = actor OR v_lead.vendedor_id = actor
          OR public.is_distribuidor_of(v_lead.owner_id) OR public.is_distribuidor_of(v_lead.vendedor_id))
    ) THEN
      RAISE EXCEPTION 'Este lead tiene una orden RP. Use la aprobación de la orden para convertirlo';
    END IF;
  ELSIF NOT (usuario.rol::text IN ('admin', 'distribuidor', 'vendedor', 'supervisor_telemercadeo', 'telemercadeo')
    AND (usuario.rol::text IN ('admin', 'supervisor_telemercadeo')
      OR v_lead.owner_id = actor OR v_lead.vendedor_id = actor
      OR (usuario.rol::text = 'distribuidor' AND (
        public.is_distribuidor_of(v_lead.owner_id) OR public.is_distribuidor_of(v_lead.vendedor_id)))
      OR (usuario.rol::text = 'telemercadeo' AND EXISTS (
        SELECT 1 FROM public.tele_vendedor_assignments t
        WHERE t.tele_id = actor AND t.vendedor_id = v_lead.vendedor_id
      )))) IS TRUE THEN
    RAISE EXCEPTION 'No autorizado para convertir este lead';
  END IF;

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
         updated_by = actor
   where id = p_lead_id;

  return jsonb_build_object('cliente_id', v_cliente_id, 'lead_id', p_lead_id);
end;
$function$;
REVOKE ALL ON FUNCTION public.fn_convertir_lead_a_cliente(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_convertir_lead_a_cliente(uuid, uuid) TO authenticated;

-- Invariante de acceso directo: los roles API no pueden cambiar el vínculo ni
-- decidir aprobación con UPDATE. current_user cambia al dueño dentro de la RPC.
CREATE FUNCTION public.guard_venta_aprobacion() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  lead public.leads%ROWTYPE;
  usuario public.usuarios%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.lead_id IS NOT NULL THEN
    SELECT * INTO lead FROM public.leads WHERE id = NEW.lead_id FOR UPDATE;
    SELECT * INTO usuario FROM public.usuarios WHERE id = auth.uid();
    IF lead.org_id IS DISTINCT FROM NEW.org_id OR usuario.org_id IS DISTINCT FROM NEW.org_id
      OR NOT (usuario.rol::text IN ('admin', 'distribuidor', 'vendedor') AND (
        usuario.rol::text = 'admin' OR lead.owner_id = usuario.id OR lead.vendedor_id = usuario.id
        OR (usuario.rol::text = 'distribuidor' AND (
          public.is_distribuidor_of(lead.owner_id) OR public.is_distribuidor_of(lead.vendedor_id)
        )))) IS TRUE THEN
      RAISE EXCEPTION 'No autorizado para crear una orden de este prospecto';
    END IF;
    IF lead.deleted_at IS NOT NULL OR lead.estado_pipeline::text IN ('cierre', 'descartado')
      OR lower(coalesce(lead.next_action, '')) = 'convertido' THEN
      RAISE EXCEPTION 'El prospecto ya se encuentra cerrado o convertido';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.decision_aprobacion_por IS NOT NULL OR NEW.decision_aprobacion_at IS NOT NULL THEN
      RAISE EXCEPTION 'La auditoría de decisión solo se registra mediante aprobación/rechazo';
    END IF;
    IF NEW.lead_id IS NOT NULL AND
      (NEW.estado_aprobacion <> 'pendiente_aprobacion' OR NEW.cliente_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Una orden de lead debe iniciar pendiente de aprobación';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.lead_id IS DISTINCT FROM NEW.lead_id
      OR (OLD.lead_id IS NOT NULL AND OLD.org_id IS DISTINCT FROM NEW.org_id) THEN
      RAISE EXCEPTION 'No se puede cambiar el origen de una orden RP';
    END IF;
    IF current_user IN ('authenticated', 'anon') AND
      (OLD.decision_aprobacion_por IS DISTINCT FROM NEW.decision_aprobacion_por
        OR OLD.decision_aprobacion_at IS DISTINCT FROM NEW.decision_aprobacion_at
        OR OLD.estado_aprobacion IS DISTINCT FROM NEW.estado_aprobacion
        OR (OLD.lead_id IS NOT NULL AND OLD.cliente_id IS DISTINCT FROM NEW.cliente_id)) THEN
      RAISE EXCEPTION 'Use fn_aprobar_rechazar_venta para decidir la orden';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.lead_id IS NOT NULL THEN
      RAISE EXCEPTION 'Las órdenes RP se conservan para trazabilidad; no se eliminan';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.lead_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = NEW.lead_id AND l.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'El lead y la venta deben pertenecer a la misma organización';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_venta_aprobacion() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_venta_aprobacion BEFORE INSERT OR UPDATE OR DELETE ON public.ventas
FOR EACH ROW EXECUTE FUNCTION public.guard_venta_aprobacion();

CREATE OR REPLACE FUNCTION public.fn_crear_venta_completa(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_org_id uuid;
  v_user_rol public.usuario_rol;

  v_owner_type text;
  v_cliente_id uuid;
  v_lead_id uuid;
  v_vendedor_id uuid;
  v_tipo_movimiento public.venta_tipo_movimiento;

  v_venta_id uuid;
  v_subtotal numeric(12,2);
  v_impuesto numeric(12,2);
  v_cargo_envio numeric(12,2);
  v_descuento numeric(12,2);
  v_total numeric(12,2);
  v_pago_inicial numeric(12,2);
  v_saldo_pendiente numeric(12,2);

  v_saldo_acumulado numeric(12,2) := 0;
  v_items_count integer := 0;
  v_transacciones_count integer := 0;

  v_lead_row record;
  v_item jsonb;

  v_item_cantidad integer;
  v_item_precio numeric(12,2);
BEGIN
  -- 1. org_id y rol del usuario ejecutante
  SELECT org_id, rol INTO v_user_org_id, v_user_rol
  FROM public.usuarios
  WHERE id = v_user_id;

  IF v_user_org_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no encontrado o no tiene org_id';
  END IF;

  v_vendedor_id := (NULLIF(TRIM(payload->>'vendedor_id'), ''))::uuid;
  IF v_vendedor_id IS NULL THEN
    RAISE EXCEPTION 'El vendedor_id es requerido';
  END IF;

  -- 2. Validar vendedor según rol
  IF v_user_rol = 'vendedor' THEN
    IF v_vendedor_id != v_user_id THEN
      RAISE EXCEPTION 'Un vendedor solo puede crear ventas para sí mismo';
    END IF;
  ELSIF v_user_rol = 'distribuidor' THEN
    IF v_vendedor_id != v_user_id AND NOT public.is_distribuidor_of(v_vendedor_id) THEN
      RAISE EXCEPTION 'No autorizado para asignar a este vendedor';
    END IF;
  ELSIF v_user_rol = 'admin' THEN
    IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = v_vendedor_id AND org_id = v_user_org_id) THEN
      RAISE EXCEPTION 'Vendedor no válido para esta organización';
    END IF;
  ELSE
    RAISE EXCEPTION 'Su rol no tiene permisos para crear ventas';
  END IF;

  -- 3. Parsear y validar campos
  v_owner_type := NULLIF(TRIM(payload->>'owner_type'), '');

  v_tipo_movimiento := (NULLIF(TRIM(payload->>'tipo_movimiento'), ''))::public.venta_tipo_movimiento;
  IF v_tipo_movimiento IS NULL THEN
    RAISE EXCEPTION 'tipo_movimiento es requerido';
  END IF;

  -- SALES PRICE: subtotal viene del payload (precio total de la orden)
  v_subtotal := COALESCE((NULLIF(TRIM(payload->>'subtotal'), ''))::numeric, 0);
  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'El subtotal (SALES PRICE) debe ser mayor a 0';
  END IF;

  v_impuesto    := COALESCE((NULLIF(TRIM(payload->>'impuesto'),    ''))::numeric, 0);
  v_cargo_envio := COALESCE((NULLIF(TRIM(payload->>'cargo_envio'), ''))::numeric, 0);
  v_descuento   := COALESCE((NULLIF(TRIM(payload->>'descuento'),   ''))::numeric, 0);
  v_pago_inicial := COALESCE((NULLIF(TRIM(payload->>'pago_inicial'),''))::numeric, 0);

  IF v_impuesto < 0 THEN
    RAISE EXCEPTION 'El impuesto no puede ser negativo';
  END IF;
  IF v_cargo_envio < 0 THEN
    RAISE EXCEPTION 'El cargo de envío no puede ser negativo';
  END IF;
  IF v_descuento < 0 THEN
    RAISE EXCEPTION 'El descuento no puede ser negativo';
  END IF;
  IF v_pago_inicial < 0 THEN
    RAISE EXCEPTION 'El pago inicial no puede ser negativo';
  END IF;

  -- Validar ítems (descriptivos; precio_unitario puede ser 0)
  IF payload->'items' IS NULL OR jsonb_typeof(payload->'items') != 'array' OR jsonb_array_length(payload->'items') = 0 THEN
    RAISE EXCEPTION 'La venta debe contener al menos un ítem válido';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    v_item_cantidad := (NULLIF(TRIM(v_item->>'cantidad'), ''))::integer;
    IF v_item_cantidad IS NULL OR v_item_cantidad <= 0 THEN
      RAISE EXCEPTION 'La cantidad del ítem debe ser un entero mayor a 0';
    END IF;
    v_item_precio := COALESCE(ROUND((NULLIF(TRIM(v_item->>'precio_unitario'), ''))::numeric, 2), 0);
    IF v_item_precio < 0 THEN
      RAISE EXCEPTION 'El precio unitario del ítem no puede ser negativo';
    END IF;
  END LOOP;

  -- Validaciones matemáticas (servidor recalcula y verifica contra frontend)
  v_total           := v_subtotal + v_impuesto + v_cargo_envio - v_descuento;
  v_saldo_pendiente := v_total - v_pago_inicial;

  IF v_saldo_pendiente < 0 THEN
    RAISE EXCEPTION 'El saldo pendiente no puede ser negativo (pago inicial supera el total)';
  END IF;

  IF (NULLIF(TRIM(payload->>'total'), ''))::numeric(12,2) != v_total THEN
    RAISE EXCEPTION 'El total enviado no coincide con el cálculo interno';
  END IF;
  IF (NULLIF(TRIM(payload->>'saldo_pendiente'), ''))::numeric(12,2) != v_saldo_pendiente THEN
    RAISE EXCEPTION 'El saldo_pendiente enviado no coincide con el cálculo interno';
  END IF;

  -- 4. Cliente / Lead
  IF v_owner_type = 'lead' THEN
    v_lead_id := (NULLIF(TRIM(payload->>'lead_id'), ''))::uuid;
    IF v_lead_id IS NULL THEN
      RAISE EXCEPTION 'El lead_id es requerido';
    END IF;

    SELECT * INTO v_lead_row
    FROM public.leads
    WHERE id = v_lead_id AND org_id = v_user_org_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Prospecto no encontrado o no pertenece a su organización';
    END IF;

    IF v_lead_row.estado_pipeline::text IN ('cierre', 'descartado')
       OR lower(coalesce(v_lead_row.next_action, '')) = 'convertido' THEN
      RAISE EXCEPTION 'El prospecto ya se encuentra cerrado o convertido';
    END IF;

    IF NOT (
      v_user_rol = 'admin'
      OR v_lead_row.owner_id = v_user_id OR v_lead_row.vendedor_id = v_user_id
      OR (v_user_rol = 'distribuidor' AND (
        public.is_distribuidor_of(v_lead_row.owner_id)
        OR public.is_distribuidor_of(v_lead_row.vendedor_id)
      ))
    ) IS TRUE THEN
      RAISE EXCEPTION 'No autorizado para crear una orden de este prospecto';
    END IF;
    -- No conversión, cuenta financiera ni cambio de pipeline al crear la orden.

  ELSIF v_owner_type = 'cliente' THEN
    v_cliente_id := (NULLIF(TRIM(payload->>'cliente_id'), ''))::uuid;
    IF v_cliente_id IS NULL THEN
      RAISE EXCEPTION 'El cliente_id es requerido';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = v_cliente_id AND org_id = v_user_org_id) THEN
      RAISE EXCEPTION 'Cliente no válido';
    END IF;
  ELSE
    RAISE EXCEPTION 'Tipo de owner_type (%) inválido. Debe ser lead o cliente', v_owner_type;
  END IF;

  -- 5. Insertar Venta
  INSERT INTO public.ventas (
    org_id, numero_nota_pedido, cliente_id, lead_id, estado_aprobacion, vendedor_id, tipo_movimiento,
    fecha_venta, estado, subtotal, impuesto, cargo_envio, descuento,
    total, pago_inicial, saldo_pendiente, notas
  ) VALUES (
    v_user_org_id,
    NULLIF(TRIM(payload->>'numero_nota_pedido'), ''),
    v_cliente_id,
    v_lead_id,
    CASE WHEN v_lead_id IS NULL THEN 'no_aplica' ELSE 'pendiente_aprobacion' END,
    v_vendedor_id,
    v_tipo_movimiento,
    (NULLIF(TRIM(payload->>'fecha_venta'), ''))::date,
    NULLIF(TRIM(payload->>'estado'), ''),
    v_subtotal, v_impuesto, v_cargo_envio, v_descuento,
    v_total, v_pago_inicial, v_saldo_pendiente,
    NULLIF(TRIM(payload->>'notas'), '')
  ) RETURNING id INTO v_venta_id;

  -- 6. Insertar Ítems (detalle descriptivo)
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'items') LOOP
    INSERT INTO public.venta_items (
      org_id, venta_id, linea, producto_id, codigo_articulo, descripcion, cantidad, precio_unitario
    ) VALUES (
      v_user_org_id,
      v_venta_id,
      (NULLIF(TRIM(v_item->>'linea'), ''))::integer,
      (NULLIF(TRIM(v_item->>'producto_id'), ''))::uuid,
      NULLIF(TRIM(v_item->>'codigo'), ''),
      NULLIF(TRIM(v_item->>'descripcion'), ''),
      (NULLIF(TRIM(v_item->>'cantidad'), ''))::integer,
      COALESCE(ROUND((NULLIF(TRIM(v_item->>'precio_unitario'), ''))::numeric, 2), 0)
    );
    v_items_count := v_items_count + 1;
  END LOOP;

  -- 7. Transacciones financieras desde v_subtotal (SALES PRICE)
  v_saldo_acumulado := v_saldo_acumulado + v_subtotal;
  INSERT INTO public.venta_transacciones (org_id, venta_id, descripcion, cantidad, saldo)
  VALUES (v_user_org_id, v_venta_id, 'SALES PRICE', v_subtotal, v_saldo_acumulado);
  v_transacciones_count := v_transacciones_count + 1;

  IF v_impuesto > 0 THEN
    v_saldo_acumulado := v_saldo_acumulado + v_impuesto;
    INSERT INTO public.venta_transacciones (org_id, venta_id, descripcion, cantidad, saldo)
    VALUES (v_user_org_id, v_venta_id, 'SALES TAX CHARGE', v_impuesto, v_saldo_acumulado);
    v_transacciones_count := v_transacciones_count + 1;
  END IF;

  IF v_cargo_envio > 0 THEN
    v_saldo_acumulado := v_saldo_acumulado + v_cargo_envio;
    INSERT INTO public.venta_transacciones (org_id, venta_id, descripcion, cantidad, saldo)
    VALUES (v_user_org_id, v_venta_id, 'SHIPPING / HANDLING', v_cargo_envio, v_saldo_acumulado);
    v_transacciones_count := v_transacciones_count + 1;
  END IF;

  IF v_descuento > 0 THEN
    v_saldo_acumulado := v_saldo_acumulado - v_descuento;
    INSERT INTO public.venta_transacciones (org_id, venta_id, descripcion, cantidad, saldo)
    VALUES (v_user_org_id, v_venta_id, 'DISCOUNT', -v_descuento, v_saldo_acumulado);
    v_transacciones_count := v_transacciones_count + 1;
  END IF;

  IF v_pago_inicial > 0 THEN
    v_saldo_acumulado := v_saldo_acumulado - v_pago_inicial;
    INSERT INTO public.venta_transacciones (org_id, venta_id, descripcion, cantidad, saldo)
    VALUES (v_user_org_id, v_venta_id, 'CONSUMER DOWN PAYMENT', -v_pago_inicial, v_saldo_acumulado);
    v_transacciones_count := v_transacciones_count + 1;
  END IF;

  -- 8. Validar saldo acumulado final
  IF v_saldo_acumulado != v_saldo_pendiente THEN
    RAISE EXCEPTION 'Discrepancia financiera: saldo acumulado (%) != saldo_pendiente (%)', v_saldo_acumulado, v_saldo_pendiente;
  END IF;

  -- 9. Retornar resultado
  RETURN jsonb_build_object(
    'success', true,
    'venta_id', v_venta_id,
    'cliente_id', v_cliente_id,
    'lead_id', v_lead_id,
    'estado_aprobacion', CASE WHEN v_lead_id IS NULL THEN 'no_aplica' ELSE 'pendiente_aprobacion' END,
    'total', v_total,
    'saldo_pendiente', v_saldo_pendiente,
    'items_count', v_items_count,
    'transacciones_count', v_transacciones_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_crear_venta_completa(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_crear_venta_completa(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_crear_venta_completa(jsonb) TO authenticated;


CREATE FUNCTION public.fn_aprobar_rechazar_venta(
  p_venta_id uuid, p_estado_aprobacion text, p_numero_cuenta_financiera text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  usuario public.usuarios%ROWTYPE;
  venta public.ventas%ROWTYPE;
  lead public.leads%ROWTYPE;
  conversion jsonb;
  cliente uuid;
  cuenta text := NULLIF(btrim(p_numero_cuenta_financiera), '');
BEGIN
  IF p_estado_aprobacion IS NULL OR p_estado_aprobacion NOT IN ('aprobada', 'rechazada') THEN
    RAISE EXCEPTION 'La decisión debe ser aprobada o rechazada';
  END IF;
  SELECT * INTO usuario FROM public.usuarios WHERE id = actor;
  IF actor IS NULL OR usuario.org_id IS NULL OR (usuario.rol::text IN ('admin', 'distribuidor')) IS NOT TRUE THEN
    RAISE EXCEPTION 'Rol no autorizado para aprobar o rechazar órdenes';
  END IF;
  -- Primero el lead: mismo orden de locks que creación y conversión manual.
  SELECT * INTO venta FROM public.ventas WHERE id = p_venta_id AND org_id = usuario.org_id;
  IF NOT FOUND OR venta.lead_id IS NULL THEN
    RAISE EXCEPTION 'Orden RP no encontrada en su organización';
  END IF;
  SELECT * INTO lead FROM public.leads WHERE id = venta.lead_id AND org_id = usuario.org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead no encontrado en su organización'; END IF;
  SELECT * INTO venta FROM public.ventas WHERE id = p_venta_id AND org_id = usuario.org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden RP no encontrada'; END IF;
  IF NOT (usuario.rol::text = 'admin' OR venta.vendedor_id = actor
      OR public.is_distribuidor_of(venta.vendedor_id)
      OR lead.owner_id = actor OR lead.vendedor_id = actor
      OR public.is_distribuidor_of(lead.owner_id) OR public.is_distribuidor_of(lead.vendedor_id)) IS TRUE THEN
    RAISE EXCEPTION 'Orden fuera del ámbito del distribuidor';
  END IF;

  IF venta.estado_aprobacion = p_estado_aprobacion THEN
    IF p_estado_aprobacion = 'aprobada' AND cuenta IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.clientes c WHERE c.id = venta.cliente_id
        AND c.org_id = usuario.org_id AND c.numero_cuenta_financiera = cuenta
    ) THEN RAISE EXCEPTION 'La orden ya fue aprobada con otra cuenta'; END IF;
    RETURN jsonb_build_object('venta_id', venta.id, 'lead_id', venta.lead_id,
      'cliente_id', venta.cliente_id, 'estado_aprobacion', venta.estado_aprobacion);
  END IF;
  IF venta.estado_aprobacion <> 'pendiente_aprobacion' THEN
    RAISE EXCEPTION 'La orden ya tiene una decisión definitiva';
  END IF;

  IF p_estado_aprobacion = 'rechazada' THEN
    UPDATE public.ventas SET estado_aprobacion = 'rechazada',
      decision_aprobacion_por = actor, decision_aprobacion_at = now() WHERE id = venta.id;
  ELSE
    IF cuenta IS NULL THEN RAISE EXCEPTION 'Se requiere numero_cuenta_financiera para aprobar'; END IF;
    IF lead.deleted_at IS NOT NULL OR lead.estado_pipeline::text IN ('cierre', 'descartado')
       OR lower(coalesce(lead.next_action, '')) = 'convertido' THEN
      RAISE EXCEPTION 'El lead ya no está activo';
    END IF;
    -- Marca protegida y transaccional: no se expone un bypass en la API pública.
    -- Si conversión/cuenta falla, también se revierte esta auditoría.
    UPDATE public.ventas SET decision_aprobacion_por = actor, decision_aprobacion_at = now()
      WHERE id = venta.id;
    conversion := public.fn_convertir_lead_a_cliente(lead.id, actor);
    cliente := NULLIF(conversion->>'cliente_id', '')::uuid;
    IF conversion->>'error' IS NOT NULL OR cliente IS NULL THEN
      RAISE EXCEPTION 'No se pudo convertir el lead: %', conversion;
    END IF;
    UPDATE public.clientes SET numero_cuenta_financiera = cuenta
      WHERE id = cliente AND org_id = usuario.org_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cliente convertido fuera de la organización'; END IF;
    UPDATE public.ventas SET cliente_id = cliente, estado_aprobacion = 'aprobada' WHERE id = venta.id;
  END IF;
  RETURN jsonb_build_object('venta_id', venta.id, 'lead_id', venta.lead_id,
    'cliente_id', cliente, 'estado_aprobacion', p_estado_aprobacion);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_aprobar_rechazar_venta(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_aprobar_rechazar_venta(uuid, text, text) TO authenticated;

-- Las políticas existentes de admin/vendedor/supervisor usan org/vendedor,
-- no requieren cliente. Añadir ownership de lead a distribuidor/telemercadeo.
CREATE POLICY ventas_lead_owner_read ON public.ventas FOR SELECT TO authenticated USING (
  org_id = (SELECT u.org_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.leads l JOIN public.usuarios u ON u.id = (SELECT auth.uid())
    WHERE l.id = ventas.lead_id AND l.org_id = ventas.org_id AND (
      (u.rol::text = 'vendedor' AND (l.owner_id = u.id OR l.vendedor_id = u.id))
      OR (u.rol::text = 'distribuidor' AND (l.owner_id = u.id OR l.vendedor_id = u.id
        OR public.is_distribuidor_of(l.owner_id) OR public.is_distribuidor_of(l.vendedor_id)))
      OR (u.rol::text = 'telemercadeo' AND (l.owner_id = u.id OR EXISTS (
        SELECT 1 FROM public.tele_vendedor_assignments t
        WHERE t.tele_id = u.id AND t.vendedor_id = l.vendedor_id
      )))
    )
  )
);

-- Consumidores revisados: VentasPage.tsx solo hace SELECT; creación usa RPC.
-- Revocar DML directo también impide que una política legacy permisiva lo habilite.
REVOKE INSERT, UPDATE, DELETE ON public.venta_items, public.venta_transacciones FROM anon, authenticated;
GRANT SELECT ON public.venta_items, public.venta_transacciones TO authenticated;
-- Los hijos heredan visibilidad de ventas sin JOIN obligatorio a clientes.
-- Retirar política legacy 0129 si existe: referencia usuarios.user_id y omite org.
DROP POLICY IF EXISTS venta_items_vendedor_access ON public.venta_items;
DROP POLICY IF EXISTS venta_transacciones_vendedor_access ON public.venta_transacciones;
DROP POLICY IF EXISTS venta_items_inherit_ventas ON public.venta_items;
DROP POLICY IF EXISTS venta_transacciones_inherit_ventas ON public.venta_transacciones;
CREATE POLICY venta_items_inherit_ventas ON public.venta_items FOR SELECT TO authenticated
USING (
  org_id = (SELECT u.org_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
  AND EXISTS (SELECT 1 FROM public.ventas v WHERE v.id = venta_items.venta_id AND v.org_id = venta_items.org_id)
);
CREATE POLICY venta_transacciones_inherit_ventas ON public.venta_transacciones FOR SELECT TO authenticated
USING (
  org_id = (SELECT u.org_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
  AND EXISTS (SELECT 1 FROM public.ventas v WHERE v.id = venta_transacciones.venta_id AND v.org_id = venta_transacciones.org_id)
);
COMMIT;
