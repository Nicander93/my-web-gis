import { defineConfig } from '@playwright/test'
import base from './playwright.config'

const port = Number(process.env.PROCESSING_PREVIEW_PORT ?? 5218)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  ...base,
  testMatch: 'geolibre-production.e2e.ts',
  testIgnore: [],
  outputDir: '../../.artifacts/processing-production',
  use: { ...base.use, baseURL, screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } },
  projects: [{ name: 'production', use: { viewport: { width: 1440, height: 900 } } }],
  webServer: { command: `pnpm preview --host 127.0.0.1 --port ${port} --strictPort`, url: baseURL, reuseExistingServer: false, timeout: 30_000 }
})
