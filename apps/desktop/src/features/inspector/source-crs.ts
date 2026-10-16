import { findGroupForLayer, getLayerGroupState } from '@desktop-webgis/gis-core'
import type { ProjectSnapshot, VectorDataset } from '@desktop-webgis/gis-core'
import { createCoordinateTransform } from '@desktop-webgis/vector-io'

/** Revise only the source declaration; the normalized WGS84 cache is unchanged. */
export function assignSourceCrs(snapshot: ProjectSnapshot, base: VectorDataset, sourceCrs: string): ProjectSnapshot {
  const current = snapshot.project.datasets.find(dataset => dataset.id === base.id)
  if (!current || JSON.stringify(current) !== JSON.stringify(base)) throw new Error('数据源已被修改，请重新载入属性。')
  const code = sourceCrs.trim()
  const validation = createCoordinateTransform({ code })
  if (!validation.success) throw new Error(validation.error ?? '源 CRS 无效。')
  const users = snapshot.project.layers.filter(layer => layer.datasetId === base.id)
  if (users.some(layer => getLayerGroupState(snapshot.project, findGroupForLayer(snapshot.project, layer.id)?.id).locked)) throw new Error('共享该数据源的图层所属文件夹已锁定。')
  const after = structuredClone(snapshot)
  after.project.datasets = after.project.datasets.map(dataset => dataset.id === base.id ? { ...base, sourceCrs: code } : dataset)
  return after
}
