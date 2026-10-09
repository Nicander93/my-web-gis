import { describe, expect, it, vi } from 'vitest'
import { parseSceneDocument, type SceneNode } from '@desktop-webgis/scene-schema'
import { SceneController } from './controller.js'
import { createSceneDocument } from './document.js'

function document() { return createSceneDocument({ id: 'scene', title: 'Scene', viewId: 'map', view: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 2 } }) }
const node: SceneNode = { type: 'vector', id: 'points', name: 'Points', resource: 'data', visible: true, style: { mode: 'single', symbol: { type: 'circle', radius: 4 } } }

describe('single scene content controller', () => {
  it('prepares replacement outside state and commits exactly once after successful validation', async () => {
    const controller = new SceneController(document()), observer = vi.fn()
    controller.subscribe(observer)
    const incoming = document(); incoming.title = 'Prepared'
    let complete!: () => void
    const gate = new Promise<void>(resolve => { complete = resolve })
    const pending = controller.prepareAndReplaceDocument(incoming, { prepare: async candidate => { await gate; return candidate } })
    expect(controller.getDocument().title).toBe('Scene')
    expect(observer).not.toHaveBeenCalled()
    complete(); await pending
    expect(controller.getDocument().title).toBe('Prepared')
    expect(observer).toHaveBeenCalledTimes(1)
    expect(incoming.title).toBe('Prepared')
    await expect(controller.prepareAndReplaceDocument(incoming, { prepare: async () => { throw new Error('missing resource') } })).rejects.toThrow('missing resource')
    expect(observer).toHaveBeenCalledTimes(1)
  })
  it('rejects late prepared documents after supersession, content edits, cancellation and disposal', async () => {
    const controller = new SceneController(document())
    const incoming = document(); incoming.title = 'Old load'
    let complete!: (value: ReturnType<typeof document>) => void
    const first = controller.prepareAndReplaceDocument(incoming, { prepare: () => new Promise(resolve => { complete = resolve }) })
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    const newer = document(); newer.title = 'New load'
    await controller.prepareAndReplaceDocument(newer, { prepare: async candidate => candidate })
    complete(incoming); await rejected
    expect(controller.getDocument().title).toBe('New load')
    for (const action of ['edit', 'cancel', 'dispose']) {
      const pending = controller.prepareAndReplaceDocument(incoming, { prepare: () => new Promise(resolve => { complete = resolve }) })
      const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      if (action === 'edit') controller.transaction('Edit', draft => { draft.title = 'Local edit' })
      else if (action === 'cancel') controller.cancelPreparation()
      else controller.dispose()
      complete(incoming); await rejection
      expect(controller.getDocument().title).toBe('Local edit')
    }
  })
  it('adds tilesets through the same document and explicitly shares matching resources', () => {
    const controller = new SceneController(document()), observer = vi.fn()
    controller.subscribe(observer)
    controller.addTileset({ id: 'city-a', name: 'A', resourceId: 'city', url: './tileset.json' })
    controller.addTileset({ id: 'city-b', name: 'B', resourceId: 'city', url: './tileset.json' })
    controller.setTransform('city-a', { translation: [1, 2, 3], rotation: [10, 20, 30], scale: 2 })
    const exported = parseSceneDocument(controller.exportJson())
    expect(Object.keys(exported.resources)).toEqual(['city'])
    expect(exported.nodes[0]).toMatchObject({ resource: 'city', transform: { translation: [1, 2, 3], scale: 2 } })
    expect(observer).toHaveBeenCalledTimes(3)
    expect(() => controller.addTileset({ id: 'city-c', name: 'C', resourceId: 'city', url: './different.json' })).toThrow('different definition')
    expect(controller.getDocument()).toEqual(exported)
    controller.addTileset({ id: 'proto', name: 'Prototype key', resourceId: '__proto__', url: './proto.json' })
    expect(Object.hasOwn(parseSceneDocument(controller.exportJson()).resources, '__proto__')).toBe(true)
  })
  it('commits resources and referencing nodes together and exports all API content', () => {
    const initial = document(), controller = new SceneController(initial), observer = vi.fn()
    controller.subscribe(observer)
    controller.transaction('Add data and display', draft => {
      draft.resources.data = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
      draft.nodes.push(node)
    })
    expect(observer).toHaveBeenCalledTimes(1)
    expect(observer.mock.calls[0][0].before).toEqual(initial)
    expect(parseSceneDocument(controller.exportJson()).nodes).toEqual([node])
    expect(initial.nodes).toEqual([])
    controller.setNodeVisible('points', false)
    controller.setNodeOpacity('points', 0.5)
    expect(parseSceneDocument(controller.exportJson()).nodes[0]).toMatchObject({ visible: false, opacity: 0.5 })
  })
  it('has equivalent declarative and convenience updates, with isolated drafts and observers', () => {
    const a = new SceneController(document()), b = new SceneController(document())
    a.addResource('data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }); a.addNode(node)
    b.replaceDocument(a.getDocument())
    a.setNodeVisible('points', false)
    b.replaceNode('points', { ...node, visible: false })
    expect(a.getDocument()).toEqual(b.getDocument())
    a.subscribe(change => { change.after.nodes.length = 0 })
    a.setNodeLocked('points', true)
    const external = a.getDocument(); external.nodes.length = 0
    expect(a.getDocument().nodes).toHaveLength(1)
  })
  it('rejects invalid or failed transactions without changing content or emitting history', () => {
    const controller = new SceneController(document()), observer = vi.fn()
    controller.subscribe(observer)
    expect(() => controller.transaction('Invalid', draft => { draft.nodes.push(node) })).toThrow()
    expect(() => controller.transaction('Failure', draft => { draft.title = 'Changed'; throw new Error('Stop') })).toThrow('Stop')
    expect(controller.getDocument()).toEqual(document())
    expect(observer).not.toHaveBeenCalled()
    expect(() => controller.transaction('Nested', () => { controller.replaceDocument(document()) })).toThrow('nested')
    expect(() => controller.transaction('Async', async draft => { await Promise.resolve(); draft.title = 'Late' })).toThrow('synchronous')
    expect(controller.getDocument()).toEqual(document())
  })
  it('does not dirty content for no-op writes, and reports observer failures after commit', () => {
    const controller = new SceneController(document()), observer = vi.fn()
    const unsubscribe = controller.subscribe(observer)
    controller.replaceDocument(document())
    expect(observer).not.toHaveBeenCalled()
    controller.subscribe(() => { throw new Error('Observer failed') })
    const result = controller.transaction('Rename', draft => { draft.title = 'Renamed' })
    expect(result.document.title).toBe('Renamed')
    expect(result.observerErrors).toHaveLength(1)
    unsubscribe(); controller.dispose(); controller.dispose()
    expect(() => controller.transaction('After disposal', () => {})).toThrow('disposed')
  })
})
