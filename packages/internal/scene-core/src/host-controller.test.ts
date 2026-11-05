import { describe, expect, it, vi } from 'vitest'
import type { SceneDocument } from '@desktop-webgis/scene-schema'
import { createHostedSceneController, type SceneChange } from './controller.js'
import { createSceneDocument } from './document.js'
import { bindSceneRuntime } from './runtime-binding.js'

function host() {
  let document = createSceneDocument({ id: 'host', title: 'Host', viewId: 'map', view: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 2 } })
  const observers = new Set<(change: SceneChange) => void>(), history: SceneDocument[] = []
  const commit = vi.fn((next: SceneDocument, label: string) => {
    const before = structuredClone(document)
    history.push(before); document = structuredClone(next)
    observers.forEach(observer => observer({ label, before, after: structuredClone(document) }))
  })
  return {
    read: () => structuredClone(document), commit,
    subscribe(observer: (change: SceneChange) => void) { observers.add(observer); return () => { observers.delete(observer) } },
    undo() { const previous = history.pop()!; const before = document; document = previous; observers.forEach(observer => observer({ label: 'Undo', before, after: document })) },
    get observerCount() { return observers.size }
  }
}

describe('host-owned scene content', () => {
  it('projects host commands and undo through the same runtime binding', async () => {
    const storage = host(), controller = createHostedSceneController(storage)
    const target = { updateDocument: vi.fn(async (_document: SceneDocument) => {}) }
    const binding = bindSceneRuntime(controller, target)
    expect((await binding.settled()).status).toBe('ready')
    controller.addTileset({ id: 'blocks', name: 'Blocks', url: './tileset.json' })
    expect((await binding.settled()).status).toBe('ready')
    expect(target.updateDocument.mock.calls.at(-1)?.[0]).toEqual(storage.read())
    expect(storage.read().nodes).toHaveLength(1)
    storage.undo()
    expect((await binding.settled()).status).toBe('ready')
    expect(target.updateDocument.mock.calls.at(-1)?.[0].nodes).toEqual([])
    binding.dispose(); controller.dispose()
  })
  it('queues external host changes during observers without corrupting change snapshots', () => {
    const storage = host(), controller = createHostedSceneController(storage), received: SceneChange[] = []
    controller.subscribe(change => {
      if (change.label !== 'API rename') return
      const next = storage.read(); next.title = 'External follow-up'; storage.commit(next, 'External rename')
    })
    controller.subscribe(change => { received.push(change) })
    controller.transaction('API rename', draft => { draft.title = 'API title' })
    expect(received.map(change => [change.label, change.before.title, change.after.title])).toEqual([
      ['API rename', 'Host', 'API title'], ['External rename', 'API title', 'External follow-up']
    ])
    expect(controller.getDocument().title).toBe('External follow-up')
    controller.dispose()
  })
  it('reads live content and routes API writes through host history with one notification', () => {
    const storage = host(), controller = createHostedSceneController(storage), observer = vi.fn()
    controller.subscribe(observer)
    controller.addTileset({ id: 'blocks', name: 'Blocks', url: './tileset.json' })
    expect(storage.commit).toHaveBeenCalledOnce()
    expect(observer).toHaveBeenCalledOnce()
    expect(JSON.parse(controller.exportJson())).toEqual(storage.read())
    const returned = controller.getDocument(); returned.nodes.length = 0
    expect(storage.read().nodes).toHaveLength(1)
    storage.undo()
    expect(controller.getDocument().nodes).toEqual([])
    expect(observer).toHaveBeenCalledTimes(2)
    const next = storage.read(); next.title = 'External command'
    storage.commit(next, 'Rename')
    expect(controller.getDocument().title).toBe('External command')
    expect(observer).toHaveBeenCalledTimes(3)
    controller.dispose(); controller.dispose()
    expect(storage.observerCount).toBe(0)
    const outside = storage.read(); outside.title = 'After disposal'
    storage.commit(outside, 'Rename')
    expect(observer).toHaveBeenCalledTimes(3)
  })
  it('keeps host content and observers untouched when validation or the host commit fails', () => {
    const storage = host(), controller = createHostedSceneController(storage), observer = vi.fn()
    controller.subscribe(observer)
    const before = storage.read()
    expect(() => controller.transaction('Invalid', draft => { draft.activeView = 'missing' })).toThrow()
    expect(storage.commit).not.toHaveBeenCalled()
    storage.commit.mockImplementationOnce(() => { throw new Error('Draft guard') })
    expect(() => controller.transaction('Rename', draft => { draft.title = 'Blocked' })).toThrow('Draft guard')
    expect(storage.read()).toEqual(before)
    expect(observer).not.toHaveBeenCalled()
    controller.dispose()
  })
  it('invalidates prepared replacements after external host edits', async () => {
    const storage = host(), controller = createHostedSceneController(storage)
    let complete!: (document: SceneDocument) => void
    const incoming = storage.read(); incoming.title = 'Late'
    const pending = controller.prepareAndReplaceDocument(incoming, { prepare: () => new Promise(resolve => { complete = resolve }) })
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const next = storage.read(); next.title = 'External'
    storage.commit(next, 'External edit')
    complete(incoming); await rejection
    expect(controller.getDocument().title).toBe('External')
    controller.dispose()
  })
  it('rejects a stale transaction draft if its callback edits the host directly', () => {
    const storage = host(), controller = createHostedSceneController(storage)
    expect(() => controller.transaction('Stale', draft => {
      draft.title = 'Stale draft'
      const external = storage.read(); external.title = 'Direct host edit'; storage.commit(external, 'External')
    })).toThrow('Host content changed')
    expect(controller.getDocument().title).toBe('Direct host edit')
    controller.dispose()
  })
})
