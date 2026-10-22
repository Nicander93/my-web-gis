import { describe, expect, it } from 'vitest'
import { getLayerCartography, getProjectCartographyStyle, reconcileProjectCartography, setLayerCartography, setLegacyLayerStyle } from './cartography'
import { ApplyProjectSnapshotEditCommand, SetDatasetContentCommand, SetLayerCartographyCommand, SetLayerStyleCommand, type ProjectEditContext } from './configCommands'
import { MemoryFeatureStore } from './featureStore'
import { EditHistory } from './editHistory'
import { createDefaultLayerStyle, createProject, parseProjectSnapshot, prepareProjectContent, serializeProjectSnapshot } from './project'
import type { Project } from './types'

function projectFixture(): Project {
  const project = createProject('Cartography')
  project.datasets = [{ id: 'data', kind: 'vector', name: 'Data', source: { type: 'memory', label: 'Data' } }]
  project.layers = ['top', 'bottom'].map(id => ({ id, datasetId: 'data', name: id, visible: true, editable: true, opacity: 1, style: createDefaultLayerStyle('line') }))
  return prepareProjectContent(project)
}

function advancedProject(): Project {
  const project = projectFixture()
  const fragment = getLayerCartography(project, 'top')!
  return setLayerCartography(project, 'top', [{ id: 'advanced', type: 'line', source: fragment.binding.styleSourceId,
    filter: ['==', ['get', 'name'], 'name'], paint: { 'line-color': ['match', ['get', 'name'], 'name', '#f00', '#00f'] } }])
}

function contextFor(initial: Project) {
  let project = initial
  const context: ProjectEditContext = { featureStore: new MemoryFeatureStore(), getProject: () => project,
    replaceProject: next => { project = reconcileProjectCartography(next, project) },
    applySnapshotEdit: snapshot => { project = reconcileProjectCartography(snapshot.project, project) } }
  return { context, get: () => project }
}

