import type { GraphicNode } from '@desktop-webgis/cesium-scene-schema'

/** 字段标签只接受标量属性；缺失或结构化的值使用固定的回退文本。 */
export function resolveGraphicLabel(node: GraphicNode): string | undefined {
  const properties: Record<string, unknown> = { name: node.name, ...node.properties }
  const value = node.style.labelField ? properties[node.style.labelField] : undefined
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : node.style.label
}
