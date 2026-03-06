# Checklist UI - Conexiones Infinitas

## Objetivo
Validar el flujo end-to-end de Conexiones Infinitas luego de aplicar las politicas de RLS y los cambios de frontend.

## Precondiciones
- Usuario autenticado.
- Migracion 0035 aplicada en Supabase.
- Existe al menos una activacion creada.

## Checklist
1) Abrir modulo
- Ir a Programas -> Conexiones infinitas.
- Confirmar que la tabla de activaciones carga sin errores en consola.

2) Abrir lista (dueno de la lista)
- Click en una fila de activacion (quien dio la lista).
- Verificar que el panel lateral se abre y muestra info del dueno.
- Confirmar que no hay errores 400/403 en consola.

3) Agregar referido (rol vendedor)
- En el panel lateral, click Agregar referido.
- Completar nombre, telefono y relacion.
- Click Guardar.
- Esperado: se crea y aparece en la lista, sin error de RLS.

4) Validar campos obligatorios
- Intentar guardar sin nombre o sin telefono.
- Esperado: error de validacion local, no inserta.

5) Validar gestionado_por_usuario_id
- En Supabase, verificar que el referido nuevo tiene:
  - modo_gestion = vendedor_directo
  - gestionado_por_usuario_id = auth.uid() del usuario que lo creo

6) Rol admin/distribuidor/supervisor
- Iniciar sesion con rol admin/distribuidor/supervisor_tele.
- Abrir una activacion donde NO sea owner/representante.
- Intentar agregar referido.
- Esperado: permite insertar.

7) Usuario sin permiso
- Iniciar sesion con usuario sin relacion con la activacion.
- Intentar agregar referido.
- Esperado: mensaje amigable "No tienes permiso para agregar referidos a esta lista" y no inserta.

8) Lectura por rol
- Vendedor: solo ve referidos de activaciones donde es owner/representante.
- Admin/Distribuidor/Supervisor: ve referidos de activaciones del equipo.
