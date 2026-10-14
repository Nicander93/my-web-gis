import type { CityCamera } from '@desktop-webgis/cesium-scene-schema'

let cameraReader: (() => CityCamera | null) | null = null

/** Expose the mounted viewport without putting the Cesium instance in project state. */
export function registerCityCameraReader(reader: () => CityCamera, isCurrent: () => boolean = () => true): () => void {
  const owned = () => isCurrent() ? reader() : null
  cameraReader = owned
  return () => { if (cameraReader === owned) cameraReader = null }
}

/** Return a detached camera snapshot for full scene exports. */
export function getLiveCityCamera(): CityCamera | null {
  const camera = cameraReader?.()
  return camera ? structuredClone(camera) : null
}
