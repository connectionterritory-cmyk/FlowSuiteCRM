import { expect, test } from '@playwright/test'

const routes = ['/hub', '/dashboard', '/leads', '/clientes', '/citas', '/inbox']
const storageKey = 'sb-rxiarmbosgivaplygqug-auth-token'

const fakeSession = {
  access_token: 'playwright-fake-access-token',
  refresh_token: 'playwright-fake-refresh-token',
  expires_in: 3600,
  expires_at: 2208988800,
  token_type: 'bearer',
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'playwright@local.test',
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    phone: '',
    confirmed_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: '2026-01-01T00:00:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {
      first_name: 'Playwright',
      last_name: 'Tester',
      full_name: 'Playwright Tester',
      name: 'Playwright Tester',
    },
    identities: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, session }) => {
      window.localStorage.setItem(key, JSON.stringify(session))
    },
    { key: storageKey, session: fakeSession },
  )
})

test.describe('CWG Business Hub smoke validation', () => {
  for (const route of routes) {
    test(`route ${route} loads`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}(?:\\/)?$`))
      await expect(page.locator('body')).toBeVisible()
    })
  }

  test('hub branding is visible on desktop/mobile', async ({ page }) => {
    await page.goto('/hub')

    await expect(page.locator('.hub-kicker')).toHaveText('Connection Worldwide Group')
    await expect(page.getByRole('heading', { name: /CWG Business Hub/i })).toBeVisible()
    await expect(page.getByText(/Powered by FlowSuite CRM/i)).toBeVisible()
  })

  test('hub operational stat cards are visible', async ({ page }) => {
    await page.goto('/hub')

    await expect(page.getByText(/Leads nuevos/i)).toBeVisible()
    await expect(page.getByText(/Citas hoy/i)).toBeVisible()
    await expect(page.getByText(/Tareas pendientes/i)).toBeVisible()
  })

  test('commissions remain placeholders', async ({ page }) => {
    await page.goto('/hub')

    await expect(page.getByText(/Comisiones estimadas/i)).toBeVisible()
    await expect(page.getByText(/Comisiones aprobadas/i)).toBeVisible()
    await expect(page.getByText(/Comisiones pagadas/i)).toBeVisible()
    await expect(page.getByText(/Disponible pronto/i).first()).toBeVisible()
  })

  test('mobile bottom navigation has expected primary items', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only validation')

    await page.goto('/hub')
    const mobileNav = page.locator('nav[aria-label="Mobile"]')

    await expect(mobileNav.getByRole('link', { name: /^Hub$/i })).toBeVisible()
    await expect(mobileNav.getByRole('link', { name: /^(Leads|Prospectos)$/i })).toBeVisible()
    await expect(mobileNav.getByRole('link', { name: /^Clientes$/i })).toBeVisible()
    await expect(mobileNav.getByRole('button', { name: /^Más$/i })).toBeVisible()
  })

  test('mobile more drawer opens', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only validation')

    await page.goto('/hub')
    const mobileNav = page.locator('nav[aria-label="Mobile"]')
    await mobileNav.getByRole('button', { name: /^Más$/i }).click()
    const mobileDrawer = page.locator('aside.sidebar.mobile-open')

    await expect(mobileDrawer.getByRole('link', { name: /^Dashboard$/i })).toBeVisible()
    await mobileDrawer.locator('.nav-group-trigger').filter({ hasText: /CRM/i }).click()
    await expect(mobileDrawer.getByRole('link', { name: /^Citas$/i })).toBeVisible()
    await expect(mobileDrawer.getByRole('link', { name: /^Inbox$/i })).toBeVisible()
  })
})
