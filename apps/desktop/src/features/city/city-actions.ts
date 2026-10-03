export type CityAction = 'add-resource' | 'import-scene' | 'export-scene' | 'sample' | 'draw-water' | 'undo' | 'redo' | 'delete' | 'scene-settings' | 'reset-layout' | 'initial-view'

/** Menu commands are handled by the mounted city workspace. */
export function requestCityAction(action: CityAction): void {
  window.dispatchEvent(new CustomEvent<CityAction>('desktop-webgis:city-action', { detail: action }))
}
