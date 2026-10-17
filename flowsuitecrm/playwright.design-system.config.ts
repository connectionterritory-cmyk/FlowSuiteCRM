import { defineConfig, devices } from '@playwright/test'

// Pruebas del Design System (showcase /design-system.html). No tocan Supabase ni /cartera.
export default defineConfig({
  testDir: './tests/design-system',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4180' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180/design-system.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
