import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import desktop from './playwright.config'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  ...desktop,
  testMatch: '**/viewer-document.e2e.ts',
  outputDir: '../test-results/viewer-document',
  testIgnore: [],
  use: { ...desktop.use, baseURL: 'http://127.0.0.1:5174' },
  webServer: {
    command: 'pnpm --filter @desktop-webgis/viewer dev --host 127.0.0.1 --port 5174 --strictPort',
    cwd: desktopRoot,
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 30_000
  }
})
