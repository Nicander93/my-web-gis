import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testMatch: ['**/cartography-project.e2e.ts', '**/cartography-editor.e2e.ts', '**/cartography-professional.e2e.ts', '**/thematic-style.e2e.ts'],
  projects: [{ name: 'cartography-project', use: { viewport: { width: 1440, height: 900 } } }],
  outputDir: './test-results/cartography-project-acceptance',
  reporter: [['list'], ['json', { outputFile: './test-results/cartography-project-acceptance/results.json' }]],
  use: { ...base.use, baseURL: 'http://127.0.0.1:5182', screenshot: 'off', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm dev --port 5182 --strictPort', url: 'http://127.0.0.1:5182', reuseExistingServer: false, timeout: 30_000 },
})
