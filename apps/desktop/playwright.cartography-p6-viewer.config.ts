import { defineConfig } from '@playwright/test'
import viewer from './playwright.viewer.config'

export default defineConfig({
  ...viewer,
  projects: [{ name: 'p6-viewer', use: { viewport: { width: 1440, height: 900 } } }],
  use: { ...viewer.use, baseURL: 'http://127.0.0.1:5187', screenshot: 'off' },
  outputDir: 'test-results/cartography-p6-viewer/artifacts',
  reporter: [['list'], ['json', { outputFile: 'test-results/cartography-p6-viewer/results.json' }]],
  webServer: { command: 'pnpm --filter @desktop-webgis/viewer exec vite --config vite.config.mjs --configLoader runner --host 127.0.0.1 --port 5187 --strictPort', url: 'http://127.0.0.1:5187', reuseExistingServer: false, timeout: 30000 }
})
