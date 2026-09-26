# Contrato de implementación: postventa RP externa

## Alcance y fuentes de verdad

FlowSuiteCRM administra, refleja hechos externos y genera trabajo operativo. No
origina pedidos ni decisiones financieras. Royal One es la fuente de pedido,
proceso y decisión financiera; Hy-Cite es la fuente de orden y fulfillment.

Este contrato cubre únicamente Venta → Pedido Royal One → decisión externa →
orden/paquetes Hy-Cite → entrega completa → Servicio pendiente. No crea citas
ni servicios automáticamente.

## Schema contract

### Venta y vínculo humano

`ventas.numero_nota_pedido` conserva el número de pedido Royal One; cuando
Hy-Cite lo confirme, corresponde al mismo número de orden. No se reutilizan
`ventas.estado` ni `ventas.estado_aprobacion` para hechos externos.

Agregar a `public.ventas`:

- `estado_royal_one text null`, controlado por `check`:
  `draft`, `e_signature`, `invoiced`, `canceled`.
- `fecha_pedido_royal_one date null`.
- `estado_royal_one_updated_at timestamptz null`.
- `decision_financiera_externa text null`, controlado por `check`:
  `pendiente`, `aprobada`, `rechazada`.
- `decision_financiera_externa_at timestamptz null`.
- `fuente_externa text null`, controlado por `check`:
  `manual`, `royal_one_sync`.

Agregar a `public.cliente_ordenes_hycite`:

- `venta_id uuid null references public.ventas(id)`.
- `estado_entrega text not null default 'pendiente'`, controlado por `check`:
  `pendiente`, `parcial`, `completa`, `legacy_no_derivable`.

`venta_id` solo representa un vínculo confirmado por una persona autorizada.
No es una clave de importación ni el resultado de un match automático.

### Paquetes

Crear `public.cliente_orden_hycite_paquetes`:

- `id uuid primary key default gen_random_uuid()`.
- `org_id uuid not null`.
- `orden_id uuid not null references public.cliente_ordenes_hycite(id) on delete cascade`.
- `numero_paquete text not null`.
- `numero_seguimiento text null`.
- `carrier text null`.
- `estado_paquete text not null`, controlado por `check`:
  `pendiente`, `preparando`, `enviado`, `en_transito`, `entregado`,
  `incidencia`, `devuelto`, `cancelado`.
- `fecha_envio timestamptz null`.
- `fecha_entrega timestamptz null`.
- `created_at timestamptz not null default now()`.
- `updated_at timestamptz not null default now()`.

Invariantes:

- `unique (orden_id, numero_paquete)`.
- El `org_id` del paquete debe ser igual al de la orden padre.
- La orden es la cabecera; tracking pertenece al paquete. Los campos legacy de
  tracking en la orden no son fuente para derivar múltiples paquetes.

### Tarea de servicio pendiente

Agregar a `public.crm_tareas`:

- `orden_hycite_id uuid null references public.cliente_ordenes_hycite(id)`.
- `venta_id uuid null references public.ventas(id)`.

Para `tipo = 'servicio_pendiente'`, un `check` de la misma fila exige
`contacto_tipo = 'cliente'` y `orden_hycite_id is not null`. Una RPC/trigger
transaccional exige además que `contacto_id = cliente_id` de la orden
referenciada; esa igualdad entre tablas no debe delegarse a un `CHECK`.

`venta_id` es nullable y, si existe, debe coincidir con `orden.venta_id` y con
la misma organización y cliente. Esto permite que una orden externa válida
genere servicio pendiente aunque su vínculo con venta aún no esté confirmado.

## Linking contract

La acción "Vincular venta" recibe explícitamente `orden_id` y `venta_id`.
Debe ejecutarse server-side, en una RPC transaccional y autorizada; no mediante
un `update` directo desde el cliente.

Validaciones obligatorias antes de escribir `cliente_ordenes_hycite.venta_id`:

1. Orden y venta existen y pertenecen a la organización del usuario.
2. `orden.cliente_id = venta.cliente_id` y ambos son no nulos.
3. Usuario autorizado para ambas entidades conforme a sus políticas de venta y
   cliente.
4. La UI muestra número, cliente, ítems y total disponible como evidencia de
   confirmación, pero el usuario confirma la acción de forma explícita.
5. La RPC registra actor y momento del vínculo en la auditoría operativa
   existente o, si no existe una bitácora apta, esta auditoría es un requisito
   previo de implementación.

No hay tabla puente N:M en esta fase. Si un caso real prueba cardinalidad N:M,
se detiene el diseño y se reevalúa antes de introducir datos.

## Matching rule

El candidato de vínculo puede sugerirse solo si se cumple exactamente:

`org_id + cliente_id + ventas.numero_nota_pedido = cliente_ordenes_hycite.numero_orden_hycite`.

La sugerencia no escribe `venta_id`, no cambia estados y no crea tarea. Se
excluye cualquier dato de prueba o inválido según la política de este contrato.

## RLS contract

Antes de agregar campos externos o paquetes, reemplazar las políticas actuales
de `cliente_ordenes_hycite` por políticas con las siguientes garantías:

- Toda lectura y escritura exige que `orden.org_id` sea el `org_id` del usuario
  autenticado.
- Toda lectura exige `exists` sobre `clientes c` con
  `c.id = orden.cliente_id`, `c.org_id = orden.org_id` y acceso efectivo del
  usuario bajo la política de `clientes`.
- Escritura exige la misma organización, acceso al cliente y rol administrador
  o distribuidor autorizado; no basta con un rol sin aislamiento de org.
- Insert/update debe validar `cliente_id` dentro de la misma organización.

