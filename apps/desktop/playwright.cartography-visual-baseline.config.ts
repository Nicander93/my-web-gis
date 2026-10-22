import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/cartography-geoserver-visual-baseline.e2e.ts',
  workers: 1,
  timeout: 120_000,
  reporter: [['list'], ['json', { outputFile: './test-results/cartography-visual-baseline/playwright-results.json' }]],
  outputDir: './test-results/cartography-visual-baseline/playwright',
  use: {
    baseURL: 'http://127.0.0.1:5183',
    screenshot: 'off',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? ['--no-sandbox', '--disable-dev-shm-usage'] : []
    },
    viewport: { width: 256, height: 256 },
    deviceScaleFactor: 1
  },
  webServer: {
    command: 'pnpm --filter @desktop-webgis/desktop exec vite --configLoader runner --mode cartography --host 127.0.0.1 --port 5183 --strictPort',
    url: 'http://127.0.0.1:5183/cartography-visual-baseline.html',
    reuseExistingServer: false,
    timeout: 60_000
  }
})