describe('project cartography contract', () => {
  it('migrates v1 immutably and idempotently; v2 is complete and keeps shared-source groups distinct', () => {
    const legacy = projectFixture()
    legacy.version = 1
    delete legacy.cartography
    const original = JSON.stringify(legacy), migrations: unknown[] = []
    const migrated = parseProjectSnapshot(original, { onMigration: migration => migrations.push(migration) }).project
    expect(JSON.stringify(legacy)).toBe(original)
    expect(migrations).toEqual([{ fromVersion: 1, toVersion: 2 }])
    expect(migrated.cartography?.bindings[0].styleSourceId).toBe(migrated.cartography?.bindings[1].styleSourceId)
    expect(migrated.cartography?.bindings[0].styleLayerIds).not.toEqual(migrated.cartography?.bindings[1].styleLayerIds)
    const saved = serializeProjectSnapshot({ project: migrated, featuresByDataset: {} })
    expect(parseProjectSnapshot(saved).project).toEqual(migrated)
    expect(prepareProjectContent(migrated)).toEqual(migrated)
    delete migrated.cartography
    expect(() => parseProjectSnapshot(JSON.stringify(migrated))).toThrow('cartography')
  })

  it('preserves legal expressions through rename, visibility, tree reorder, removal and data rebinding', () => {
    const before = advancedProject()
    let project = reconcileProjectCartography({ ...before, layers: before.layers.map(layer => ({ ...layer, name: 'Renamed', visible: false })), rootOrder: [{ type: 'layer', id: 'bottom' }, { type: 'layer', id: 'top' }] }, before)
    expect(project.cartography).toEqual(before.cartography)
    expect(getProjectCartographyStyle(project).layers[0].id).toBe('advanced')
    const next = { ...project, datasets: [...project.datasets, { ...project.datasets[0], id: 'replacement' }], layers: [{ ...project.layers[0], datasetId: 'replacement' }] }
    project = reconcileProjectCartography(next, project)
    expect(project.cartography?.bindings.map(binding => binding.gisLayerId)).toEqual(['top'])
    expect(project.cartography?.styleLayers).toHaveLength(1)
    expect(project.cartography?.bindings[0].datasetId).toBe('replacement')
    expect(getLayerCartography(project, 'top')?.styleLayers[0]).toMatchObject({ id: 'advanced', filter: ['==', ['get', 'name'], 'name'] })
  })

  it('restores an advanced fragment on legacy style undo without reverting another GIS layer', () => {
    const host = contextFor(advancedProject()), before = host.get()
    const command = new SetLayerStyleCommand('style', 'top', before.layers[0].style, createDefaultLayerStyle('point'))
    command.execute(host.context)
    host.context.replaceProject(setLegacyLayerStyle(host.get(), 'bottom', createDefaultLayerStyle('polygon')))
    const retained = getLayerCartography(host.get(), 'bottom')
    command.undo(host.context)
    expect(getLayerCartography(host.get(), 'top')).toEqual(getLayerCartography(before, 'top'))
    expect(getLayerCartography(host.get(), 'bottom')).toEqual(retained)
    command.execute(host.context)
    expect(host.get().layers[0].style).toEqual(createDefaultLayerStyle('point'))
  })

  it('removes vector drawing bindings when a layer is explicitly rebound to a service raster', () => {
    const before = advancedProject(), next = structuredClone(before)
    next.datasets.push({ id: 'raster', name: 'WMS', kind: 'wms', source: { type: 'wms', url: 'https://example.test/wms', version: '1.3.0', layerNames: ['raster'], authMode: 'none' } })
    next.layers[0].datasetId = 'raster'
    const after = reconcileProjectCartography(next, before)
    expect(getLayerCartography(after, 'top')).toBeUndefined()
    expect(getLayerCartography(after, 'bottom')).toEqual(getLayerCartography(before, 'bottom'))
  })

  it('renames only expression field operands, preserves string constants and supports undo/redo', () => {
    const host = contextFor(advancedProject()), before = getLayerCartography(host.get(), 'top')
    const content = { features: [], fields: [{ name: 'name', type: 'string' as const, nullable: true }] }
    const command = new SetDatasetContentCommand('field', 'Rename', 'data', content,
      { ...content, fields: [{ ...content.fields[0], name: 'title' }] }, { before: 'name', after: 'title' })
    command.execute(host.context)
    expect(getLayerCartography(host.get(), 'top')?.styleLayers[0]).toMatchObject({
      filter: ['==', ['get', 'title'], 'name'], paint: { 'line-color': ['match', ['get', 'title'], 'name', '#f00', '#00f'] },
    })
    command.undo(host.context)
    expect(getLayerCartography(host.get(), 'top')).toEqual(before)
    command.execute(host.context)
    expect(JSON.stringify(getLayerCartography(host.get(), 'top'))).toContain('["get","title"]')
  })

  it('rejects removal of referenced advanced fields before project or rows change', () => {
    const host = contextFor(advancedProject()), before = host.get()
    const row = { id: 'one', geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] }, properties: { name: 'name' } }
    host.context.featureStore.setAll('data', [row])
    const command = new SetDatasetContentCommand('field', 'Remove', 'data', { features: [row] }, { features: [] }, { before: 'name' })
    expect(() => command.execute(host.context)).toThrow('高级样式仍引用')
    expect(host.get()).toBe(before)
    expect(host.context.featureStore.getAll('data')).toEqual([row])
    expect(() => command.execute(host.context)).toThrow('高级样式仍引用')
  })

  it('remaps explicit feature properties objects and rejects computed field keys atomically', () => {
    const before = advancedProject(), fragment = getLayerCartography(before, 'top')!
    const project = setLayerCartography(before, 'top', fragment.styleLayers.map(layer => ({ ...layer,
      filter: ['==', ['get', 'name', ['properties']], 'name'],
    })))
    const host = contextFor(project)
    const command = new SetDatasetContentCommand('rename', 'Rename', 'data', { features: [] }, { features: [] }, { before: 'name', after: 'title' })
    command.execute(host.context)
    expect(getLayerCartography(host.get(), 'top')?.styleLayers[0].filter).toEqual(['==', ['get', 'title', ['properties']], 'name'])
    const dynamic = setLayerCartography(before, 'top', fragment.styleLayers.map(layer => ({ ...layer,
      filter: ['==', ['get', ['concat', 'na', 'me']], 'name'],
    })))
    const dynamicHost = contextFor(dynamic)
    const rejected = new SetDatasetContentCommand('dynamic', 'Rename', 'data', { features: [] }, { features: [] }, { before: 'name', after: 'title' })
    expect(() => rejected.execute(dynamicHost.context)).toThrow('动态字段名')
    expect(dynamicHost.get()).toBe(dynamic)
  })

  it('keeps later binding entries when undoing a content snapshot edit', () => {
    const host = contextFor(projectFixture()), before = { project: host.get(), featuresByDataset: {} }
    const after = { ...before, project: setLegacyLayerStyle(before.project, 'top', createDefaultLayerStyle('point')) }
    const command = new ApplyProjectSnapshotEditCommand('snapshot', 'Edit', before, after)
    command.execute(host.context)
    const current = host.get()
    host.context.replaceProject({ ...current, layers: [...current.layers, { ...current.layers[0], id: 'later' }] })
    const later = getLayerCartography(host.get(), 'later')
    command.undo(host.context)
    expect(getLayerCartography(host.get(), 'later')).toEqual(later)
    expect(getLayerCartography(host.get(), 'top')).toEqual(getLayerCartography(before.project, 'top'))
  })

  it('coalesces repeated legacy style writes into one undo while restoring the first advanced fragment', () => {
    const host = contextFor(advancedProject()), original = host.get()
    const originalStyle = original.layers.find(layer => layer.id === 'top')!.style
    const history = new EditHistory()
    for (let index = 1; index <= 20; index++) {
      const current = host.get().layers.find(layer => layer.id === 'top')!.style
      const next = { mode: 'single' as const, symbol: { type: 'circle' as const, radius: index, fill: { r: 1, g: 2, b: 3, a: 1 } } }
      history.execute(new SetLayerStyleCommand(`style-${index}`, 'top', current, next, 'drag-width'), host.context)
    }
    expect(history.undoCount).toBe(1)
    expect((host.get().layers.find(layer => layer.id === 'top')!.style as ReturnType<typeof createDefaultLayerStyle> & { symbol: { radius: number } }).symbol.radius).toBe(20)
    expect(history.undo(host.context)?.label).toBe('编辑样式')
    expect(host.get().layers.find(layer => layer.id === 'top')!.style).toEqual(originalStyle)
    expect(getLayerCartography(host.get(), 'top')).toEqual(getLayerCartography(original, 'top'))
    expect(getLayerCartography(host.get(), 'bottom')).toEqual(getLayerCartography(original, 'bottom'))
    history.redo(host.context)
    expect((host.get().layers.find(layer => layer.id === 'top')!.style as { symbol: { radius: number } }).symbol.radius).toBe(20)
  })

  it('keeps different style gesture tokens as separate undo steps and leaves untagged commands unmerged', () => {
    const host = contextFor(projectFixture()), history = new EditHistory()
    const styleAt = (radius: number) => ({ mode: 'single' as const, symbol: { type: 'circle' as const, radius, fill: { r: 1, g: 2, b: 3, a: 1 } } })
    history.execute(new SetLayerStyleCommand('a1', 'top', styleAt(1), styleAt(2), 'gesture-a'), host.context)
    history.execute(new SetLayerStyleCommand('a2', 'top', styleAt(2), styleAt(3), 'gesture-a'), host.context)
    history.execute(new SetLayerStyleCommand('b1', 'top', styleAt(3), styleAt(4), 'gesture-b'), host.context)
    history.execute(new SetLayerStyleCommand('plain-1', 'top', styleAt(4), styleAt(5)), host.context)
    history.execute(new SetLayerStyleCommand('plain-2', 'top', styleAt(5), styleAt(6)), host.context)
    expect(history.undoCount).toBe(4)
    history.undo(host.context)
    expect((host.get().layers.find(layer => layer.id === 'top')!.style as { symbol: { radius: number } }).symbol.radius).toBe(5)
    history.undo(host.context)
    expect((host.get().layers.find(layer => layer.id === 'top')!.style as { symbol: { radius: number } }).symbol.radius).toBe(4)
    history.undo(host.context)
    expect((host.get().layers.find(layer => layer.id === 'top')!.style as { symbol: { radius: number } }).symbol.radius).toBe(3)
    history.undo(host.context)
    expect((host.get().layers.find(layer => layer.id === 'top')!.style as { symbol: { radius: number } }).symbol.radius).toBe(1)
  })

  it('coalesces standard fragment edits and restores exact AST without reverting another layer', () => {
    const host = contextFor(advancedProject()), original = host.get()
    const initial = getLayerCartography(original, 'top')!
    const history = new EditHistory()
    for (let index = 1; index <= 20; index++) {
      const current = getLayerCartography(host.get(), 'top')!
      const changed = setLayerCartography(host.get(), 'top', current.styleLayers.map(layer => ({
        ...layer,
        paint: { ...layer.paint, 'line-width': index }
      })))
      const after = getLayerCartography(changed, 'top')!
      history.execute(new SetLayerCartographyCommand(`cartography-${index}`, 'top', current, after, 'drag-radius'), host.context)
    }
    expect(history.undoCount).toBe(1)
    expect((getLayerCartography(host.get(), 'top')!.styleLayers[0]!.paint as Record<string, unknown>)['line-width']).toBe(20)

    const bottomBefore = getLayerCartography(host.get(), 'bottom')
    const changedBottom = setLegacyLayerStyle(host.get(), 'bottom', createDefaultLayerStyle('polygon'))
    host.context.replaceProject(changedBottom)
    history.undo(host.context)
    expect(getLayerCartography(host.get(), 'top')).toEqual(initial)
    expect(getLayerCartography(host.get(), 'bottom')).toEqual(getLayerCartography(changedBottom, 'bottom'))
    expect(getLayerCartography(host.get(), 'bottom')).not.toEqual(bottomBefore)
    history.redo(host.context)
    expect((getLayerCartography(host.get(), 'top')!.styleLayers[0]!.paint as Record<string, unknown>)['line-width']).toBe(20)

    const firstGesture = getLayerCartography(host.get(), 'top')!
    const firstGestureProject = setLayerCartography(host.get(), 'top', firstGesture.styleLayers.map(layer => ({
      ...layer, paint: { ...layer.paint, 'line-width': 21 }
    })))
    history.execute(new SetLayerCartographyCommand('cartography-a', 'top', firstGesture,
      getLayerCartography(firstGestureProject, 'top')!, 'gesture-a'), host.context)
    const secondUpdate = getLayerCartography(host.get(), 'top')!
    const secondUpdateProject = setLayerCartography(host.get(), 'top', secondUpdate.styleLayers.map(layer => ({
      ...layer, paint: { ...layer.paint, 'line-width': 22 }
    })))
    history.execute(new SetLayerCartographyCommand('cartography-b', 'top', secondUpdate,
      getLayerCartography(secondUpdateProject, 'top')!, 'gesture-a'), host.context)
    const thirdUpdate = getLayerCartography(host.get(), 'top')!
    const thirdUpdateProject = setLayerCartography(host.get(), 'top', thirdUpdate.styleLayers.map(layer => ({
      ...layer, paint: { ...layer.paint, 'line-width': 23 }
    })))
    history.execute(new SetLayerCartographyCommand('cartography-c', 'top', thirdUpdate,
      getLayerCartography(thirdUpdateProject, 'top')!, 'gesture-b'), host.context)
    expect(history.undoCount).toBe(3)
    history.undo(host.context)
    expect((getLayerCartography(host.get(), 'top')!.styleLayers[0]!.paint as Record<string, unknown>)['line-width']).toBe(22)
    history.undo(host.context)
    expect((getLayerCartography(host.get(), 'top')!.styleLayers[0]!.paint as Record<string, unknown>)['line-width']).toBe(20)
  })
})
