import { fileURLToPath } from 'node:url'
import { defineConfig, normalizePath } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  plugins: [viteStaticCopy({ targets: [
    ...['Workers', 'Assets', 'ThirdParty', 'Widgets'].map(name => ({ src: normalizePath(fileURLToPath(new URL(`./node_modules/cesium/Build/Cesium/${name}`, import.meta.url))), dest: 'cesium' })),
    { src: normalizePath(fileURLToPath(new URL('../city-sample', import.meta.url))), dest: '.' }
  ] })]
})
