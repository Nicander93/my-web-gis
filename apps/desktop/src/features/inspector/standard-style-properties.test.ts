import { beforeEach, expect, it } from 'vitest'
import { createProject, getLayerCartography } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { updateStandardStyleProperty } from './standard-style-properties'
import { beginStyleInteraction, finishStyleInteraction } from './style-interaction'

beforeEach(() => {
  useProjectStore.getState().loadSnapshot({ project: createProject('Standard controls'), featuresByDataset: {} })
  useProjectStore.getState().addLayer('dataset', 'Points', [], 'point')
  finishStyleInteraction()
})

it('changes a literal parameter while preserving a sibling expression, rules and metadata through undo', () => {
  const state = useProjectStore.getState()
  const id = state.project.layers[0]!.id
  const fragment = getLayerCartography(state.project, id)!
  const first = fragment.styleLayers.find(item => item.type === 'circle')!
  if (first.type !== 'circle') throw new Error('Expected circle')
  const advanced = [{ ...first, metadata: { preserved: 'yes' }, minzoom: 3, paint: { ...first.paint, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 20, 14] as NonNullable<typeof first.paint>['circle-radius'] } }]
  state.setLayerCartography(id, advanced)
  const epoch = useProjectStore.getState().projectEpoch
  const gesture = beginStyleInteraction(id, 'color')
  updateStandardStyleProperty(epoch, id, first.id, 'paint', 'circle-color', '#112233', gesture)
  updateStandardStyleProperty(epoch, id, first.id, 'paint', 'circle-color', '#223344', gesture)
  finishStyleInteraction(id)
  const after = getLayerCartography(useProjectStore.getState().project, id)!
  expect(after.styleLayers[0]).toEqual({ ...advanced[0], paint: { ...advanced[0]!.paint, 'circle-color': '#223344' } })
  useProjectStore.getState().undoEdit()
  expect(getLayerCartography(useProjectStore.getState().project, id)!.styleLayers).toEqual(advanced)
  useProjectStore.getState().redoEdit()
  expect(getLayerCartography(useProjectStore.getState().project, id)).toEqual(after)
})

it('rejects stale project writes and locked targets without changing data', () => {
  const state = useProjectStore.getState(), id = state.project.layers[0]!.id
  const fragment = getLayerCartography(state.project, id)!
  const drawing = fragment.styleLayers[0]!
  const epoch = state.projectEpoch
  state.loadSnapshot(state.getSnapshot())
  const before = useProjectStore.getState().getSnapshot()
  expect(() => updateStandardStyleProperty(epoch, id, drawing.id, 'paint', 'circle-color', '#112233')).toThrow('工程已切换')
  expect(useProjectStore.getState().getSnapshot()).toEqual(before)
  const groupId = useProjectStore.getState().createGroup('Locked', [id])
  if (!groupId) throw new Error('Expected group')
  useProjectStore.getState().setGroupLocked(groupId, true)
  const locked = useProjectStore.getState().getSnapshot()
  expect(() => updateStandardStyleProperty(useProjectStore.getState().projectEpoch, id, drawing.id, 'paint', 'circle-color', '#112233')).toThrow('图层已锁定')
  expect(useProjectStore.getState().getSnapshot()).toEqual(locked)
})
