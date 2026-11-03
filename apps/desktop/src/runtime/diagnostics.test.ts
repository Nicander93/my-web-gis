import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectSession } from '@/session/project-session'
import { projectEdits } from '@/session/project-edits'
import { beforeEach, expect, it } from 'vitest'
import { createProject } from '@desktop-webgis/project'
import { createCesiumScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { useProjectStore } from '@/session/project.store'
import { collectDiagnostics } from './diagnostics'

beforeEach(() => projectSession.loadSnapshot({ project: createProject(), featuresByDataset: {} }))
it('reports project counts without altering data, dirty state or undo history', () => {
  const store = useProjectStore.getState()
  layerContentCommands.addLayer('points', 'Points', [{ id: 'one', properties: {}, geometry: { type: 'Point', coordinates: [116, 39] } }], 'point')
  const before = projectSession.getSnapshot(), undo = projectEdits.canUndo(), dirty = useProjectStore.getState().dirty
  const report = collectDiagnostics()
  expect(report.project).toMatchObject({ layers: 1, features: 1, saveState: '有未保存修改' })
  expect(report.resources[0].state).toBe('unknown')
  expect(projectSession.getSnapshot()).toEqual(before)
  expect(projectEdits.canUndo()).toBe(undo)
  expect(useProjectStore.getState().dirty).toBe(dirty)
})
it('keeps unknown/loading/failure distinct and redacts copied resource errors', () => {
  const project = createProject('Scene', 'scene3d')
  project.content.scene = createCesiumScene()
  project.content.scene.assets.a = { type: 'glb', reference: { kind: 'absolute', path: 'D:/models/missing.glb' } }
  project.content.scene.nodes.push({ id: 'a', name: 'Model', type: 'model', asset: 'a', visible: true, position: [116, 39, 0], transform: createTransform() })
  projectSession.loadSnapshot({ project, featuresByDataset: {} })
  expect(collectDiagnostics().resources[0].state).toBe('unknown')
  expect(collectDiagnostics({ a: { state: 'loading' } }).resources[0].state).toBe('loading')
  const report = collectDiagnostics({ a: { state: 'error', error: 'https://user:pass@example.com/data?token=secret' } })
  expect(report.resources[0]).toMatchObject({ state: 'error', source: 'D:/models/missing.glb' })
  expect(JSON.stringify(report)).not.toContain('secret')
  expect(JSON.stringify(report)).not.toContain('user:pass')
})
