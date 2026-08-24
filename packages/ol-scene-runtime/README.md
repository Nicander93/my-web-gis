# @desktop-webgis/ol-scene-runtime

An editor-independent OpenLayers runtime for `SceneManifest` JSON documents.

```ts
import { createSceneRuntime } from '@desktop-webgis/ol-scene-runtime'

const runtime = await createSceneRuntime({
  target: 'map',
  scene: '/scene.json'
})
```

The package exposes the native `ol/Map` only as an advanced escape hatch. Normal scene operations use stable layer IDs and runtime events.
