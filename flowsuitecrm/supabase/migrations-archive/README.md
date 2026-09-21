# Migraciones locales retiradas

`20260919012125_create_fn_convertir_lead_a_cliente.sql.disabled` es una copia
local stale, conservada byte por byte fuera del directorio activo `migrations/`.
No ejecutarla ni devolverla al historial activo. Sus comentarios de equivalencia
con producción no son válidos: omite FOR UPDATE y lead_not_active.

El diagnóstico aportado por el usuario indica que la versión 20260919012125 ya
está registrada en producción y no en staging. Archivar esta copia no modifica
el historial remoto ni autoriza borrar/reparar registros de migraciones.
La definición real de producción fue consultada de nuevo en modo lectura:
md5(prosrc) = d7e46a5c18298d9dc3ee8593bd6ed08b. Su cuerpo previo a Fase 1
no contiene auth.uid() ni validación de organización/rol; esas protecciones
pertenecen a la migración de Fase 1, todavía no desplegada.

El reemplazo operativo es la nueva versión
`20260920162341_reconcile_fn_convertir_lead_a_cliente.sql`, seguida de Fase 1.
Instala el cuerpo canónico exacto y revoca EXECUTE a PUBLIC/anon/authenticated;
Fase 1 añade autorización y habilita la ejecución autenticada. No reutiliza el
SQL archivado ni cambia su registro remoto. El archivo activo de versión
20260919012125 se conserva como NO-OP de solo comentarios: en producción ya
aplicada se omite; en staging se registra sin instalar la definición stale.

SHA256 de los bytes archivados:
`d9fd7c0fb139c9502451a2038277a35259ed7c3c4bc79e27e830336cda714254`.
