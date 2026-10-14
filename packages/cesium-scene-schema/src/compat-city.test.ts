import { expect, it } from 'vitest'
import { createCesiumScene, createCityScene, parseCesiumScene, parseCityScene, getCesiumSceneNodeState, getCityNodeState } from './index'

it('keeps deprecated exports as aliases while canonical APIs read the original v1/v2 wire format', () => {
  expect(createCityScene).toBe(createCesiumScene)
  expect(parseCityScene).toBe(parseCesiumScene)
  expect(getCityNodeState).toBe(getCesiumSceneNodeState)
  for (const version of [1, 2] as const) {
    const legacy = createCityScene(); legacy.version = version
    const serialized = JSON.stringify(legacy)
    expect(parseCesiumScene(serialized)).toEqual(legacy)
    expect(parseCityScene(serialized)).toEqual(legacy)
  }
})
