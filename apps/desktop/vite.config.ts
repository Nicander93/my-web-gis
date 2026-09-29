import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@desktop-webgis/gis-core': fileURLToPath(new URL('../../packages/gis-core/src/index.ts', import.meta.url)),
      '@desktop-webgis/ol-runtime': fileURLToPath(new URL('../../packages/ol-runtime/src/index.ts', import.meta.url)),
      '@desktop-webgis/ogc-io': fileURLToPath(new URL('../../packages/ogc-io/src/index.ts', import.meta.url))
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
