# CWG Academy Harness

Este harness valida el BLOQUE 1 de CWG Academy en una base local aislada, sin depender de la cadena historica completa de migraciones de FlowSuiteCRM.

## Archivos

- `00_prerequisites.sql`
  - Crea solo los prerrequisitos reales usados por la migracion Academy:
  - `auth.users`
  - `public.usuario_rol`
  - `public.usuarios` con `org_id`
  - `public.plan_limits`
  - `public.organizations`
  - `public.memberships`
  - `public.is_org_member()`
  - `public.is_org_admin()`
  - `public.fn_set_updated_at()`
- `01_apply_academy_core.sql`
  - Aplica sin modificar `../../migrations/20260730230936_create_cwg_academy_core.sql`
- `02_academy_core_tests.sql`
  - Ejecuta pruebas positivas y negativas sobre tablas, enums, FKs, uniques, triggers y rechazo cross-org

## Ejecucion sugerida

1. Crear una base temporal local, por ejemplo `academy_harness`.
2. Ejecutar en orden:
   1. `00_prerequisites.sql`
   2. `01_apply_academy_core.sql`
   3. `02_academy_core_tests.sql`

## Alcance

El harness valida que la migracion Academy:

- aplique limpia;
- cree todos los objetos `academy_*`;
- respete integridad cross-org por FKs compuestas;
- mantenga consistencia `enrollment/user/course`;
- use join relacional para multiple choice;
- cree triggers `updated_at`.

No valida frontend, RLS final de Academy ni el reset completo del repo.
