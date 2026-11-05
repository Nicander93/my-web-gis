import { describe, expect, it } from 'vitest'
import { Cartesian3, Matrix4, Transforms } from 'cesium'
import { createTransform } from '@desktop-webgis/cesium-scene-schema'
import { composeTransform } from './transform'

describe('ENU asset transforms', () => {
  it('preserves the original tileset matrix with an identity delta', () => {
    const pivot = Cartesian3.fromDegrees(116,40,50)
    const base = Matrix4.fromTranslation(new Cartesian3(100,200,300))
    expect(Matrix4.equalsEpsilon(composeTransform(base,pivot,createTransform()),base,1e-8)).toBe(true)
  })
  it('translates in local metres rather than ECEF coordinate axes', () => {
    const pivot = Cartesian3.fromDegrees(116,40,50), frame = Transforms.eastNorthUpToFixedFrame(pivot)
    const transform = createTransform(); transform.translation = [20,10,5]
    const result = composeTransform(frame,pivot,transform)
    const actual = Matrix4.getTranslation(result,new Cartesian3())
    const expected = Matrix4.multiplyByPoint(frame,new Cartesian3(20,10,5),new Cartesian3())
    expect(Cartesian3.distance(actual,expected)).toBeLessThan(1e-7)
  })
  it('rotates/scales around the pivot without moving the pivot', () => {
    const pivot = Cartesian3.fromDegrees(116,40,50), frame = Transforms.eastNorthUpToFixedFrame(pivot)
    const transform = createTransform(); transform.rotation = [90,20,0]; transform.scale = 2
    const result = composeTransform(frame,pivot,transform)
    expect(Cartesian3.distance(Matrix4.getTranslation(result,new Cartesian3()),pivot)).toBeLessThan(1e-7)
    expect(Matrix4.getScale(result,new Cartesian3()).x).toBeCloseTo(2)
  })
  it('refuses singular/non-finite transforms', () => {
    expect(() => composeTransform(Matrix4.IDENTITY,Cartesian3.fromDegrees(1,1),{ ...createTransform(),scale:0 })).toThrow()
  })
})
