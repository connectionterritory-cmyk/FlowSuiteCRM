import { Badge, Button, Tabs, TabsContent, TabsList, TabsTrigger } from '..'

const BUTTON_VARIANTS = ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const
const BADGE_VARIANTS = ['neutral', 'info', 'success', 'warning', 'danger', 'outline'] as const
const SWATCHES = [
  'fs-bg', 'fs-surface', 'fs-surface-muted', 'fs-fg', 'fs-fg-muted', 'fs-border', 'fs-primary',
  'fs-info-soft', 'fs-success-soft', 'fs-warning-soft', 'fs-danger', 'fs-danger-soft',
] as const

const section = { marginTop: '2rem' } as const
const row = { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem' } as const
const h2 = { margin: 0, fontSize: '1.1rem', color: 'var(--fs-fg)' } as const
const note = { margin: '0.25rem 0 0', color: 'var(--fs-fg-muted)', fontSize: '0.8125rem' } as const

export function Showcase() {
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 64px', background: 'var(--fs-bg)', color: 'var(--fs-fg)' }}>
      <h1 style={{ margin: 0, fontSize: '1.5rem' }}>FlowSuite Design System — Phase 0</h1>
      <p style={note}>Tokens --fs-*, Button, Badge y Tabs. Página solo de desarrollo.</p>

      <section style={section} aria-labelledby="ds-tokens">
        <h2 id="ds-tokens" style={h2}>Tokens de color</h2>
        <div style={{ ...row, alignItems: 'stretch' }}>
          {SWATCHES.map((name) => (
            <div key={name} style={{ width: 120 }}>
              <div data-swatch={name} style={{ height: 40, borderRadius: 8, border: '1px solid var(--fs-border)', background: `var(--${name})` }} />
              <div style={{ fontSize: '0.75rem', marginTop: 4, color: 'var(--fs-fg-muted)' }}>--{name}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={section} aria-labelledby="ds-button">
        <h2 id="ds-button" style={h2}>Button</h2>
        <div style={row} data-testid="button-variants">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>{variant}</Button>
          ))}
        </div>
        <div style={row} data-testid="button-sizes">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Agregar">+</Button>
          <Button disabled>Disabled</Button>
          <Button asChild variant="outline"><a href="#ds-button">Como enlace (asChild)</a></Button>
        </div>
        <p style={note}>Comparación con el botón legacy (no modificado):</p>
        <div style={row}>
          <button type="button" className="btn primary">Legacy primary</button>
          <button type="button" className="btn ghost">Legacy ghost</button>
        </div>
      </section>

      <section style={section} aria-labelledby="ds-badge">
        <h2 id="ds-badge" style={h2}>Badge</h2>
        <div style={row} data-testid="badges">
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>{variant}</Badge>
          ))}
        </div>
        <p style={note}>Comparación con el badge legacy (no modificado):</p>
        <div style={row}>
          <span className="badge gold">Legacy gold</span>
          <span className="badge emerald">Legacy emerald</span>
        </div>
      </section>

      <section style={section} aria-labelledby="ds-tabs">
        <h2 id="ds-tabs" style={h2}>Tabs</h2>
        <div style={{ marginTop: '0.75rem' }} data-testid="tabs-demo">
          <Tabs defaultValue="resumen">
            <TabsList aria-label="Secciones de ejemplo">
              <TabsTrigger value="resumen">Resumen</TabsTrigger>
              <TabsTrigger value="actividad">Actividad</TabsTrigger>
              <TabsTrigger value="documentos">Documentos</TabsTrigger>
              <TabsTrigger value="notas">Notas</TabsTrigger>
              <TabsTrigger value="ajustes">Ajustes</TabsTrigger>
              <TabsTrigger value="bloqueada" disabled>Deshabilitada</TabsTrigger>
            </TabsList>
            <TabsContent value="resumen">Contenido de Resumen.</TabsContent>
            <TabsContent value="actividad">Contenido de Actividad.</TabsContent>
            <TabsContent value="documentos">Contenido de Documentos.</TabsContent>
            <TabsContent value="notas">Contenido de Notas.</TabsContent>
            <TabsContent value="ajustes">Contenido de Ajustes.</TabsContent>
            <TabsContent value="bloqueada">No debería mostrarse.</TabsContent>
          </Tabs>
        </div>
      </section>
    </main>
  )
}
