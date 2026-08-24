# @desktop-webgis/scene-codegen

Generates a readable ESM entry module from a validated `SceneManifest`. Generated code uses `@desktop-webgis/ol-scene-runtime`, imports OpenLayers CSS, and resolves provider secrets from a named `globalThis` credential dictionary instead of embedding them.
