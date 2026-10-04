import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import desktop from './vite.config'

export default defineConfig({
  resolve: desktop.resolve,
  server: { ...desktop.server, host: '127.0.0.1', port: 5187, strictPort: true },
  build: {
    outDir: '../../.artifacts/processing-benchmark',
    emptyOutDir: false,
    rollupOptions: { input: fileURLToPath(new URL('./benchmarks/processing.html', import.meta.url)) }
  }
})
