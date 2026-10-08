import type { CityCamera } from '@desktop-webgis/cesium-scene-schema'

let cameraReader: (() => CityCamera) | null = null

/** Expose the mounted viewport without putting the Cesium instance in project state. */
export function registerCityCameraReader(reader: () => CityCamera): () => void {
  cameraReader = reader
  return () => { if (cameraReader === reader) cameraReader = null }
}

/** Return a detached camera snapshot for full scene exports. */
export function getLiveCityCamera(): CityCamera | null {
  return cameraReader ? structuredClone(cameraReader()) : null
}
