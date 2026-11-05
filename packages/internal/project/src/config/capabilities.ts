import type { Dataset, DatasetKind } from './types'

/** 能力标记由数据集类型推导（不能把服务图层假装成可编辑的矢量图层）。 */
export interface LayerCapabilityFlags {
  /** 查询和展示要素属性，支持矢量快照和 WFS 快照。 */
  queryAttributes: boolean
  /** 几何的新建、修改和删除工具。 */
  editGeometry: boolean
  /** 矢量样式和标注面板。 */
  style: boolean
  /** 导出为 GeoJSON 或属性 CSV，只支持矢量要素。 */
  exportVector: boolean
  /** 把选择或过滤的结果复制到一个新的本地矢量图层。 */
  copyToLocal: boolean
  /** 本地要素上的字段过滤条件（F）。 */
  filter: boolean
}

const NONE: LayerCapabilityFlags = {
  queryAttributes: false,
  editGeometry: false,
  style: false,
  exportVector: false,
  copyToLocal: false,
  filter: false
}

const VECTOR_SNAPSHOT: LayerCapabilityFlags = {
  queryAttributes: true,
  editGeometry: true,
  style: true,
  exportVector: true,
  copyToLocal: true,
  filter: true
}

/** WMS/WMTS: imagery/tiles only — no local features to edit or export as vectors. */
const SERVICE_TILE: LayerCapabilityFlags = {
  queryAttributes: false,
  editGeometry: false,
  style: false,
  exportVector: false,
  copyToLocal: false,
  filter: false
}

/**
 * WFS 的连接模型（P18 加载快照）。持久化的 WFS 数据集不能编辑几何，也不支持 WFS-T。
 */
const WFS_SERVICE: LayerCapabilityFlags = {
  queryAttributes: true,
  editGeometry: false,
  style: true,
  exportVector: true,
  copyToLocal: true,
  filter: true
}

export function capabilitiesForKind(kind: DatasetKind | undefined): LayerCapabilityFlags {
  switch (kind) {
    case 'vector':
      return { ...VECTOR_SNAPSHOT }
    case 'wms':
    case 'wmts':
      return { ...SERVICE_TILE }
    case 'wfs':
      return { ...WFS_SERVICE }
    default:
      return { ...NONE }
  }
}

export function capabilitiesForDataset(dataset: Dataset | undefined): LayerCapabilityFlags {
  return capabilitiesForKind(dataset?.kind)
}

export function isServiceDatasetKind(kind: DatasetKind | undefined): boolean {
  return kind === 'wms' || kind === 'wmts' || kind === 'wfs'
}

export function isTileServiceKind(kind: DatasetKind | undefined): boolean {
  return kind === 'wms' || kind === 'wmts'
}
