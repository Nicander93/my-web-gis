import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig(({ mode }) => ({
  optimizeDeps: { exclude: ['geolibre-wasm'] },
  worker: { format: 'es' },
  plugins: [react(), tailwindcss(), viteStaticCopy({ targets: [
    ...['Assets', 'Workers', 'ThirdParty', 'Widgets'].map(name => ({ src: `node_modules/cesium/Build/Cesium/${name}`, dest: 'cesium' })),
    ...['brand', 'third-party', ...(mode === 'cartography' ? ['cartography-assets'] : [])].map(name => ({ src: `public/${name}`, dest: '.' })),
    { src: '../../examples/city-3d/city-sample', dest: '.' }
  ] })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@desktop-webgis/gis-core': fileURLToPath(new URL('../../packages/gis-core/src/index.ts', import.meta.url)),
      '@desktop-webgis/ol-runtime': fileURLToPath(new URL('../../packages/ol-runtime/src/index.ts', import.meta.url)),
      '@desktop-webgis/ogc-io/sld-export': fileURLToPath(new URL('../../packages/ogc-io/src/sld-export.ts', import.meta.url)),
      '@desktop-webgis/ogc-io/sld-package': fileURLToPath(new URL('../../packages/ogc-io/src/sld-package.ts', import.meta.url)),
      '@desktop-webgis/ogc-io/mbstyle-export': fileURLToPath(new URL('../../packages/ogc-io/src/mbstyle-export.ts', import.meta.url)),
      '@desktop-webgis/ogc-io/geoserver-client': fileURLToPath(new URL('../../packages/ogc-io/src/geoserver-client.ts', import.meta.url)),
      '@desktop-webgis/ogc-io': fileURLToPath(new URL('../../packages/ogc-io/src/index.ts', import.meta.url))
    }
  },
  build: {
    copyPublicDir: false,
    outDir: mode === 'cartography' ? 'test-results/cartography-spike/build' : 'dist',
    rollupOptions: {
      input: mode === 'cartography'
        ? fileURLToPath(new URL('./cartography-spike.html', import.meta.url))
        : fileURLToPath(new URL('./index.html', import.meta.url))
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
}))
