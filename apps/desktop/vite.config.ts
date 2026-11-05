import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  optimizeDeps: { exclude: ['geolibre-wasm'] },
  worker: { format: 'es' },
  plugins: [react(), tailwindcss(), viteStaticCopy({ targets: [
    ...['Assets', 'Workers', 'ThirdParty', 'Widgets'].map(name => ({ src: `node_modules/cesium/Build/Cesium/${name}`, dest: 'cesium' })),
    ...['brand', 'third-party'].map(name => ({ src: `public/${name}`, dest: '.' })),
    { src: '../../examples/city-3d/city-sample', dest: '.' }
  ] })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@desktop-webgis/project/geojson': fileURLToPath(new URL('../../packages/internal/project/src/data/geojson.ts', import.meta.url)),
      '@desktop-webgis/project/dataset-file': fileURLToPath(new URL('../../packages/internal/project/src/data/dataset-file.ts', import.meta.url)),
      '@desktop-webgis/project/id': fileURLToPath(new URL('../../packages/internal/project/src/id.ts', import.meta.url)),
      '@desktop-webgis/project': fileURLToPath(new URL('../../packages/internal/project/src/index.ts', import.meta.url)),
      '@desktop-webgis/ol-runtime': fileURLToPath(new URL('../../packages/internal/ol-runtime/src/index.ts', import.meta.url)),
      '@desktop-webgis/ogc-io/sld-export': fileURLToPath(new URL('../../packages/public/ogc-io/src/sld-export.ts', import.meta.url)),
      '@desktop-webgis/ogc-io/sld-package': fileURLToPath(new URL('../../packages/public/ogc-io/src/sld-package.ts', import.meta.url)),
      '@desktop-webgis/ogc-io/mbstyle-export': fileURLToPath(new URL('../../packages/public/ogc-io/src/mbstyle-export.ts', import.meta.url)),
      '@desktop-webgis/ogc-io/geoserver-client': fileURLToPath(new URL('../../packages/public/ogc-io/src/geoserver-client.ts', import.meta.url)),
      '@desktop-webgis/ogc-io': fileURLToPath(new URL('../../packages/public/ogc-io/src/index.ts', import.meta.url))
    }
  },
  build: {
    copyPublicDir: false,
    outDir: 'dist',
    rollupOptions: {
      input: fileURLToPath(new URL('./index.html', import.meta.url))
    }
  },
  test: {
    setupFiles: [fileURLToPath(new URL('./src/stores/session-view-sync.ts', import.meta.url))]
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
