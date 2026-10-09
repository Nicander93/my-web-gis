import { describe, expect, it, vi } from 'vitest'
import { SceneController } from './controller.js'
import { createSceneDocument } from './document.js'
import { bindSceneRuntime } from './runtime-binding.js'

function controller() {
  return new SceneController(createSceneDocument({ id: 'scene', title: 'Scene', viewId: 'map', view: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 2 } }))
}

describe('controller runtime projection binding', () => {
  it('projects the initial document and commits through the same API without exposing mutable content', async () => {
    const content = controller(), updateDocument = vi.fn(document => { document.title = 'Native mutation' })
    const binding = bindSceneRuntime(content, { updateDocument })
    expect((await binding.settled()).status).toBe('ready')
    content.transaction('Rename', draft => { draft.title = 'Renamed' })
    expect(await binding.settled()).toEqual({ revision: 2, appliedRevision: 2, status: 'ready' })
    expect(content.getDocument().title).toBe('Renamed')
    expect(JSON.parse(content.exportJson()).title).toBe('Renamed')
    expect(updateDocument).toHaveBeenCalledTimes(2)
    binding.dispose()
  })

  it('does not let obsolete failures replace the status of a newer projection', async () => {
    const content = controller()
    let reject!: (error: Error) => void
    const updateDocument = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail })).mockResolvedValue(undefined)
    const binding = bindSceneRuntime(content, { updateDocument })
    await Promise.resolve()
    const waitingBeforeReplacement = binding.settled()
    content.transaction('Rename', draft => { draft.title = 'Current' })
    expect((await waitingBeforeReplacement).revision).toBe(2)
    expect(updateDocument.mock.calls[0][1].aborted).toBe(true)
    reject(new Error('Obsolete failure'))
    await Promise.resolve(); await Promise.resolve()
    expect(binding.getState()).toEqual({ revision: 2, appliedRevision: 2, status: 'ready' })
    binding.dispose()
  })

  it('reports render failure without rolling back committed content and supports an explicit retry', async () => {
    const content = controller(), failure = new Error('Unavailable')
    const updateDocument = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    const binding = bindSceneRuntime(content, { updateDocument })
    expect(await binding.settled()).toEqual({ revision: 1, appliedRevision: 0, status: 'error', error: failure })
    expect(content.getDocument().title).toBe('Scene')
    binding.refresh()
    expect(await binding.settled()).toEqual({ revision: 2, appliedRevision: 2, status: 'ready' })
    binding.dispose()
  })

  it('coalesces obsolete requests before projection starts and unsubscribes without disposing its owners', async () => {
    const content = controller(), updateDocument = vi.fn()
    const binding = bindSceneRuntime(content, { updateDocument })
    content.transaction('Rename', draft => { draft.title = 'Latest' })
    await binding.settled()
    expect(updateDocument).toHaveBeenCalledTimes(1)
    expect(updateDocument.mock.calls[0][0].title).toBe('Latest')
    binding.dispose(); binding.dispose()
    content.transaction('Rename again', draft => { draft.title = 'Still usable' })
    binding.refresh()
    expect((await binding.settled()).status).toBe('disposed')
    expect(updateDocument).toHaveBeenCalledTimes(1)
  })

  it('retains the applied revision when a committed edit cannot be rendered', async () => {
    const content = controller(), failure = new Error('Render failed')
    const updateDocument = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    const binding = bindSceneRuntime(content, { updateDocument })
    await binding.settled()
    content.transaction('Committed edit', draft => { draft.title = 'Authoritative edit' })
    expect(await binding.settled()).toEqual({ revision: 2, appliedRevision: 1, status: 'error', error: failure })
    expect(content.getDocument().title).toBe('Authoritative edit')
    binding.refresh()
    expect((await binding.settled()).appliedRevision).toBe(3)
    binding.dispose()
  })

  it('releases pending waiters on disposal even when a transport ignores cancellation', async () => {
    const content = controller()
    const binding = bindSceneRuntime(content, { updateDocument: () => new Promise<void>(() => {}) })
    await Promise.resolve()
    const waiting = binding.settled()
    binding.dispose()
    expect((await waiting).status).toBe('disposed')
  })
})
