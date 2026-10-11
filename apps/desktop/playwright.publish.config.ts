import { defineConfig } from '@playwright/test'
import desktop from './playwright.config'

export default defineConfig({
  ...desktop,
  testMatch: '**/desktop-viewer-workflow.e2e.ts',
  testIgnore: [],
  use: { ...desktop.use, baseURL: 'http://127.0.0.1:5177' },
  webServer: [
    {
      command: 'pnpm dev --port 5177 --strictPort',
      url: 'http://127.0.0.1:5177', reuseExistingServer: false, timeout: 30_000
    },
    {
      command: 'pnpm --filter @desktop-webgis/viewer dev --host 127.0.0.1 --port 5178 --strictPort',
      url: 'http://127.0.0.1:5178', reuseExistingServer: false, timeout: 30_000
    }
  ]
})
