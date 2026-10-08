import { expect, it } from 'vitest'
import { createCityScene } from '@desktop-webgis/cesium-scene-schema'
import { getLiveCityCamera, registerCityCameraReader } from './city-runtime-host'

it('captures detached live cameras and keeps a newer viewport registered during old cleanup', () => {
  const first = createCityScene().camera
  const removeFirst = registerCityCameraReader(() => first)
  const captured = getLiveCityCamera()!
  expect(captured).toEqual(first)
  expect(captured).not.toBe(first)
  const second = structuredClone(first)
  second.heading = first.heading + 20
  const removeSecond = registerCityCameraReader(() => second)
  removeFirst()
  expect(getLiveCityCamera()).toEqual(second)
  removeSecond()
  expect(getLiveCityCamera()).toBeNull()
})
