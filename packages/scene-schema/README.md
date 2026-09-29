# @desktop-webgis/scene-schema

Framework-independent TypeScript types, validation, normalization and migration entry points for declarative two-dimensional map scenes.

The package intentionally does not depend on OpenLayers, Vue, Pinia, Tauri or the DOM.

## Versions

| version | Style contract | Notes |
| --- | --- | --- |
| `1` | `SceneStyle` (`point` / `line` / `polygon`) + optional top-level `label` | Still readable. `parseScene` / `migrateScene` upgrade to v2. |
| `2` (current writes) | `SceneLayerStyle` (`mode: single \| categorized \| graduated`) with embedded `label` | Structurally aligned with `@desktop-webgis/ol-style` `LayerStyle`. Pure types only — no OL imports. |

Do not stuff categorized/graduated fields into a version 1 document. New writes must use `version: 2`.

```ts
import { parseScene } from '@desktop-webgis/scene-schema'

// Accepts v1 or v2 JSON; always returns canonical version 2.
const scene = parseScene(await response.json())
```

The public JSON Schema is exported as `@desktop-webgis/scene-schema/scene.schema.json` and accepts version `1` or `2`.