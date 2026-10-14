/** Compatibility exports for previously published city-named APIs. */
/** @deprecated Use CesiumSceneRuntimeOptions. */
export type { CesiumSceneRuntimeOptions as CityRuntimeOptions } from './index.js'
/** @deprecated Use CesiumSceneRuntime. */
export { CesiumSceneRuntime as CitySceneRuntime } from './index.js'
/** @deprecated Use createCesiumSceneRuntime. */
export { createCesiumSceneRuntime as createCityRuntime } from './index.js'
/** @deprecated Import CesiumScene and CesiumSceneNode instead. */
export type { CesiumScene as CityScene, CesiumSceneNode as CityNode } from '@desktop-webgis/cesium-scene-schema'
