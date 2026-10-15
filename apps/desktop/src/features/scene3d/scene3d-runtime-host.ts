import type { CesiumSceneCamera } from '@desktop-webgis/cesium-scene-schema'
import type { SceneRuntimeDiagnostics } from '@desktop-webgis/cesium-scene-runtime'

let cameraReader: (() => CesiumSceneCamera | null) | null = null
let diagnosticsReader: ((id?: string) => SceneRuntimeDiagnostics | null) | null = null

/** Expose the mounted viewport without putting the Cesium instance in project state. */
export function registerSceneCameraReader(reader: () => CesiumSceneCamera, isCurrent: () => boolean = () => true): () => void {
  const owned = () => isCurrent() ? reader() : null
  cameraReader = owned
  return () => { if (cameraReader === owned) cameraReader = null }
}

/** Return a detached camera snapshot for full scene exports. */
export function getLiveSceneCamera(): CesiumSceneCamera | null {
  const camera = cameraReader?.()
  return camera ? structuredClone(camera) : null
}

export function registerSceneDiagnosticsReader(reader: (id?: string) => SceneRuntimeDiagnostics, isCurrent: () => boolean = () => true): () => void {
  const owned = (id?: string) => isCurrent() ? reader(id) : null
  diagnosticsReader = owned
  return () => { if (diagnosticsReader === owned) diagnosticsReader = null }
}

export function getLiveSceneDiagnostics(id?: string): SceneRuntimeDiagnostics | null {
  const diagnostics = diagnosticsReader?.(id)
  return diagnostics ? structuredClone(diagnostics) : null
}