Políticas propuestas para paquetes:

- `SELECT`: permitir solo si existe una orden padre visible al usuario y
  `paquete.org_id = orden.org_id`.
- `INSERT`, `UPDATE`, `DELETE`: permitir solo si existe una orden padre que el
  usuario puede administrar, con igualdad de `org_id`.

La migración debe eliminar o sustituir las políticas antiguas, no agregar una
segunda política permisiva. La misma revisión debe resolver las políticas
globales actuales de `crm_tareas` (`USING true` / `WITH CHECK true`) antes de
insertar tareas que revelen IDs o contexto externo.

## Package contract

La importación o actualización manual de paquete es idempotente por
`(orden_id, numero_paquete)`. Actualiza solo los hechos suministrados por
Hy-Cite; no inventa carrier, tracking ni fechas.

Una orden puede no tener paquetes. Una orden con paquetes puede tener varios
trackings. El paquete no crea por sí mismo una cita, servicio ni tarea.

## Delivery derivation

`cliente_ordenes_hycite.estado_entrega` es cache derivado, no un hecho manual.
Se recalcula dentro de la misma transacción que inserta o actualiza paquetes:

1. Sin paquetes: `pendiente`.
2. Con paquetes y todos con `estado_paquete = 'entregado'`: `completa`.
3. Con paquetes, al menos uno `entregado`, y no todos entregados: `parcial`.
4. Con paquetes y ninguno entregado: `pendiente`.

`devuelto`, `cancelado` o `incidencia` nunca cuentan como entregado. Si
impiden que todos estén entregados, el estado queda `pendiente` o `parcial`
según exista al menos un paquete entregado. No se genera servicio pendiente
para esas situaciones sin decisión operativa humana.

## Service task contract

La transición es edge-triggered: solo al pasar una orden de un estado distinto
de `completa` a `completa` por primera vez.

La transacción crea una tarea con:

- `tipo = 'servicio_pendiente'`;
- `contacto_tipo = 'cliente'`;
- `contacto_id = orden.cliente_id`;
- `orden_hycite_id = orden.id`;
- `venta_id = orden.venta_id` si está confirmado; de lo contrario `null`;
- responsable: `clientes.vendedor_id`, con fallback definido explícitamente a
  distribuidor/cola operativa antes de implementar;
- `estado = 'pendiente'`, fecha de vencimiento definida por regla operativa;
- descripción con el número de orden y el hecho "entrega completa confirmada".

La tarea actualiza `clientes.next_action = 'Contactar para coordinar servicio'`
y `next_action_date` como resumen de trabajo. Esto alimenta Hoy/Todo sin crear
`citas` ni `servicios`. La cita y el servicio se crean solo luego de confirmar
con el cliente.

## Idempotency

La protección no depende de `IF NOT EXISTS` aplicativo. Crear un índice único
parcial en DB:

```sql
unique (orden_hycite_id)
where tipo = 'servicio_pendiente'
```

Esto garantiza una sola tarea de servicio pendiente por orden durante toda su
vida, incluso ante reintentos concurrentes o cambios posteriores de paquetes.
La inserción y la actualización del cache de entrega deben ocurrir en la misma
transacción; una violación de unicidad se trata como resultado idempotente.

## Legacy strategy

Las 31 órdenes actuales no tienen paquetes. No se crean paquetes sintéticos ni
se marca entrega completa por ausencia de paquetes.

- Conservar `numero_seguimiento`, `estado_envio`, `fecha_envio` y
  `fecha_entrega` actuales como snapshot legacy visible.
- Inicializar o clasificar estas órdenes como `legacy_no_derivable`, no como
  `completa`, cuando no exista detalle de paquete verificable.
- No generar tareas de servicio desde campos legacy.
- Un backfill futuro será manual y controlado: solo crea paquetes cuando una
  fuente Hy-Cite verificable aporte número de paquete/tracking/estado/fechas.

## Test data policy

Excluir de toda sugerencia automática, vínculo candidato, importación
automática y generación de tareas números que, tras `trim` y normalización a
mayúsculas, cumplan:

- prefijo `TEST-`;
- valor exacto `HY-CITE-001`;
- valor vacío, nulo o marcador documentado;
- formatos que no satisfagan el patrón de número externo aprobado por
  operación.

La exclusión es defensiva en servidor y en UI. Los datos quedan visibles para
auditoría, pero solo pueden corregirse mediante operación humana explícita.

## Migration order

1. Auditar y reemplazar RLS de órdenes/items; corregir RLS de tareas antes de
   exponer IDs externos en ellas.
2. Agregar campos externos a `ventas` y `venta_id`/`estado_entrega` a órdenes,
   sin backfill automático.
3. Crear tabla de paquetes, constraints, índices y RLS heredado por padre.
4. Agregar referencias de tarea, checks e índice único parcial de idempotencia.
5. Implementar RPC transaccional de vínculo humano y la operación de
   importación/actualización de paquete con derivación de entrega.
6. Implementar UI de candidato, confirmación humana y cola de tareas; luego
   pruebas de concurrencia, RLS, legado y no-creación de citas automáticas.

## Risks and acceptance gates

- No implementar si la operación no confirma el formato válido de número
  externo, el responsable fallback o la fecha de vencimiento de la tarea.
- No asumir que toda orden Royal One/Hy-Cite mantiene relación 1:1 sin muestras
  de cancelación, reemisión y envío dividido.
- No escribir estados externos desde flujos CRM internos.
- El estado `completa` solo puede venir de paquetes verificables, nunca de un
  tracking legacy agregado.

La especificación está lista para diseño de migración solo después de aprobar
la política RLS de `crm_tareas` y las reglas operativas pendientes.
