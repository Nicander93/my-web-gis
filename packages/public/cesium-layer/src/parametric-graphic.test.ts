import { expect, it } from 'vitest'
import { Cartographic, Math as CesiumMath } from 'cesium'
import { parametricGraphic } from './parametric-graphic'

it('normalizes rectangle corners and keeps a single ellipsoid height', () => {
  const shape = parametricGraphic({ type: 'rectangle', positions: [[117,40,120],[116,39,120]], heightMode: 'absolute' })!
  expect(CesiumMath.toDegrees(shape.rectangle!.west)).toBeCloseTo(116,8)
  expect(CesiumMath.toDegrees(shape.rectangle!.north)).toBeCloseTo(40,8)
  expect(shape.corners).toHaveLength(4)
  expect(Cartographic.fromCartesian(shape.position).height).toBeCloseTo(120,5)
})

it('derives ellipse radii in metres from WGS84 distances and aligns the longer axis', () => {
  const shape = parametricGraphic({ type: 'ellipse', positions: [[0,0,120],[.02,.01,120]], heightMode: 'absolute' })!
  expect(shape.ellipse!.semiMajorAxis).toBeCloseTo(1113.1949,0)
  expect(shape.ellipse!.semiMinorAxis).toBeCloseTo(552.8714,0)
  expect(shape.ellipse!.rotation).toBe(CesiumMath.PI_OVER_TWO)
  const center = Cartographic.fromCartesian(shape.position)
  expect(CesiumMath.toDegrees(center.longitude)).toBeCloseTo(.01,8)
  expect(CesiumMath.toDegrees(center.latitude)).toBeCloseTo(.005,8)
  const northern = parametricGraphic({ type: 'ellipse', positions: [[0,70,0],[.02,70.01,0]], heightMode: 'ground' })!
  expect(northern.ellipse!.rotation).toBe(0)
})

it('does not allocate a shape for degenerate, dateline or unsupported ellipse ranges', () => {
  expect(parametricGraphic({ type: 'rectangle', positions: [[0,0,0],[0,1,0]], heightMode: 'ground' })).toBeUndefined()
  expect(parametricGraphic({ type: 'rectangle', positions: [[179,0,0],[-179,1,0]], heightMode: 'ground' })).toBeUndefined()
  expect(parametricGraphic({ type: 'ellipse', positions: [[0,86,0],[1,87,0]], heightMode: 'ground' })).toBeUndefined()
  expect(parametricGraphic({ type: 'ellipse', positions: [[0,0,0],[11,1,0]], heightMode: 'ground' })).toBeUndefined()
})
