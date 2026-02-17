-- ============================================================================
-- FlowSuiteCRM - Demo Data Template
-- ============================================================================
-- This file creates minimal test data for all MVP modules.
-- 
-- IMPORTANT: Before running, replace these placeholders:
--   __ORG_ID__   - Your organization ID (from public.organizations)
--   __USER_ID__  - Your user ID (from auth.users)
--
-- To get your IDs, run in Supabase SQL Editor:
--   select id from public.organizations where slug = 'flowsuitecrm-default';
--   select id from auth.users where email = 'your-email@example.com';
--
-- Then replace __ORG_ID__ and __USER_ID__ in this file and execute.
-- ============================================================================

begin;

-- ============================================================================
-- CLIENTE / CONTACTO (for Cliente360)
-- ============================================================================

insert into public.clientes (id, org_id, nombre, email, telefono, direccion, created_at)
values (
  gen_random_uuid(),
  '__ORG_ID__'::uuid,
  'Demo Cliente SA',
  'demo@cliente.com',
  '+1-555-0100',
  'Av. Principal 123, Ciudad',
  now()
) on conflict do nothing
returning id as cliente_id;

-- Store cliente_id for later use (you'll need to manually replace this in subsequent inserts)
-- For simplicity, we'll use a variable approach

do $$
declare
  v_org_id uuid := '__ORG_ID__'::uuid;
  v_user_id uuid := '__USER_ID__'::uuid;
  v_cliente_id uuid;
  v_oportunidad_id uuid;
  v_orden_id uuid;
  v_servicio_id uuid;
  v_sistema_id uuid;
  v_canal_id uuid;
begin

  -- Insert cliente
  insert into public.clientes (id, org_id, nombre, email, telefono, direccion, created_at)
  values (
    gen_random_uuid(),
    v_org_id,
    'Demo Cliente SA',
    'demo@cliente.com',
    '+1-555-0100',
    'Av. Principal 123, Ciudad',
    now()
  )
  on conflict do nothing
  returning id into v_cliente_id;

  -- If cliente already exists, get its ID
  if v_cliente_id is null then
    select id into v_cliente_id
    from public.clientes
    where org_id = v_org_id and email = 'demo@cliente.com'
    limit 1;
  end if;

  raise notice 'Cliente ID: %', v_cliente_id;

  -- ============================================================================
  -- OPORTUNIDAD (for Pipeline)
  -- ============================================================================

  insert into public.oportunidades (
    id, org_id, cliente_id, titulo, producto_objetivo, estado, etapa,
    monto, proxima_accion, proxima_accion_fecha, created_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    v_cliente_id,
    'Venta Sistema FrescaFlow',
    'FrescaFlow',
    'Propuesta',
    'Propuesta',
    2500.00,
    'Enviar cotización final',
    current_date + interval '3 days',
    now()
  )
  on conflict do nothing
  returning id into v_oportunidad_id;

  if v_oportunidad_id is null then
    select id into v_oportunidad_id
    from public.oportunidades
    where org_id = v_org_id and cliente_id = v_cliente_id
    limit 1;
  end if;

  raise notice 'Oportunidad ID: %', v_oportunidad_id;

  -- ============================================================================
  -- ORDEN (for Cliente360 - Órdenes tab)
  -- ============================================================================

  insert into public.ordenesrp (
    id, org_id, cliente_id, numero_orden, estado, total,
    fecha_orden, created_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    v_cliente_id,
    'ORD-2026-001',
    'Confirmada',
    2500.00,
    current_date - interval '5 days',
    now()
  )
  on conflict do nothing
  returning id into v_orden_id;

  if v_orden_id is null then
    select id into v_orden_id
    from public.ordenesrp
    where org_id = v_org_id and cliente_id = v_cliente_id
    limit 1;
  end if;

  raise notice 'Orden ID: %', v_orden_id;

  -- Orden items
  insert into public.ordenitemsrp (
    id, org_id, orden_id, producto, cantidad, precio_unitario, subtotal, created_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    v_orden_id,
    'Sistema FrescaFlow Completo',
    1,
    2500.00,
    2500.00,
    now()
  )
  on conflict do nothing;

  -- ============================================================================
  -- SERVICIO (for Servicio module + Cliente360 - Servicio tab)
  -- ============================================================================

  insert into public.servicios (
    id, org_id, cliente_id, ticket_number, titulo, descripcion,
    estado, prioridad, fecha_apertura, created_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    v_cliente_id,
    'TKT-2026-001',
    'Cambio de filtro de carbón',
    'Cliente solicita cambio de filtro de carbón según programación',
    'Abierto',
    'Media',
    now(),
    now()
  )
  on conflict do nothing
  returning id into v_servicio_id;

  if v_servicio_id is null then
    select id into v_servicio_id
    from public.servicios
    where org_id = v_org_id and cliente_id = v_cliente_id
    limit 1;
  end if;

  raise notice 'Servicio ID: %', v_servicio_id;

  -- Servicio items
  insert into public.servicio_items (
    id, org_id, servicio_id, descripcion, componente, accion, completado, created_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    v_servicio_id,
    'Reemplazar filtro de carbón activado',
    'Carbon',
    'Cambio',
    false,
    now()
  )
  on conflict do nothing;

  -- ============================================================================
  -- AGUA SCHEDULER (for Agua module + Cliente360 - Agua tab)
  -- ============================================================================

  -- Cliente sistema
  insert into public.cliente_sistemas (
    id, org_id, cliente_id, sistema, fecha_instalacion, is_active, created_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    v_cliente_id,
    'FrescaFlow',
    current_date - interval '6 months',
    true,
    now()
  )
  on conflict do nothing
  returning id into v_sistema_id;

  if v_sistema_id is null then
    select id into v_sistema_id
    from public.cliente_sistemas
    where org_id = v_org_id and cliente_id = v_cliente_id
    limit 1;
  end if;

  raise notice 'Sistema ID: %', v_sistema_id;

  -- Cliente componentes (with calculated next_change_at)
  -- FrescaFlow components: Prefiltro (6m), Carbon (12m), Mineralizador (12m), RO (24m)
  
  insert into public.cliente_componentes (
    id, org_id, cliente_sistema_id, componente, last_change_at, next_change_at, intervalo_meses, created_at
  )
  values
    -- Prefiltro: due soon (within 7 days)
    (
      gen_random_uuid(),
      v_org_id,
      v_sistema_id,
      'Prefiltro',
      current_date - interval '6 months',
      current_date + interval '5 days',
      6,
      now()
    ),
    -- Carbon: due in 30 days
    (
      gen_random_uuid(),
      v_org_id,
      v_sistema_id,
      'Carbon',
      current_date - interval '11 months',
      current_date + interval '30 days',
      12,
      now()
    ),
    -- Mineralizador: due in 6 months
    (
      gen_random_uuid(),
      v_org_id,
      v_sistema_id,
      'Mineralizador',
      current_date - interval '6 months',
      current_date + interval '6 months',
      12,
      now()
    ),
    -- RO: due in 18 months
    (
      gen_random_uuid(),
      v_org_id,
      v_sistema_id,
      'RO',
      current_date - interval '6 months',
      current_date + interval '18 months',
      24,
      now()
    )
  on conflict do nothing;

  -- ============================================================================
  -- CARTERA (for Cartera module + Cliente360 - Cartera tab)
  -- ============================================================================

  -- Transacción vencida (90+ días para cargo de vuelta)
  insert into public.transaccionesrp (
    id, org_id, cliente_id, tipo, monto, estado, fecha, fecha_vencimiento, created_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    v_cliente_id,
    'Factura',
    500.00,
    'Pendiente',
    current_date - interval '120 days',
    current_date - interval '95 days',
    now()
  )
  on conflict do nothing;

  -- Caso cargo de vuelta (>90 días)
  insert into public.cargo_vuelta_cases (
    id, org_id, cliente_id, monto_total, dias_vencido, estado, fecha_apertura, created_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    v_cliente_id,
    500.00,
    95,
    'Abierto',
    current_date - interval '5 days',
    now()
  )
  on conflict do nothing;

  -- Gestión de cobranza
  insert into public.cob_gestiones (
    id, org_id, cliente_id, tipo_gestion, resultado, notas, created_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    v_cliente_id,
    'Llamada',
    'No Contactado',
    'Llamada sin respuesta, dejar mensaje',
    now()
  )
  on conflict do nothing;

  -- ============================================================================
  -- TEAM HUB (for TeamHub module)
  -- ============================================================================

  -- Canal
  insert into public.canales (
    id, org_id, nombre, descripcion, tipo, is_private, created_by, created_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    'General',
    'Canal general para todo el equipo',
    'general',
    false,
    v_user_id,
    now()
  )
  on conflict do nothing
  returning id into v_canal_id;

  if v_canal_id is null then
    select id into v_canal_id
    from public.canales
    where org_id = v_org_id and nombre = 'General'
    limit 1;
  end if;

  raise notice 'Canal ID: %', v_canal_id;

  -- Anuncio
  insert into public.anuncios (
    id, org_id, canal_id, titulo, contenido, autor_id, is_pinned, created_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    v_canal_id,
    'Bienvenido a FlowSuiteCRM',
    'Este es un anuncio de demostración. El sistema está listo para usar.',
    v_user_id,
    true,
    now()
  )
  on conflict do nothing;

  -- ============================================================================
  -- NOTAS (for Cliente360 - Notas tab)
  -- ============================================================================

  insert into public.notasrp (
    id, org_id, cliente_id, contenido, created_at
  )
  values (
    gen_random_uuid(),
    v_org_id,
    v_cliente_id,
    'Cliente muy satisfecho con el servicio. Interesado en sistema adicional para oficina.',
    now()
  )
  on conflict do nothing;

end $$;

commit;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these to verify data was inserted correctly:

-- select * from public.clientes where email = 'demo@cliente.com';
-- select * from public.oportunidades where titulo like '%FrescaFlow%';
-- select * from public.servicios where ticket_number = 'TKT-2026-001';
-- select * from public.cliente_componentes where componente = 'Prefiltro';
-- select * from public.cargo_vuelta_cases where dias_vencido > 90;
-- select * from public.canales where nombre = 'General';
