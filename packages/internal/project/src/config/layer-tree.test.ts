import { requireMapContent } from './project-content'
/**
 * P14 图层树：分组、可见性和顺序的持久化辅助函数。
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
  moveLayerTreeEntry,
  dissolveLayerGroup,
  getEffectiveLocked,
  parseProjectSnapshot,
  serializeProjectSnapshot,
  createDefaultLayerStyle,
  type Layer,
  type Project
} from '../index'

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
  it('persists local locks independently of legacy editable and blocks moving locked layers', () => {
    const project = createProject('Locks'), content = requireMapContent(project)
    content.layers = [layer('a'), { ...layer('b'), editable: true, locked: true }]
    content.datasets = content.layers.map(layer => ({ id: layer.datasetId, name: layer.name, kind: 'vector', source: { type: 'memory', label: layer.name } }))
    content.rootOrder = content.layers.map(layer => ({ type: 'layer', id: layer.id }))
    expect(getEffectiveLocked(project, 'a')).toBe(false)
    expect(getEffectiveLocked(project, 'b')).toBe(true)
    expect(() => moveLayerTreeEntry(project, { type: 'layer', id: 'b' }, undefined, 0)).toThrow('锁定')
    const restored = parseProjectSnapshot(serializeProjectSnapshot({ project, featuresByDataset: {} })).project
    expect(getEffectiveLocked(restored, 'b')).toBe(true)
    expect(requireMapContent(restored).layers[1].editable).toBe(true)
    content.layers[0].locked = 'yes' as unknown as boolean
    expect(() => normalizeLayerTree(project)).toThrow('锁定状态')
  })

  it('retains a valid frozen tree and shares unaffected folders while repairing stale membership', () => {
    const project = createProject('Shared tree'), content = requireMapContent(project)
    content.layers = [layer('a'), layer('b')]
    content.groups = [createLayerGroup('First', ['a']), createLayerGroup('Second', ['b'])]
    content.rootOrder = content.groups.map(group => ({ type: 'group', id: group.id }))
    for (const group of content.groups) { Object.freeze(group.layerIds); Object.freeze(group) }
    Object.freeze(content.groups); Object.freeze(content.rootOrder); Object.freeze(content)
    expect(normalizeLayerTree(project)).toBe(project)
    const stale = { ...project, content: { ...content, groups: [{ ...content.groups[0], layerIds: ['a', 'missing'] }, content.groups[1]] } }
    const fixed = normalizeLayerTree(stale), normalized = requireMapContent(fixed)
    expect(normalized.groups[0].layerIds).toEqual(['a'])
    expect(normalized.groups[1]).toBe(content.groups[1])
    expect(normalized.rootOrder).toBe(content.rootOrder)
    expect(stale.content.groups[0].layerIds).toEqual(['a', 'missing'])
    expect(normalizeLayerTree(fixed)).toBe(fixed)
  })

  it('preserves mixed nested sibling order, ancestor state and JSON round trips', () => {
    let project = createProject('Nested')
    requireMapContent(project).layers = [layer('a'), layer('b'), layer('c')]
    requireMapContent(project).datasets = requireMapContent(project).layers.map(layer => ({ id: layer.datasetId, name: layer.name, kind: 'vector', source: { type: 'memory', label: layer.name } }))
    requireMapContent(project).groups = [{ id: 'outer', name: 'Outer', visible: false, locked: true, layerIds: ['b'], childOrder: [{ type: 'group', id: 'inner' }, { type: 'layer', id: 'b' }] }, { id: 'inner', parentId: 'outer', name: 'Inner', visible: true, layerIds: ['a'] }]
    requireMapContent(project).rootOrder = [{ type: 'layer', id: 'c' }, { type: 'group', id: 'outer' }]
    project = normalizeLayerTree(project)
    expect(flattenLayerIds(project)).toEqual(['c', 'a', 'b'])
    expect(getEffectiveVisible(project, 'a')).toBe(false)
    expect(getEffectiveLocked(project, 'a')).toBe(true)
    const restored = parseProjectSnapshot(serializeProjectSnapshot({ project, featuresByDataset: {} })).project
    expect(requireMapContent(restored).groups).toEqual(requireMapContent(project).groups)
    expect(requireMapContent(restored).layers[0].visible).toBe(true)
    expect(() => moveLayerTreeEntry(project, { type: 'layer', id: 'a' })).toThrow('锁定')
    requireMapContent(project).groups[0].locked = false
    expect(() => moveLayerTreeEntry(project, { type: 'group', id: 'outer' }, 'inner')).toThrow('后代')
    const dissolved = dissolveLayerGroup(project, 'outer')
    expect(flattenLayerIds(dissolved)).toEqual(['c', 'a', 'b'])
    expect(requireMapContent(dissolved).groups).toHaveLength(1)
    expect(requireMapContent(dissolved).groups[0].parentId).toBeUndefined()
    expect(getEffectiveVisible(dissolved, 'a')).toBe(false)
    expect(requireMapContent(dissolved).layers.find(layer => layer.id === 'b')?.visible).toBe(false)
  })
  it('normalizes legacy projects without groups/rootOrder from layers array order', () => {
    const legacy = {
      id: 'p1',
      version: 1,
      name: 'Legacy',
      crs: 'EPSG:3857',
      datasets: ['a', 'b', 'c'].map(id => ({ id: `ds-${id}`, name: id, kind: 'vector', source: { type: 'memory', label: id } })),
      layers: [layer('a'), layer('b'), layer('c')],
      mapState: { center: [0, 0] as [number, number], zoom: 2, rotation: 0 },
      basemap: { type: 'osm' as const },
      settings: {}
    }
    const snap = parseProjectSnapshot(JSON.stringify({ project: legacy, featuresByDataset: {} }))
    expect(requireMapContent(snap.project).groups).toEqual([])
    expect(flattenLayerIds(snap.project)).toEqual(['a', 'b', 'c'])
  })

  it('persists group membership and root order across serialize/parse', () => {
    let project = createProject('Grouped')
    requireMapContent(project).layers = [layer('a'), layer('b'), layer('c')]
    requireMapContent(project).datasets = requireMapContent(project).layers.map(layer => ({ id: layer.datasetId, name: layer.name, kind: 'vector', source: { type: 'memory', label: layer.name } }))
    const group = createLayerGroup('G1', ['b', 'c'])
    requireMapContent(project).groups = [group]
    requireMapContent(project).rootOrder = [
      { type: 'layer', id: 'a' },
      { type: 'group', id: group.id }
    ]
    project = normalizeLayerTree(project)

    const text = serializeProjectSnapshot({ project, featuresByDataset: {} })
    const restored = parseProjectSnapshot(text).project
    expect(flattenLayerIds(restored)).toEqual(['a', 'b', 'c'])
    expect(requireMapContent(restored).groups).toHaveLength(1)
    expect(requireMapContent(restored).groups[0]?.layerIds).toEqual(['b', 'c'])
    expect(requireMapContent(restored).groups[0]?.name).toBe('G1')
  })

  it('hides group without mutating child layer.visible; restore on show', () => {
    let project = createProject('Vis')
    requireMapContent(project).layers = [layer('a'), layer('b')]
    requireMapContent(project).layers[1]!.visible = false
    const group = createLayerGroup('G', ['a', 'b'])
    group.visible = false
    requireMapContent(project).groups = [group]
    requireMapContent(project).rootOrder = [{ type: 'group', id: group.id }]
    project = normalizeLayerTree(project)

    expect(requireMapContent(project).layers.find((l) => l.id === 'a')?.visible).toBe(true)
    expect(requireMapContent(project).layers.find((l) => l.id === 'b')?.visible).toBe(false)
    expect(getEffectiveVisible(project, 'a')).toBe(false)
    expect(getEffectiveVisible(project, 'b')).toBe(false)

    project = { ...project, content: { ...requireMapContent(project), groups: requireMapContent(project).groups.map((g) => (g.id === group.id ? { ...g, visible: true } : g)) } }
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
    requireMapContent(project).layers = [layer('a'), layer('b')]
    const group = createLayerGroup('G', ['a'])
    group.visible = false
    requireMapContent(project).groups = [group]
    requireMapContent(project).rootOrder = [
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
    requireMapContent(project).layers = [layer('a')]
    requireMapContent(project).groups = [createLayerGroup('G', ['a', 'missing'])]
    requireMapContent(project).rootOrder = [{ type: 'group', id: requireMapContent(project).groups[0]!.id }]
    project = normalizeLayerTree(project)
    expect(requireMapContent(project).groups[0]?.layerIds).toEqual(['a'])
    expect(flattenLayerIds(project)).toEqual(['a'])
  })
})
