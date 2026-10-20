import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testMatch: ['**/core-ui-visual.e2e.ts', '**/attribute-tabs.e2e.ts', '**/scene3d-property-window.e2e.ts', '**/property-preview.e2e.ts', '**/property-window-2d-folder.e2e.ts', '**/property-popup-draft.e2e.ts', '**/workbench.e2e.ts', '**/map-navigation-drop.e2e.ts'],
  reporter: [['list'], ['json', { outputFile: '../../.artifacts/ui-visual-results.json' }]],
  outputDir: '../../.artifacts/ui-visual',
  use: { ...base.use, screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } }
})
