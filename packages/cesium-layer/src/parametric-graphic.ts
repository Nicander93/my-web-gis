import { Cartesian3, Cartographic, EllipsoidGeodesic, Math as CesiumMath, Rectangle } from 'cesium'
import type { GraphicGeometry } from '@desktop-webgis/cesium-scene-schema'

/** Opposite geographic corners define a north-aligned shape; height uses the first anchor. */
export function parametricGraphic(geometry: GraphicGeometry) {
  if (geometry.type !== 'rectangle' && geometry.type !== 'ellipse' || geometry.positions.length !== 2) return
  const [a,b] = geometry.positions, west = Math.min(a[0],b[0]), east = Math.max(a[0],b[0]), south = Math.min(a[1],b[1]), north = Math.max(a[1],b[1])
  if (east - west < 1e-8 || north - south < 1e-8 || east - west > 180) return
  if (geometry.type === 'ellipse' && (east - west > 10 || north - south > 10 || Math.max(Math.abs(south),Math.abs(north)) > 85)) return
  const longitude = (west + east) / 2, latitude = (south + north) / 2
  const position = Cartesian3.fromDegrees(longitude, latitude, a[2])
  const rectangle = Rectangle.fromDegrees(west, south, east, north)
  const corners = [[west,south,a[2]],[east,south,a[2]],[east,north,a[2]],[west,north,a[2]]].map(point => Cartesian3.fromDegrees(point[0],point[1],point[2]))
  if (geometry.type === 'rectangle') return { position, rectangle, corners }
  const center = Cartographic.fromDegrees(longitude, latitude)
  const horizontal = new EllipsoidGeodesic(center, Cartographic.fromDegrees(east,latitude)).surfaceDistance
  const vertical = new EllipsoidGeodesic(center, Cartographic.fromDegrees(longitude,north)).surfaceDistance
  return { position, ellipse: { semiMajorAxis: Math.max(horizontal,vertical), semiMinorAxis: Math.min(horizontal,vertical), rotation: horizontal > vertical ? CesiumMath.PI_OVER_TWO : 0 } }
}
