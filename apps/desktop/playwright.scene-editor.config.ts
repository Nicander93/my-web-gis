import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/** A fresh server prevents package rebuilds and unrelated runs from invalidating scene sessions. */
export default defineConfig({
  ...base,
  testMatch: ['**/scene3d-editor-v1.e2e.ts', '**/scene3d-property-window.e2e.ts', '**/cesium-native-export.e2e.ts', '**/hover-stability.e2e.ts', '**/cartography-editor.e2e.ts', '**/inspector-ux-followup.e2e.ts'],
  projects: base.projects?.filter(project => project.name === 'desktop' || project.name === 'compact'),
  workers: 1,
  outputDir: '../../.artifacts/scene-editor-v1/browser',
  use: { baseURL: 'http://127.0.0.1:5189' },
  webServer: { command: 'pnpm dev --port 5189 --strictPort', url: 'http://127.0.0.1:5189', reuseExistingServer: false, timeout: 30_000 }
})
