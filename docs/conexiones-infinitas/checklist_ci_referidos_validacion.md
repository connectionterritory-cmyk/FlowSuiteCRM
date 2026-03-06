# Checklist de Validación — ci_referidos (post migración 0035)

## DB / SQL

```sql
-- 1. Verificar policies activas
SELECT policyname, cmd, permissive
FROM pg_policies
WHERE tablename = 'ci_referidos'
  AND policyname IN ('ci_referidos_insert', 'ci_referidos_select');

-- 2. Smoke test INSERT
INSERT INTO public.ci_referidos (activacion_id, nombre, telefono, modo_gestion)
VALUES ('<ACTIVACION_ID>', 'Prueba Referido', '555-0101', 'vendedor_directo');

-- 3. Verificar gestor asignado
SELECT id, nombre, telefono, modo_gestion, gestionado_por_usuario_id
FROM public.ci_referidos
WHERE nombre = 'Prueba Referido'
ORDER BY created_at DESC
LIMIT 1;

-- 4. Cleanup
DELETE FROM public.ci_referidos
WHERE nombre = 'Prueba Referido' AND telefono = '555-0101';
```

## UI — End-to-End

| # | Paso | Esperado |
|---|------|----------|
| 1 | Ir a Programas → Conexiones Infinitas | Tabla de activaciones carga sin errores en consola |
| 2 | Click en una activación | Panel lateral abre, info del dueño visible, sin 400/403 |
| 3 | Role **vendedor** — Agregar referido (nombre + teléfono + relación) | Referido creado, aparece en lista, sin error RLS |
| 4 | Intentar guardar con campos vacíos | Error de validación local, no inserta |
| 5 | Supabase: revisar registro nuevo | `modo_gestion = 'vendedor_directo'`, `gestionado_por_usuario_id = auth.uid()` del creador |
| 6 | Role **admin/distribuidor** — activación ajena, agregar referido | Permite insertar (policy migración 0035) |
| 7 | Usuario sin relación con la activación, agregar referido | Mensaje: "No tienes permiso para agregar referidos a esta lista." — no inserta |
| 8 | Lectura por rol: vendedor | Solo ve referidos de activaciones donde es owner/representante |
| 9 | Lectura por rol: admin/distribuidor | Ve referidos de activaciones del equipo |

## Referencias

- Migración: `supabase/migrations/0035_ci_referidos_insert_policy_scope.sql`
- Policy SELECT previa: `supabase/migrations/0014_ci_activaciones_scope_rls.sql`
- Frontend insert: `flowsuitecrm/src/components/ActivacionReferidosPanel.tsx` — `handleAddNewReferido()`
- Frontend hook: `flowsuitecrm/src/hooks/useConexiones.ts` — `addReferido()`, `createActivacion()`
