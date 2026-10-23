export type SceneAction = 'add-resource' | 'import-scene' | 'export-scene' | 'export-cesium' | 'sample' | 'draw-water' | 'undo' | 'redo' | 'delete' | 'scene-settings' | 'reset-layout' | 'initial-view'

/** Menu commands are handled by the mounted 3D scene workspace. */
export function requestSceneAction(action: SceneAction): void {
  window.dispatchEvent(new CustomEvent<SceneAction>('desktop-webgis:scene3d-action', { detail: action }))
}
