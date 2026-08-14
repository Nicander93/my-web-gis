import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@desktop-webgis/gis-core': fileURLToPath(new URL('../../packages/gis-core/src/index.ts', import.meta.url)),
      '@desktop-webgis/ol-runtime': fileURLToPath(new URL('../../packages/ol-runtime/src/index.ts', import.meta.url))
    }
  },
  clearScreen: false,
  server: {
    strictPort: false,
    port: 5173,
    fs: {
      allow: [fileURLToPath(new URL('../..', import.meta.url))]
    }
  }
})
