import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectSession } from '@/session/project-session'
import { projectEdits } from '@/session/project-edits'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, expect, it } from 'vitest'
import { createProject, getLayerCartography } from '@desktop-webgis/project'
import { useProjectStore } from '@/session/project.store'
import { updateStandardStyleProperty } from './standard-style-properties'
import { beginStyleInteraction, finishStyleInteraction } from '@/session/style-interaction'

beforeEach(() => {
  projectSession.loadSnapshot({ project: createProject('Standard controls'), featuresByDataset: {} })
  layerContentCommands.addLayer('dataset', 'Points', [], 'point')
  finishStyleInteraction()
})

it('changes a literal parameter while preserving a sibling expression, rules and metadata through undo', () => {
  const state = useProjectStore.getState()
  const id = requireMapContent(state.project).layers[0]!.id
  const fragment = getLayerCartography(state.project, id)!
  const first = fragment.styleLayers.find(item => item.type === 'circle')!
  if (first.type !== 'circle') throw new Error('Expected circle')
  const advanced = [{ ...first, metadata: { preserved: 'yes' }, minzoom: 3, paint: { ...first.paint, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 20, 14] as NonNullable<typeof first.paint>['circle-radius'] } }]
  layerConfigurationCommands.setLayerCartography(id, advanced)
  const epoch = useProjectStore.getState().projectEpoch
  const gesture = beginStyleInteraction(id, 'color')
  updateStandardStyleProperty(epoch, id, first.id, 'paint', 'circle-color', '#112233', gesture)
  updateStandardStyleProperty(epoch, id, first.id, 'paint', 'circle-color', '#223344', gesture)
  finishStyleInteraction(id)
  const after = getLayerCartography(useProjectStore.getState().project, id)!
  expect(after.styleLayers[0]).toEqual({ ...advanced[0], paint: { ...advanced[0]!.paint, 'circle-color': '#223344' } })
  projectEdits.undo()
  expect(getLayerCartography(useProjectStore.getState().project, id)!.styleLayers).toEqual(advanced)
  projectEdits.redo()
  expect(getLayerCartography(useProjectStore.getState().project, id)).toEqual(after)
})

it('rejects stale project writes and locked targets without changing data', () => {
  const state = useProjectStore.getState(), id = requireMapContent(state.project).layers[0]!.id
  const fragment = getLayerCartography(state.project, id)!
  const drawing = fragment.styleLayers[0]!
  const epoch = state.projectEpoch
  projectSession.loadSnapshot(projectSession.getSnapshot())
  const before = projectSession.getSnapshot()
  expect(() => updateStandardStyleProperty(epoch, id, drawing.id, 'paint', 'circle-color', '#112233')).toThrow('工程已切换')
  expect(projectSession.getSnapshot()).toEqual(before)
  const groupId = layerConfigurationCommands.createGroup('Locked', [id])
  if (!groupId) throw new Error('Expected group')
  layerConfigurationCommands.setGroupLocked(groupId, true)
  const locked = projectSession.getSnapshot()
  expect(() => updateStandardStyleProperty(useProjectStore.getState().projectEpoch, id, drawing.id, 'paint', 'circle-color', '#112233')).toThrow('图层已锁定')
  expect(projectSession.getSnapshot()).toEqual(locked)
})
