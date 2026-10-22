import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testMatch: ['**/cartography-spike.e2e.ts'],
  projects: [{ name: 'cartography-spike', use: { viewport: { width: 1440, height: 900 } } }],
  reporter: [['list'], ['json', { outputFile: './test-results/cartography-spike/playwright-results.json' }]],
  outputDir: './test-results/cartography-spike/playwright',
  use: { ...base.use, screenshot: 'off', trace: 'off' },
})
