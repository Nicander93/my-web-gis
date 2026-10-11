import proj4 from 'proj4'
import { CRS_PRESETS, findCrsPreset } from '@desktop-webgis/vector-io'
import View from 'ol/View'
import { get as getProjection, getPointResolution, transform, transformExtent } from 'ol/proj'
import { register } from 'ol/proj/proj4'
import type { SceneView } from '@desktop-webgis/scene-schema'

/** Register the same definitions used by import/export before installing a document view. */
export function registerMapProjections(): void {
  for (const preset of CRS_PRESETS) proj4.defs(preset.code, preset.proj4)
  register(proj4)
  for (const preset of CRS_PRESETS) {
    const projection = getProjection(preset.code)!
    if (preset.code === 'EPSG:4490') {
      projection.setExtent([-180, -90, 180, 90])
      projection.setWorldExtent([-180, -90, 180, 90])
      projection.setGlobal(true)
    }
    const meridian = preset.proj4.match(/\+lon_0=([\d.]+)/)
    if (preset.code.startsWith('EPSG:45') && meridian) {
      const lon = Number(meridian[1])
      // Application display domain, not an EPSG accuracy/area-of-use assertion.
      const world = [lon - 1.5, 0, lon + 1.5, 60]
      projection.setWorldExtent(world)
      projection.setExtent(transformExtent(world, 'EPSG:4490', preset.code, 16))
    }
  }
}

/** Preserve geographic center and local metres per pixel when switching a map view. */
export function projectedMapView(current: View, code: string, constraints: Pick<SceneView, 'extent' | 'minZoom' | 'maxZoom'> = {}) {
  const preset = findCrsPreset(code), projection = getProjection(code)
  if (!preset || !projection) throw new Error('不支持此地图投影')
  const previousCenter = current.getCenter(), resolution = current.getResolution()
  if (!previousCenter || resolution === undefined) throw new Error('地图视图尚未就绪')
  const geographic = transform(previousCenter, current.getProjection(), 'EPSG:4490')
  const meridian = preset.proj4.match(/\+lon_0=([\d.]+)/)
  if (code.startsWith('EPSG:45') && meridian && (Math.abs(geographic[0] - Number(meridian[1])) > 1.5 || geographic[1] < 0 || geographic[1] > 60)) {
    throw new Error('当前中心不在所选 3° 分带内，请选择对应分带或先定位数据')
  }
  const center = transform(previousCenter, current.getProjection(), projection)
  const metres = getPointResolution(current.getProjection(), resolution, previousCenter, 'm')
  const targetResolution = metres / getPointResolution(projection, 1, center, 'm')
  if (![...center, targetResolution].every(Number.isFinite) || targetResolution <= 0) throw new Error('此位置不能转换到所选投影')
  const extent = constraints.extent ? transformExtent(constraints.extent, current.getProjection(), projection, 16) : undefined
  if (extent && !extent.every(Number.isFinite)) throw new Error('现有视图范围不能转换到所选投影')
  const limits = { ...(extent ? { extent: extent as [number, number, number, number] } : {}),
    ...(constraints.minZoom === undefined ? {} : { minZoom: constraints.minZoom }),
    ...(constraints.maxZoom === undefined ? {} : { maxZoom: constraints.maxZoom }) }
  const view = new View({ ...limits, projection, center, resolution: targetResolution, rotation: current.getRotation() })
  return { ...limits, type: '2d' as const, projection: code, center: view.getCenter() as [number, number], zoom: view.getZoom()!, rotation: current.getRotation() }
}
