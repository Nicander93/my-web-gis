import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  base: './',
  plugins: [viteStaticCopy({ targets: [
    ...['Assets', 'Workers', 'ThirdParty', 'Widgets'].map(name => ({ src: `node_modules/cesium/Build/Cesium/${name}`, dest: 'cesium' })),
    { src: '../../examples/city-3d/city-sample', dest: '.' }
  ] })],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true
  }
})
