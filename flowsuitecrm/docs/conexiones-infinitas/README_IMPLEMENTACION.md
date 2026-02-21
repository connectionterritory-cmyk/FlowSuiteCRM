# Implementacion - Conexiones Infinitas

Este documento describe la estructura estandar para separar logica de datos, utilidades y SQL para el modulo Conexiones Infinitas.

## Objetivo

- Centralizar validaciones y constantes en utilidades.
- Encapsular operaciones Supabase en un hook.
- Automatizar la creacion de leads al marcar difusion como enviada.
- Mantener la UI limpia y enfocada solo en presentacion.

## Archivos creados

- `src/lib/conexiones/validaciones.ts`
- `src/hooks/useConexiones.ts`
- `src/modules/conexiones-infinitas/ConexionesActivacionesTab_ejemplo.tsx`
- `supabase/migration_trigger_leads.sql`

## Pasos de implementacion

1) Ejecutar el SQL en Supabase

- Abrir el SQL editor en Supabase.
- Ejecutar `supabase/migration_trigger_leads.sql`.
- Esto crea un indice unico en `leads.telefono` y el trigger para autogenerar leads cuando se envia la difusion.

2) Usar las utilidades y el hook

- Importar desde `src/lib/conexiones/validaciones.ts` para formateo/normalizacion.
- Usar `useConexiones` para cargar datos y realizar operaciones CRUD.

3) Refactorizar el componente actual

- Mover llamadas directas a Supabase dentro del hook.
- Usar el ejemplo en `ConexionesActivacionesTab_ejemplo.tsx` como guia.

## Consideraciones

- El trigger asume que `ci_referidos.telefono` ya viene normalizado (solo digitos).
- El trigger inserta leads con `fuente = conexiones_infinitas` y `estado_pipeline = nuevo`.
- Si hay leads duplicados por telefono, el indice unico evita duplicados.

## Pruebas recomendadas

- Crear activacion con referidos validos.
- Marcar `whatsapp_mensaje_enviado_at` y verificar que se crean leads.
- Revisar que `ci_referidos.lead_id` se vincula automaticamente.

## Checklist rapido para telemercadeo

- Crear activacion con referidos validos.
- Subir foto y marcar "Enviado".
- Confirmar toast "Mensaje enviado y Lead registrado".
- Verificar que los leads aparezcan en el modulo de leads.
- Confirmar que `ci_referidos.lead_id` quede vinculado.
