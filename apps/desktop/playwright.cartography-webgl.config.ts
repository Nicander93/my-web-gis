import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', testMatch: '**/cartography-webgl.e2e.ts', workers: 1, timeout: 120000,
  reporter: [['list'], ['json', { outputFile: 'test-results/cartography-webgl/results.json' }]],
  outputDir: 'test-results/cartography-webgl/artifacts',
  use: { baseURL: 'http://127.0.0.1:5185', viewport: { width: 512, height: 512 }, deviceScaleFactor: 1, screenshot: 'off', trace: 'retain-on-failure' },
  webServer: [
    { command: 'pnpm dev --port 5185 --strictPort', url: 'http://127.0.0.1:5185/cartography-webgl.html', reuseExistingServer: false },
    { command: 'pnpm --filter @desktop-webgis/viewer exec vite --config vite.config.mjs --configLoader runner --host 127.0.0.1 --port 5186 --strictPort', url: 'http://127.0.0.1:5186', reuseExistingServer: false }
  ]
})
