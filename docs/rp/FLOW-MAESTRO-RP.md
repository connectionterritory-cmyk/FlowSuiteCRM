# Flow Maestro Royal Prestige

## Lifecycle canónico

Lead → Contacto → Demo → Venta → Aprobación → Cliente → Pedido Hy-Cite →
Tracking/Envío → Entrega → Cita de servicio → Servicio realizado →
Satisfacción/Referidos → Seguimiento/Mantenimiento → Nueva oportunidad → Referidos

## Reglas de operación

- El cliente no termina en "Entregado".
- Buscar referidos durante demo/venta y durante servicio/postservicio.
- Mantenimiento debe generar futuras acciones según producto.
- Trabajar una sola fase del Flow Maestro a la vez.
- No implementar etapas futuras sin autorización explícita.
- Registrar ideas futuras como backlog; no implementarlas.
- Antes de trabajo RP, leer este documento.
- Auditar y reutilizar módulos y lógica existentes antes de crear algo nuevo.

## Reutilizar primero

- `cliente_ordenes_hycite`
- `servicios`
- `equipos_instalados`
- `citas`
- `crm_tareas`
- `next_action`

No crear sistemas paralelos si el modelo existente sirve.

## Fase actual autorizada

Venta aprobada → Cliente → Pedido Hy-Cite → Tracking/Envío → Entrega →
Servicio pendiente → Cita de servicio → Servicio realizado

## Límites de la fase actual

- Incluye el vínculo operativo entre cliente y pedido Hy-Cite, tracking/envío,
  confirmación de entrega y preparación de servicio pendiente.
- Una entrega confirmada puede generar "Servicio pendiente", pero no programa
  automáticamente una visita.
- La cita de servicio requiere confirmación humana con el cliente.
- Gap estructural inicial conocido: falta trazabilidad directa entre venta y
  orden Hy-Cite.
- Referidos y mantenimiento permanecen en backlog y no deben implementarse
  todavía.

## Backlog futuro

- Satisfacción postservicio.
- Captura y seguimiento de referidos.
- Mantenimiento recurrente según producto.
- Nueva oportunidad desde cliente o referido.
