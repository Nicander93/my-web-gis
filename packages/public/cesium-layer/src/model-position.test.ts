import { expect, it } from 'vitest'
import { Cartesian3, Matrix4 } from 'cesium'
import type { Model } from 'cesium'
import { ModelLayer } from './index'

it('updates the native anchor without replacing the model and can restore it', () => {
  const layer = new ModelLayer({ id: 'model', url: './tower.glb', position: [116, 39, 0] })
  const native = { modelMatrix: Matrix4.clone(Matrix4.IDENTITY) } as Model
  layer.model = native
  layer.setPosition([116, 39, 80])
  const position = Matrix4.getTranslation(native.modelMatrix, new Cartesian3())
  expect(Cartesian3.distance(position, Cartesian3.fromDegrees(116, 39, 80))).toBeLessThan(.001)
  layer.setTransform({ translation: [10, 0, 0], rotation: [0, 0, 0], scale: 1 })
  layer.setPosition([116, 39, 0])
  expect(layer.model).toBe(native)
  expect(Cartesian3.distance(Matrix4.getTranslation(native.modelMatrix, new Cartesian3()), Cartesian3.fromDegrees(116, 39, 0))).toBeCloseTo(10)
  const before = Matrix4.clone(native.modelMatrix)
  expect(() => layer.setPosition([200, 39, 0])).toThrow('无效')
  expect(native.modelMatrix).toEqual(before)
})
