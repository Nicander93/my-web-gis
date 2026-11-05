export type PropertyWindowRequest = { kind: 'layer' | 'folder'; id: string }
export const propertyWindowEvent = 'desktop-webgis:open-properties'
export function openPropertyWindow(request: PropertyWindowRequest): void {
  window.dispatchEvent(new CustomEvent<PropertyWindowRequest>(propertyWindowEvent, { detail: request }))
}
