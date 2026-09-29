/**
 * P14 layer tree: groups, visibility, order persistence helpers.
 */
import { describe, expect, it } from 'vitest'
import {
  createLayerGroup,
  createProject,
  flattenLayerIds,
  getEffectiveVisible,
  layerListZIndex,
  layersWithEffectiveVisibility,
  normalizeLayerTree,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  createDefaultLayerStyle,
  type Layer,
  type Project
} from './index'

function layer(id: string, name = id): Layer {
  return {
    id,
    datasetId: `ds-${id}`,
    name,
    visible: true,
    opacity: 1,
    editable: false,
    style: createDefaultLayerStyle('point')
  }
}

describe('P14 layer tree / groups', () => {
  it('normalizes legacy projects without groups/rootOrder from layers array order', () => {
    const legacy = {
      id: 'p1',
      version: 1,
      name: 'Legacy',
      crs: 'EPSG:3857',
      datasets: [],
      layers: [layer('a'), layer('b'), layer('c')],
      mapState: { center: [0, 0] as [number, number], zoom: 2, rotation: 0 },
      basemap: { type: 'osm' as const },
      settings: {}
    }
    const snap = parseProjectSnapshot(JSON.stringify({ project: legacy, featuresByDataset: {} }))
    expect(snap.project.groups).toEqual([])
    expect(flattenLayerIds(snap.project)).toEqual(['a', 'b', 'c'])
  })

  it('persists group membership and root order across serialize/parse', () => {
    let project = createProject('Grouped')
    project.layers = [layer('a'), layer('b'), layer('c')]
    const group = createLayerGroup('G1', ['b', 'c'])
    project.groups = [group]
    project.rootOrder = [
      { type: 'layer', id: 'a' },
      { type: 'group', id: group.id }
    ]
    project = normalizeLayerTree(project)

    const text = serializeProjectSnapshot({ project, featuresByDataset: {} })
    const restored = parseProjectSnapshot(text).project
    expect(flattenLayerIds(restored)).toEqual(['a', 'b', 'c'])
    expect(restored.groups).toHaveLength(1)
    expect(restored.groups[0]?.layerIds).toEqual(['b', 'c'])
    expect(restored.groups[0]?.name).toBe('G1')
  })

  it('hides group without mutating child layer.visible; restore on show', () => {
    let project = createProject('Vis')
    project.layers = [layer('a'), layer('b')]
    project.layers[1]!.visible = false
    const group = createLayerGroup('G', ['a', 'b'])
    group.visible = false
    project.groups = [group]
    project.rootOrder = [{ type: 'group', id: group.id }]
    project = normalizeLayerTree(project)

    expect(project.layers.find((l) => l.id === 'a')?.visible).toBe(true)
    expect(project.layers.find((l) => l.id === 'b')?.visible).toBe(false)
    expect(getEffectiveVisible(project, 'a')).toBe(false)
    expect(getEffectiveVisible(project, 'b')).toBe(false)

    project = {
      ...project,
      groups: project.groups.map((g) => (g.id === group.id ? { ...g, visible: true } : g))
    }
    expect(getEffectiveVisible(project, 'a')).toBe(true)
    expect(getEffectiveVisible(project, 'b')).toBe(false)
  })

  it('list top gets highest z-index', () => {
    expect(layerListZIndex(0, 3)).toBe(12)
    expect(layerListZIndex(1, 3)).toBe(11)
    expect(layerListZIndex(2, 3)).toBe(10)
  })

  it('layersWithEffectiveVisibility applies group override for map sync', () => {
    let project = createProject('Eff')
    project.layers = [layer('a'), layer('b')]
    const group = createLayerGroup('G', ['a'])
    group.visible = false
    project.groups = [group]
    project.rootOrder = [
      { type: 'group', id: group.id },
      { type: 'layer', id: 'b' }
    ]
    project = normalizeLayerTree(project)
    const synced = layersWithEffectiveVisibility(project)
    expect(synced.map((l) => [l.id, l.visible])).toEqual([
      ['a', false],
      ['b', true]
    ])
  })

  it('drops stale group child ids and keeps ungrouped layers in rootOrder', () => {
    let project = createProject('Stale')
    project.layers = [layer('a')]
    project.groups = [createLayerGroup('G', ['a', 'missing'])]
    project.rootOrder = [{ type: 'group', id: project.groups[0]!.id }]
    project = normalizeLayerTree(project)
    expect(project.groups[0]?.layerIds).toEqual(['a'])
    expect(flattenLayerIds(project)).toEqual(['a'])
  })
})
