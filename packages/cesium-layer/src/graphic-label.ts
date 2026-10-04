import type { GraphicNode } from '@desktop-webgis/cesium-scene-schema'

/** Field labels accept scalar attributes; missing/structured values use the fixed fallback. */
export function resolveGraphicLabel(node: GraphicNode): string | undefined {
  const properties: Record<string, unknown> = { name: node.name, ...node.properties }
  const value = node.style.labelField ? properties[node.style.labelField] : undefined
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : node.style.label
}
