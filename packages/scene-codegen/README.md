# @desktop-webgis/scene-codegen

Generates readable ESM modules from validated scene documents and legacy `SceneManifest` inputs.

`generateOpenLayersModule` keeps its existing OpenLayers behavior. The Cesium API accepts a v3 `SceneDocument`:

```ts
import { generateCesiumModule, inspectCesiumCodegenCapabilities } from '@desktop-webgis/scene-codegen'

const diagnostics = inspectCesiumCodegenCapabilities(document)
if (diagnostics.some(item => item.severity === 'error')) throw new Error('Scene cannot be exported')
const source = generateCesiumModule(document, { cesiumVersion: '1.145.0' })
```

The generated ESM imports only `cesium` and exports `createScene(viewer, hooks = {})` plus `mountScene(container, options = {})` for standalone use. It configures the active 3D camera, Cesium fog density (`fog * 0.002`), bloom, sunlight, shadows and scene time; 3D Tiles (including native `Cesium3DTileStyle` JSON and quality parameters); GLB models with ENU transforms; imagery, GeoJSON color and native popup descriptions; and basic point/line/polygon graphics. Popup-enabled nodes use an independent `ScreenSpaceEventHandler`; picked tile feature properties and GLB node names are exposed through `viewer.selectedEntity`, and the caller's existing input handling is left intact. Group visibility includes every ancestor. `hooks.resolveResource(resource, credentials)` resolves portable local/absolute references and authenticated URLs; provide `hooks.credentials` at runtime. Session bridge URLs are removed before validation/output, and credentials are never embedded. The returned instance tracks only objects it created and `destroy()` removes those objects while retaining caller-owned viewer resources.

`inspectCesiumCodegenCapabilities` returns path-addressed errors and warnings. Generation throws if an error is present. Water, Tileset clip/flatten effects, parametric graphics, labels/icons, required extensions and popups on unsupported node types block export. 2D nodes are omitted with warnings; their resources are excluded from generated data. Local references, credential hooks and remote reachability produce warnings. Output is pinned to the tested Cesium `1.145.0`; requesting another version is rejected.
