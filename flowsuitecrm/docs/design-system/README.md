# FlowSuite Design System — Phase 0

Alcance: tokens `--fs-*`, Tailwind v4 aislado, y los primitivos **Button**, **Badge** y **Tabs**
(Radix Slot/Tabs + class-variance-authority). Nada de Supabase, finanzas ni `/cartera`.

## Reglas de aislamiento
- Sin preflight de Tailwind (no hay reset global). Solo `theme` + `utilities` con prefijo `tw:`.
- Tailwind solo escanea `src/design-system/` (`source(none)` + `@source "./"`).
- Los tokens usan el prefijo `--fs-*` y viven en `body` para seguir `body.theme-light`.
- El único cambio global en la app es `import './design-system/design-system.css'` en `src/main.tsx`.
- Los componentes existentes (`src/components/*`) no se tocan ni se reemplazan en esta fase.
- La página `design-system.html` es solo para desarrollo y no se publica (no está en el build).

## Uso
```tsx
import { Button, Badge, Tabs, TabsList, TabsTrigger, TabsContent } from '../design-system'
```
Las clases llevan prefijo: `tw:bg-fs-primary`, `tw:text-fs-sm`. Usa `cn()` para combinar.

## Verificación
- `npm run build && npm run check:design-system` — aislamiento del CSS de producción.
- `npm run test:unit` — `cn` y variantes (prefijo `tw:`, sin colores crudos).
- `npm run test:design-system` — Playwright sobre el showcase (roles ARIA, teclado, contraste AA,
  no-regresión de estilos legacy, móvil). Genera las capturas de `docs/design-system/phase0/`.
