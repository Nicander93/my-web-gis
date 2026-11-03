import { expect, it } from 'vitest'
import { createCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { getLiveSceneCamera, getLiveSceneDiagnostics, registerSceneCameraReader, registerSceneDiagnosticsReader } from './scene3d-runtime-host'

it('captures detached live cameras and keeps a newer viewport registered during old cleanup', () => {
  const first = createCesiumScene().camera
  const removeFirst = registerSceneCameraReader(() => first)
  const captured = getLiveSceneCamera()!
  expect(captured).toEqual(first)
  expect(captured).not.toBe(first)
  const second = structuredClone(first)
  second.heading = first.heading + 20
  const removeSecond = registerSceneCameraReader(() => second)
  removeFirst()
  expect(getLiveSceneCamera()).toEqual(second)
  removeSecond()
  expect(getLiveSceneCamera()).toBeNull()
})

it('exposes detached diagnostics only while their runtime owner is registered', () => {
  const diagnostics = { sceneObjects: 500, graphicObjects: 500, managedLayers: 500, dataSources: 1, primitives: 0 }
  const remove = registerSceneDiagnosticsReader(() => diagnostics)
  const read = getLiveSceneDiagnostics()!
  expect(read).toEqual(diagnostics); read.dataSources = 20; expect(getLiveSceneDiagnostics()?.dataSources).toBe(1)
  remove(); expect(getLiveSceneDiagnostics()).toBeNull()
})

it('ignores a live camera while its owning project or preset is no longer current', () => {
  let current = true
  const camera = createCesiumScene().camera
  const remove = registerSceneCameraReader(() => camera, () => current)
  expect(getLiveSceneCamera()).toEqual(camera)
  current = false
  expect(getLiveSceneCamera()).toBeNull()
  remove()
})
