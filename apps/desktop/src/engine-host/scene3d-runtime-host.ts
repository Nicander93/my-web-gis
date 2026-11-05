import type { CesiumSceneCamera } from '@desktop-webgis/cesium-scene-schema'
import type { SceneRuntimeDiagnostics } from '@desktop-webgis/cesium-scene-runtime'

/**
 * 三维场景运行时桥接宿主（Cesium）：
 * 通过注册读取回调向外暴露实时相机姿态与渲染诊断信息，避免把重型 Cesium 实例放入 Zustand Store。
 */
let cameraReader: (() => CesiumSceneCamera | null) | null = null
let diagnosticsReader: ((id?: string) => SceneRuntimeDiagnostics | null) | null = null

/** 对外暴露已挂载的视口，但不把 Cesium 实例放进项目状态。 */
export function registerSceneCameraReader(reader: () => CesiumSceneCamera, isCurrent: () => boolean = () => true): () => void {
  const owned = () => isCurrent() ? reader() : null
  cameraReader = owned
  return () => { if (cameraReader === owned) cameraReader = null }
}

/** 返回一份脱离的相机快照，供完整的场景导出使用。 */
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
