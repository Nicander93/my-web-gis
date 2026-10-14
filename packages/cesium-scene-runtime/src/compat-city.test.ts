import { expect, it } from 'vitest'
import { CesiumSceneRuntime, CitySceneRuntime, createCesiumSceneRuntime, createCityRuntime } from './index'

it('keeps existing runtime imports on the same class and factory implementation', () => {
  expect(CitySceneRuntime).toBe(CesiumSceneRuntime)
  expect(createCityRuntime).toBe(createCesiumSceneRuntime)
})
