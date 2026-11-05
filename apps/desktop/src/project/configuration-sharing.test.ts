import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { projectSession } from '@/project/project-session'
import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultLayerStyle, createProject, requireMapContent } from '@desktop-webgis/project'
import { useProjectStore } from './project.store'
import { projectEdits } from '@/project/project-edits'

beforeEach(() => {
  const project = createProject('Shared configuration'), content = requireMapContent(project)
  content.datasets = [{ id: 'data', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
  content.layers = ['a', 'b'].map(id => ({ id, name: id, datasetId: 'data', visible: true, editable: true, opacity: 1, style: createDefaultLayerStyle('point') }))
  content.groups = [{ id: 'group', name: 'Group', visible: true, layerIds: ['a', 'b'], childOrder: [{ type: 'layer', id: 'a' }, { type: 'layer', id: 'b' }] }]
  content.rootOrder = [{ type: 'group', id: 'group' }]
  projectSession.loadSnapshot({ project, featuresByDataset: {} })
})

describe('configuration structural sharing', () => {
  it('changes one style without replacing metadata, tree, unrelated layers or data configuration', () => {
    const before = useProjectStore.getState().project, content = requireMapContent(before)
    layerConfigurationCommands.setLayerStyle('a', { mode: 'single', symbol: { type: 'circle', radius: 9 } })
    const after = useProjectStore.getState().project, next = requireMapContent(after)
    expect(after.metadata).toBe(before.metadata)
    expect(next.datasets).toBe(content.datasets)
    expect(next.layers[1]).toBe(content.layers[1])
    expect(next.groups).toBe(content.groups)
    expect(next.rootOrder).toBe(content.rootOrder)
    expect(next.basemap).toBe(content.basemap)
    expect(next.initialView).toBe(content.initialView)
    expect(projectEdits.undo()).toBe(true)
    const restored = requireMapContent(useProjectStore.getState().project)
    expect(restored.layers[0].style).toEqual(content.layers[0].style)
    expect(restored.layers[1]).toBe(content.layers[1])
    expect(restored.groups).toBe(content.groups)
  })

  it('renames a layer and folder without replacing their unchanged configuration branches', () => {
    const before = useProjectStore.getState().project, content = requireMapContent(before)
    layerConfigurationCommands.renameLayer('a', 'Renamed layer')
    let next = requireMapContent(useProjectStore.getState().project)
    expect(next.layers[0].name).toBe('Renamed layer')
    expect(next.layers[0].style).toBe(content.layers[0].style)
    expect(next.layers[1]).toBe(content.layers[1])
    expect(next.groups).toBe(content.groups)
    expect(next.cartography).toBe(content.cartography)
    layerConfigurationCommands.renameGroup('group', 'Renamed group')
    next = requireMapContent(useProjectStore.getState().project)
    expect(next.groups[0].name).toBe('Renamed group')
    expect(next.groups[0].layerIds).toBe(content.groups[0].layerIds)
    expect(next.groups[0].childOrder).toBe(content.groups[0].childOrder)
    expect(next.rootOrder).toBe(content.rootOrder)
    expect(next.datasets).toBe(content.datasets)
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).groups[0].name).toBe('Group')
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers[0].name).toBe('a')
  })
})
