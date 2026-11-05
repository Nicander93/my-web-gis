export type SceneAction = 'add-resource' | 'import-scene' | 'export-scene' | 'export-cesium' | 'sample' | 'draw-water' | 'undo' | 'redo' | 'delete' | 'scene-settings' | 'reset-layout' | 'initial-view'

/** 菜单命令由已挂载的三维场景工作区处理。 */
export function requestSceneAction(action: SceneAction): void {
  window.dispatchEvent(new CustomEvent<SceneAction>('desktop-webgis:scene3d-action', { detail: action }))
}
