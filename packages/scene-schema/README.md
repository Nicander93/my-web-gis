# @desktop-webgis/scene-schema

Framework-independent TypeScript types, validation, normalization and migration entry points for declarative two-dimensional map scenes.

The package intentionally does not depend on OpenLayers, Vue, Pinia, Tauri or the DOM.

```ts
import { parseScene } from '@desktop-webgis/scene-schema'

const scene = parseScene(await response.json())
```

The public JSON Schema is exported as `@desktop-webgis/scene-schema/scene.schema.json`.
