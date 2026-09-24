# Flow Maestro Royal Prestige

## Lifecycle canónico

Lead → Contacto → Cita/Demo → Venta → Pedido Royal One →
Decisión Royal One/financiera → Cliente → Orden Hy-Cite → Paquete(s)/Tracking →
Entrega → Cita de servicio → Servicio realizado →
Satisfacción/Referidos → Seguimiento/Mantenimiento → Nueva oportunidad → Referidos

## Sistemas y fuentes de verdad

FlowSuiteCRM es el sistema de management y control; no sustituye Royal One ni
Hy-Cite.

| Sistema | Hechos que origina o controla |
| --- | --- |
| FlowSuiteCRM | Lead, contacto, cita/demo, venta CRM, reflejo y seguimiento de estados externos, próximas acciones y servicio. |
| Royal One | Creación del pedido, documentación/aplicación de crédito, sometimiento y decisión aprobada o rechazada. |
| Hy-Cite | Cuenta/orden, paquetes, tracking y entrega. |

Flujo operativo:

1. FlowSuiteCRM: Lead → Contacto → Cita/Demo → Venta.
2. Royal One: crear pedido → documentación/aplicación de crédito → someter →
   esperar decisión → aprobado/rechazado.
3. Si es aprobado: Royal One procesa/envía; Hy-Cite expone cuenta/orden,
   paquete(s), tracking y entrega.
4. FlowSuiteCRM refleja y sigue esos hechos externos; tras entrega confirmada,
   genera Servicio pendiente, contacta al cliente y agenda una cita solo con
   confirmación humana.

Evidencia operativa confirmada: en el caso revisado, pedido Royal One
`151373032` = orden Hy-Cite `151373032`.

## Reglas de operación

- El cliente no termina en "Entregado".
- Buscar referidos durante demo/venta y durante servicio/postservicio.
- Mantenimiento debe generar futuras acciones según producto.
- Trabajar una sola fase del Flow Maestro a la vez.
- No implementar etapas futuras sin autorización explícita.
- Registrar ideas futuras como backlog; no implementarlas.
- Antes de trabajo RP, leer este documento.
- Auditar y reutilizar módulos y lógica existentes antes de crear algo nuevo.
- FlowSuiteCRM es sistema de control, no sistema originador del pedido.
- No crear pedidos Hy-Cite ficticios ni simular decisiones financieras.
- No confundir un estado interno CRM con una decisión externa de Royal One o
  financiera.
- Royal One y Hy-Cite son las fuentes externas de esos hechos; FlowSuiteCRM
  los registra o sincroniza y genera próximas acciones.
- El tracking pertenece a un paquete/envío; un paquete entregado no implica
  necesariamente que la orden completa esté entregada.

## Reutilizar primero

- `cliente_ordenes_hycite`
- `servicios`
- `equipos_instalados`
- `citas`
- `crm_tareas`
- `next_action`

No crear sistemas paralelos si el modelo existente sirve.

## Fase actual autorizada

Venta → Pedido Royal One → Decisión externa aprobada → Cliente →
Orden Hy-Cite → Paquete(s)/Tracking → Entrega → Servicio pendiente →
Cita de servicio → Servicio realizado

## Límites de la fase actual

- Incluye el reflejo operativo de la decisión externa aprobada, la relación
  entre cliente, pedido Royal One y orden Hy-Cite, paquete(s)/tracking,
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
