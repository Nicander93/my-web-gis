import { Cartesian3, HeadingPitchRoll, Math as CesiumMath, Matrix4, Quaternion, Transforms } from 'cesium'
import { validateTransform } from '@desktop-webgis/cesium-scene-schema'
import type { Transform } from '@desktop-webgis/cesium-scene-schema'

/** Apply an ENU delta around a world-space pivot while retaining asset placement. */
export function composeTransform(base: Matrix4, pivot: Cartesian3, transform: Transform): Matrix4 {
  if (!validateTransform(transform)) throw new Error('变换参数无效')
  const frame = Transforms.eastNorthUpToFixedFrame(pivot)
  const rotation = Quaternion.fromHeadingPitchRoll(new HeadingPitchRoll(...transform.rotation.map(CesiumMath.toRadians)))
  const delta = Matrix4.fromTranslationQuaternionRotationScale(Cartesian3.fromArray(transform.translation), rotation, new Cartesian3(transform.scale, transform.scale, transform.scale))
  const result = Matrix4.multiply(frame, delta, new Matrix4())
  Matrix4.multiply(result, Matrix4.inverseTransformation(frame, new Matrix4()), result)
  return Matrix4.multiply(result, base, result)
}
