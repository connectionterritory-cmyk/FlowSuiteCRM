import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const THEMES = ['dark', 'light'] as const
const EVIDENCE_DIR = join(process.cwd(), 'docs', 'design-system', 'phase0')

const open = async (page: Page, theme: (typeof THEMES)[number]) => {
  await page.goto(`/design-system.html?theme=${theme}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

// Contraste WCAG calculado en el navegador, componiendo fondos con alfa sobre los ancestros.
const contrastOf = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((elements) => {
    const parse = (value: string) => {
      const m = value.match(/rgba?\(([^)]+)\)/)
      if (!m) return [0, 0, 0, 1]
      const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
      return [parts[0], parts[1], parts[2], parts[3] ?? 1]
    }
    const blend = (top: number[], bottom: number[]) => {
      const a = top[3]
      return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat([1])
    }
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const backgroundOf = (el: Element) => {
      const stack: number[][] = []
      for (let node: Element | null = el; node; node = node.parentElement) {
        stack.push(parse(getComputedStyle(node).backgroundColor))
      }
      return stack.reverse().reduce((acc, layer) => (layer[3] === 0 ? acc : blend(layer, acc)), [255, 255, 255, 1])
    }
    return elements.map((el) => {
      const fg = parse(getComputedStyle(el).color)
      const bg = backgroundOf(el)
      const l1 = lum(blend(fg, bg))
      const l2 = lum(bg)
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      return { text: (el.textContent ?? '').trim(), ratio: Math.round(ratio * 100) / 100, disabled: (el as HTMLButtonElement).disabled === true }
    })
  })

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test('Button variants/sizes render with FlowSuite tokens and touch-friendly size', async ({ page }) => {
      await open(page, theme)
      const sizes = page.getByTestId('button-sizes')
      const md = sizes.getByRole('button', { name: 'Medium' })
      const box = await md.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(40)
      const small = await sizes.getByRole('button', { name: 'Small' }).boundingBox()
      expect(small!.height).toBeGreaterThanOrEqual(32)
      const icon = await sizes.getByRole('button', { name: 'Agregar' }).boundingBox()
      expect(icon!.width).toBeGreaterThanOrEqual(40)
      const primaryBg = await page.getByTestId('button-variants').getByRole('button', { name: 'default' }).evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(primaryBg).toBe('rgb(37, 99, 235)')
      const disabled = sizes.getByRole('button', { name: 'Disabled' })
      await expect(disabled).toBeDisabled()
      await expect(sizes.getByRole('link', { name: /asChild/ })).toBeVisible()
    })

    test('contrast of Button, Badge and Tabs text is at least WCAG AA (4.5:1)', async ({ page }) => {
      await open(page, theme)
      const results = [
        ...(await contrastOf(page, '[data-testid="button-variants"] button')),
        ...(await contrastOf(page, '[data-testid="badges"] span')),
        ...(await contrastOf(page, '[data-testid="tabs-demo"] [role="tab"]:not([disabled])')),
      ].filter((r) => !r.disabled)
      expect(results.length).toBeGreaterThan(10)
      const low = results.filter((r) => r.ratio < 4.5)
      expect(low, `Bajo contraste: ${JSON.stringify(low)}`).toEqual([])
    })

    test('Tabs expose ARIA roles and support click and arrow-key navigation', async ({ page }) => {
      await open(page, theme)
      const demo = page.getByTestId('tabs-demo')
      await expect(demo.getByRole('tablist', { name: 'Secciones de ejemplo' })).toBeVisible()
      const resumen = demo.getByRole('tab', { name: 'Resumen' })
      await expect(resumen).toHaveAttribute('aria-selected', 'true')
      await expect(demo.getByRole('tabpanel')).toContainText('Contenido de Resumen.')

      await demo.getByRole('tab', { name: 'Documentos' }).click()
      await expect(demo.getByRole('tab', { name: 'Documentos' })).toHaveAttribute('aria-selected', 'true')
      await expect(demo.getByRole('tabpanel')).toContainText('Contenido de Documentos.')

      await demo.getByRole('tab', { name: 'Documentos' }).focus()
      await page.keyboard.press('ArrowRight')
      await expect(demo.getByRole('tab', { name: 'Notas' })).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('ArrowLeft')
      await expect(demo.getByRole('tab', { name: 'Documentos' })).toHaveAttribute('aria-selected', 'true')

      // La pestaña deshabilitada se omite y nunca se activa.
      await demo.getByRole('tab', { name: 'Ajustes' }).click()
      await page.keyboard.press('ArrowRight')
      await expect(demo.getByRole('tab', { name: 'Deshabilitada' })).toBeDisabled()
      await expect(demo.getByRole('tab', { name: 'Deshabilitada' })).toHaveAttribute('aria-selected', 'false')
    })

    test('keyboard focus is visible on Button and Tab', async ({ page }) => {
      await open(page, theme)
      const button = page.getByTestId('button-variants').getByRole('button', { name: 'default' })
      await button.focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await expect(button).toBeFocused()
      const outline = await button.evaluate((el) => { const s = getComputedStyle(el); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) } })
      expect(outline.style).not.toBe('none')
      expect(outline.width).toBeGreaterThanOrEqual(2)
    })

    test('does not alter legacy styles: removing the Design System CSS changes nothing', async ({ page }) => {
      await open(page, theme)
      const snapshot = () => page.evaluate(() => {
        const pick = ['backgroundColor', 'color', 'fontSize', 'fontWeight', 'padding', 'borderRadius', 'borderTopWidth', 'display', 'lineHeight', 'fontFamily', 'boxSizing', 'margin']
        const els = [document.body, ...document.querySelectorAll('.btn.primary, .btn.ghost, .badge.gold, .badge.emerald')]
        return els.map((el) => { const s = getComputedStyle(el); return Object.fromEntries(pick.map((k) => [k, (s as unknown as Record<string, string>)[k]])) })
      })
      const before = await snapshot()
      const removed = await page.evaluate(() => {
        const styles = [...document.querySelectorAll('style[data-vite-dev-id]')].filter((s) => (s.getAttribute('data-vite-dev-id') ?? '').includes('design-system.css'))
        styles.forEach((s) => s.remove())
        return styles.length
      })
      expect(removed).toBeGreaterThan(0)
      const after = await snapshot()
      expect(after).toEqual(before)
    })

    test('captures evidence screenshot', async ({ page }, testInfo) => {
      await open(page, theme)
      mkdirSync(EVIDENCE_DIR, { recursive: true })
      await page.screenshot({ path: join(EVIDENCE_DIR, `primitives-${theme}-${testInfo.project.name}.png`), fullPage: true })
    })
  })
}

test('mobile layout has no horizontal page overflow and tab list scrolls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'solo móvil')
  await open(page, 'dark')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const list = page.getByRole('tablist')
  const metrics = await list.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth, overflowX: getComputedStyle(el).overflowX }))
  expect(metrics.overflowX).toBe('auto')
  expect(metrics.client).toBeLessThanOrEqual(page.viewportSize()!.width)
})
