import type { Dataset, DatasetKind } from './types'

/** Capability flags derived from Dataset kind (never pretend service layers are editable vectors). */
export interface LayerCapabilityFlags {
  /** Query / show feature attributes (vector snapshot or WFS snapshot). */
  queryAttributes: boolean
  /** Geometry create/modify/delete tools. */
  editGeometry: boolean
  /** Vector style / label panels. */
  style: boolean
  /** Export as GeoJSON / attribute CSV (vector features only). */
  exportVector: boolean
  /** Copy selection/filter result to a new local vector layer. */
  copyToLocal: boolean
  /** Field filter (F) on local features. */
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
 * WFS connection model (P18 loads snapshot). Persisted WFS datasets are not geom-editable / not WFS-T.
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
