-- ============================================================
-- 0114_rpc_ventas_subtotal_desde_payload.sql
-- Ajuste de negocio Fase 1E: subtotal (SALES PRICE) viene del
-- payload como precio total de la orden, no se calcula sumando
-- items. Los items siguen siendo detalle descriptivo.
-- Cambios sobre 0113:
--   1. v_subtotal se lee de payload->>'subtotal', no se acumula
--   2. Validación: v_subtotal > 0
--   3. Validación: impuesto, cargo_envio, descuento, pago_inicial >= 0
--   4. Validación: saldo_pendiente >= 0
--   5. Loop de items: valida cantidad > 0, precio >= 0, no acumula
-- ============================================================

BEGIN;

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
    WHERE id = v_lead_id AND org_id = v_user_org_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Prospecto no encontrado o no pertenece a su organización';
    END IF;

    IF v_lead_row.estado_pipeline::text = 'cierre'
       OR lower(coalesce(v_lead_row.next_action, '')) = 'convertido' THEN
      RAISE EXCEPTION 'El prospecto ya se encuentra cerrado o convertido';
    END IF;

    IF NULLIF(TRIM(payload->>'numero_cuenta_financiera'), '') IS NULL THEN
      RAISE EXCEPTION 'Se requiere un número de cuenta para crear el cliente desde prospecto';
    END IF;

    INSERT INTO public.clientes (
      org_id, nombre, apellido, email, telefono,
      numero_cuenta_financiera, vendedor_id, activo
    ) VALUES (
      v_user_org_id, v_lead_row.nombre, v_lead_row.apellido, v_lead_row.email, v_lead_row.telefono,
      TRIM(payload->>'numero_cuenta_financiera'), v_vendedor_id, true
    ) RETURNING id INTO v_cliente_id;

    UPDATE public.leads
    SET estado_pipeline = 'cierre', next_action = 'Convertido'
    WHERE id = v_lead_id;

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
    org_id, numero_nota_pedido, cliente_id, vendedor_id, tipo_movimiento,
    fecha_venta, estado, subtotal, impuesto, cargo_envio, descuento,
    total, pago_inicial, saldo_pendiente, notas
  ) VALUES (
    v_user_org_id,
    NULLIF(TRIM(payload->>'numero_nota_pedido'), ''),
    v_cliente_id,
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

COMMIT;
