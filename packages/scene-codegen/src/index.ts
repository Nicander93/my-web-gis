import {
  parseScene,
  type SceneLayerStyle,
  type SceneManifest
} from '@desktop-webgis/scene-schema'

export interface OpenLayersCodegenOptions {
  targetExpression?: string
  credentialGlobal?: string
  includeCssImport?: boolean
}

const SUPPORTED_STYLE_MODES = new Set(['single', 'categorized', 'graduated'])

/**
 * Fail loudly when a scene uses style capabilities this codegen/runtime path cannot preserve.
 * Currently all LayerStyle modes are supported via @desktop-webgis/ol-style — this guard
 * exists so future modes cannot silently fall back to single-symbol output.
 */
export function assertSceneCodegenCapabilities(scene: SceneManifest): void {
  for (const layer of scene.layers) {
    if (layer.type !== 'vector') continue
    const style: SceneLayerStyle = layer.style
    if (!SUPPORTED_STYLE_MODES.has(style.mode)) {
      throw new Error(
        `Layer "${layer.id}" 使用了代码生成尚未支持的样式 mode "${String((style as { mode?: unknown }).mode)}"；拒绝静默降级`
      )
    }
  }
}

/** Generates an ESM module backed by the public OpenLayers Scene Runtime. */
export function generateOpenLayersModule(
  input: unknown,
  options: OpenLayersCodegenOptions = {}
): string {
  const scene = parseScene(input)
  assertSceneCodegenCapabilities(scene)
  const targetExpression = options.targetExpression ?? "document.getElementById('map')"
  if (!targetExpression.trim()) throw new Error('targetExpression 不得为空。')
  const credentialGlobal = options.credentialGlobal ?? '__MAP_CREDENTIALS__'
  const credentialIds = Object.keys(scene.credentials ?? {}).sort()
  const lines = [
    ...(options.includeCssImport === false ? [] : ["import 'ol/ol.css';"]),
    "import { createSceneRuntime } from '@desktop-webgis/ol-scene-runtime';",
    '',
    `export const scene = ${JSON.stringify(scene, null, 2)};`,
    '',
    `const providedCredentials = globalThis[${JSON.stringify(credentialGlobal)}] ?? {};`,
    `const credentials = Object.fromEntries(${JSON.stringify(credentialIds)}.map((id) => [id, providedCredentials[id] ?? '']));`,
    '',
    'export const runtime = await createSceneRuntime({',
    `  target: ${targetExpression},`,
    '  scene,',
    '  credentials',
    '});',
    ''
  ]
  return lines.join('\n')
}

export function generateOpenLayersHtml(modulePath = './map.js'): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenLayers Scene</title>
    <style>html, body, #map { width: 100%; height: 100%; margin: 0; }</style>
  </head>
  <body>
    <div id="map"></div>
    <script type="module" src="${escapeHtmlAttribute(modulePath)}"></script>
  </body>
</html>
`
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}
