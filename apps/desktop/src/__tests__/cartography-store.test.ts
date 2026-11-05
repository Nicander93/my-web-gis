import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectSession } from '@/project/project-session'
import { projectEdits } from '@/project/project-edits'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createProject,
  getLayerCartography,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  setLayerCartography,
  type CartographyState
} from '@desktop-webgis/project'
import type { LayerStyle } from '@desktop-webgis/ol-style'
import { useProjectStore } from '@/project/project.store'

type CartographyLayer = CartographyState['styleLayers'][number]
type CircleColor = NonNullable<Extract<CartographyLayer, { type: 'circle' }>['paint']>['circle-color']

function paintValue(layer: CartographyLayer | undefined, property: string): unknown {
  return layer?.paint ? (layer.paint as Record<string, unknown>)[property] : undefined
}

function resetStore(): void {
  projectEdits.clear()
  projectSession.loadSnapshot({ project: createProject('Cartography store'), featuresByDataset: {} })
}

function cartographyByLayer(): Map<string, unknown> {
  const project = useProjectStore.getState().project
  return new Map(requireMapContent(project).cartography?.bindings.map(binding => [binding.gisLayerId, getLayerCartography(project, binding.gisLayerId)]) ?? [])
}

beforeEach(resetStore)

describe('Project Store cartography lifecycle', () => {
  it('synchronizes bindings when layers are added and removed', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('data-a', 'A', [], 'point')
    const layerId = requireMapContent(useProjectStore.getState().project).layers[0]!.id
    const bindings = cartographyByLayer()
    expect(bindings.size).toBe(1)
    expect(bindings.has(layerId)).toBe(true)
    expect(layerContentCommands.removeLayer(layerId)).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).cartography?.bindings).toEqual([])
    expect(requireMapContent(useProjectStore.getState().project).cartography?.styleLayers).toEqual([])
  })

  it('removes grouped cartography atomically and restores it on undo/redo', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('data-a', 'A', [], 'point')
    layerContentCommands.addLayer('data-b', 'B', [], 'line')
    const snapshot = projectSession.getSnapshot()
    const [a, b] = requireMapContent(snapshot.project).layers.map(layer => layer.id)
    const fragment = getLayerCartography(snapshot.project, a!)!
    const circle = fragment.styleLayers.find(layer => layer.type === 'circle')
    if (!circle || circle.type !== 'circle') throw new Error('Expected a migrated circle layer')
    const categoryExpression: CircleColor = ['match', ['get', 'kind'], 'major', '#f00', '#00f']
    const advanced = {
      ...circle,
      paint: { ...circle.paint, 'circle-color': categoryExpression }
    }
    snapshot.project = setLayerCartography(snapshot.project, a!, [advanced])
    projectSession.loadSnapshot(snapshot)
    const groupId = layerConfigurationCommands.createGroup('Group', [a!, b!])!
    const grouped = projectSession.getSnapshot()
    const advancedBeforeDelete = getLayerCartography(grouped.project, a!)
    expect(paintValue(advancedBeforeDelete?.styleLayers[0], 'circle-color')).toEqual(['match', ['get', 'kind'], 'major', '#f00', '#00f'])
    const bindings = cartographyByLayer()
    expect(bindings.size).toBe(2)
    expect(bindings.has(a!)).toBe(true)
    expect(bindings.has(b!)).toBe(true)

    layerContentCommands.removeGroup(groupId, true)
    expect(requireMapContent(useProjectStore.getState().project).layers).toHaveLength(0)
    expect(requireMapContent(useProjectStore.getState().project).cartography?.bindings).toEqual([])
    expect(requireMapContent(useProjectStore.getState().project).cartography?.styleLayers).toEqual([])
    expect(projectEdits.undo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(grouped)
    expect(getLayerCartography(useProjectStore.getState().project, a!)).toEqual(advancedBeforeDelete)
    expect(projectEdits.redo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).cartography?.bindings).toEqual([])
  })

  it('restores an advanced expression fragment through style undo and project save/reopen', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('data', 'Advanced', [], 'point')
    const snapshot = projectSession.getSnapshot()
    const layerId = requireMapContent(snapshot.project).layers[0]!.id
    const fragment = getLayerCartography(snapshot.project, layerId)!
    const circle = fragment.styleLayers.find(layer => layer.type === 'circle')
    if (!circle || circle.type !== 'circle') throw new Error('Expected a migrated circle layer')
    const categoryExpression: CircleColor = ['match', ['get', 'kind'], 'major', '#f00', '#00f']
    const advanced = {
      ...circle,
      paint: {
        ...circle.paint,
        'circle-color': categoryExpression
      }
    }
    snapshot.project = setLayerCartography(snapshot.project, layerId, [advanced])
    projectSession.loadSnapshot(snapshot)
    const beforeStyle = getLayerCartography(useProjectStore.getState().project, layerId)
    const nextStyle: LayerStyle = { mode: 'single', symbol: { type: 'circle', radius: 9, fill: { r: 1, g: 2, b: 3, a: 1 } } }

    layerConfigurationCommands.setLayerStyle(layerId, nextStyle)
    expect(getLayerCartography(useProjectStore.getState().project, layerId)?.styleLayers).not.toEqual(beforeStyle?.styleLayers)
    expect(projectEdits.undo()).toBe(true)
    expect(getLayerCartography(useProjectStore.getState().project, layerId)).toEqual(beforeStyle)
    expect(projectEdits.redo()).toBe(true)
    expect(projectEdits.undo()).toBe(true)

    const saved = serializeProjectSnapshot(projectSession.getSnapshot())
    const reopened = parseProjectSnapshot(saved)
    expect(getLayerCartography(reopened.project, layerId)).toEqual(beforeStyle)
    expect(paintValue(requireMapContent(reopened.project).cartography?.styleLayers[0], 'circle-color')).toEqual(['match', ['get', 'kind'], 'major', '#f00', '#00f'])
  })

  it('writes style transactions immediately and coalesces twenty input updates to one undo', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('data', 'Immediate', [], 'point')
    const layer = requireMapContent(useProjectStore.getState().project).layers[0]!
    const original = getLayerCartography(useProjectStore.getState().project, layer.id)
    const styleAt = (radius: number): LayerStyle => ({
      mode: 'single',
      symbol: { type: 'circle', radius, fill: { r: 10, g: 20, b: 30, a: 1 } }
    })

    for (let index = 1; index <= 20; index++) {
      layerConfigurationCommands.setLayerStyle(layer.id, styleAt(index), 'width-drag-1')
    }

    const current = useProjectStore.getState()
    expect(current.dirty).toBe(true)
    expect(requireMapContent(current.project).layers[0]!.style).toEqual(styleAt(20))
    expect(getLayerCartography(current.project, layer.id)).not.toEqual(original)
    expect(parseProjectSnapshot(serializeProjectSnapshot(projectSession.getSnapshot())).project).toEqual(current.project)
    expect(projectEdits.undo()).toBe(true)
    expect(getLayerCartography(useProjectStore.getState().project, layer.id)).toEqual(original)
    expect(projectEdits.redo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers[0]!.style).toEqual(styleAt(20))
  })

  it('coalesces standard layer fragments while preserving the legacy cache and unrelated bindings', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('data-a', 'A', [], 'point')
    layerContentCommands.addLayer('data-b', 'B', [], 'point')
    const project = useProjectStore.getState().project
    const [a, b] = requireMapContent(project).layers.map(layer => layer.id)
    const before = getLayerCartography(project, a!)!
    const legacyCache = requireMapContent(project).layers.find(layer => layer.id === a)!.style
    const unrelated = getLayerCartography(project, b!)

    for (let index = 1; index <= 20; index++) {
      const latest = useProjectStore.getState().project
      const fragment = getLayerCartography(latest, a!)!
      const layers = fragment.styleLayers.map(layer => {
        if (layer.type !== 'circle') throw new Error('Expected a circle layer')
        return { ...layer, paint: { ...layer.paint, 'circle-radius': index } }
      })
      layerConfigurationCommands.setLayerCartography(a!, layers, 'radius-drag')
    }

    const current = useProjectStore.getState()
    expect((getLayerCartography(current.project, a!)!.styleLayers[0]!.paint as Record<string, unknown>)['circle-radius']).toBe(20)
    expect(requireMapContent(current.project).layers.find(layer => layer.id === a)!.style).toEqual(legacyCache)
    expect(getLayerCartography(current.project, b!)).toEqual(unrelated)
    expect(parseProjectSnapshot(serializeProjectSnapshot(projectSession.getSnapshot())).project).toEqual(current.project)

    expect(projectEdits.undo()).toBe(true)
    expect(getLayerCartography(useProjectStore.getState().project, a!)).toEqual(before)
    expect(getLayerCartography(useProjectStore.getState().project, b!)).toEqual(unrelated)
    expect(projectEdits.redo()).toBe(true)
    expect((getLayerCartography(useProjectStore.getState().project, a!)!.styleLayers[0]!.paint as Record<string, unknown>)['circle-radius']).toBe(20)
  })

  it('creates one undo entry per gesture token', () => {
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('data', 'Gestures', [], 'point')
    const layerId = requireMapContent(useProjectStore.getState().project).layers[0]!.id
    const styleAt = (radius: number): LayerStyle => ({ mode: 'single', symbol: { type: 'circle', radius, fill: { r: 10, g: 20, b: 30, a: 1 } } })

    layerConfigurationCommands.setLayerStyle(layerId, styleAt(2), 'gesture-a')
    layerConfigurationCommands.setLayerStyle(layerId, styleAt(3), 'gesture-a')
    layerConfigurationCommands.setLayerStyle(layerId, styleAt(4), 'gesture-b')
    expect(projectEdits.undo()).toBe(true)
    expect((requireMapContent(useProjectStore.getState().project).layers[0]!.style as { symbol: { radius: number } }).symbol.radius).toBe(3)
    expect(projectEdits.undo()).toBe(true)
    expect((requireMapContent(useProjectStore.getState().project).layers[0]!.style as { symbol: { radius: number } }).symbol.radius).toBe(5)
  })
})
