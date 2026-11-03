import { requireMapContent } from '@desktop-webgis/project'
import { getEffectiveLocked } from '@desktop-webgis/project'
import type { ProjectSnapshot, VectorDataset } from '@desktop-webgis/project'
import { createCoordinateTransform } from '@desktop-webgis/vector-io'

/** Revise only the source declaration; the normalized WGS84 cache is unchanged. */
export function assignSourceCrs(snapshot: ProjectSnapshot, base: VectorDataset, sourceCrs: string): ProjectSnapshot {
  const current = requireMapContent(snapshot.project).datasets.find(dataset => dataset.id === base.id)
  if (!current || JSON.stringify(current) !== JSON.stringify(base)) throw new Error('数据源已被修改，请重新载入属性。')
  const code = sourceCrs.trim()
  const validation = createCoordinateTransform({ code })
  if (!validation.success) throw new Error(validation.error ?? '源 CRS 无效。')
  const users = requireMapContent(snapshot.project).layers.filter(layer => layer.datasetId === base.id)
  if (users.some(layer => getEffectiveLocked(snapshot.project, layer.id))) throw new Error('共享该数据源的图层或所属文件夹已锁定。')
  const after = structuredClone(snapshot)
  requireMapContent(after.project).datasets = requireMapContent(after.project).datasets.map(dataset => dataset.id === base.id ? { ...base, sourceCrs: code } : dataset)
  return after
}
