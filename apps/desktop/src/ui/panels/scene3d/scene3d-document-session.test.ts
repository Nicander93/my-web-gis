import { projectSession } from '@/project/project-session'
import { projectEdits } from '@/project/project-edits'
import { requireMapContent } from '@desktop-webgis/project'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultLayerStyle, createProject } from '@desktop-webgis/project'
import { createCesiumScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import type { SceneDocument } from '@desktop-webgis/scene-schema'
import type { CesiumDocumentRuntime, CesiumSceneRuntimeOptions } from '@desktop-webgis/cesium-scene-runtime'
import { useProjectStore } from '@/project/project.store'
import { createProjectSceneController } from '@/engine-host/project-scene-controller'
import { createSceneDocumentSession, type SceneDocumentState } from './scene3d-document-session'
import { updateScene } from './scene3d-commands'

const factory = vi.hoisted(() => vi.fn())
vi.mock('@desktop-webgis/cesium-scene-runtime', () => ({
  createCesiumDocumentRuntime: factory,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => { resolve = complete })
  return { promise, resolve }
}

function loaded(document: SceneDocument) {
  let current = structuredClone(document)
  const runtime = { layers: { getLayer: (id: string) => current.nodes.some(node => node.id === id) ? { state: 'ready' } : undefined },
    replaceScene: vi.fn(async () => {}), setCamera: vi.fn() }
  const target = { runtime, getDocument: () => structuredClone(current), issues: [],
    updateDocument: vi.fn(async (next: SceneDocument, signal?: AbortSignal, options?: { reload?: boolean }) => {
      signal?.throwIfAborted()
      if (options?.reload) await runtime.replaceScene()
      if (current.id !== next.id) runtime.setCamera()
      current = structuredClone(next)
    }), destroy: vi.fn() }
  return target
}
type Loaded = ReturnType<typeof loaded>
const cleanup: Array<() => void> = []
beforeEach(() => {
  factory.mockReset()
  const project = createProject('Scene host', 'scene3d'); project.content.scene = createCesiumScene()
  project.content.scene.assets.building = { type: 'glb', url: './building.glb' }
  project.content.scene.nodes = [{ type: 'model', id: 'a', name: 'Scene node', visible: true, asset: 'building', position: [0, 0, 0], transform: createTransform() }]
  projectSession.loadSnapshot({ project, featuresByDataset: {} })
})
afterEach(() => cleanup.splice(0).forEach(destroy => destroy()))

function attach(callbacks: Pick<CesiumSceneRuntimeOptions, 'onEdit' | 'onSelect'> = {}) {
  const controller = createProjectSceneController(), states: SceneDocumentState[] = []
  const session = createSceneDocumentSession({ controller, readSnapshot: () => projectSession.getSnapshot(), onState: state => states.push(state), ...callbacks })
  cleanup.push(() => { session.destroy(); controller.dispose() })
  return { session, states, controller }
}
async function expectReady(states: SceneDocumentState[]) { await vi.waitFor(() => expect(states.at(-1)?.status).toBe('ready')) }

describe('Desktop 3D scene document session', () => {
  it('maps picks and completed transforms to the scene host while undo reprojects the same runtime', async () => {
    let target!: Loaded, nativeOptions!: CesiumSceneRuntimeOptions
    factory.mockImplementation(async (options: CesiumSceneRuntimeOptions & { document: SceneDocument }) => {
      nativeOptions = options; target = loaded(options.document); return target
    })
    const selected = vi.fn()
    const { session, states } = attach({ onSelect: selected, onEdit: event => updateScene('Native transform', scene => {
      scene.nodes = scene.nodes.map(node => node.id === event.id && node.type === 'model' ? { ...node, transform: event.after } : node); return scene
    }) })
    await expectReady(states)
    expect(session.getRuntimeNodeId('a')).toBe('a')
    expect(states.at(-1)?.states.a.state).toBe('ready')
    nativeOptions.onSelect?.('a', { name: 'building' }, 'toggle')
    expect(selected).toHaveBeenCalledWith('a', { name: 'building' }, 'toggle')
    nativeOptions.onSelect?.('unknown'); expect(selected).toHaveBeenCalledTimes(1)
    nativeOptions.onSelect?.(null); expect(selected).toHaveBeenLastCalledWith(null, undefined, undefined)
    const before = createTransform(), after = { ...before, scale: 2 }
    nativeOptions.onEdit?.({ id: 'a', before, after })
    await vi.waitFor(() => expect(target.getDocument().nodes.find(node => node.id === 'a')).toMatchObject({ transform: { scale: 2 } }))
    expect(useProjectStore.getState().project.content.scene?.nodes[0]).toMatchObject({ id: 'a', transform: { scale: 2 } })
    expect(useProjectStore.getState().project.content).not.toHaveProperty('layers')
    expect(projectEdits.undo()).toBe(true)
    await vi.waitFor(() => expect(target.getDocument().nodes.find(node => node.id === 'a')).toMatchObject({ transform: { scale: 1 } }))
    expect(factory).toHaveBeenCalledOnce(); expect(target.destroy).not.toHaveBeenCalled()
  })

  it('aborts obsolete startup and destroys a late factory result without replacing the current runtime', async () => {
    const first = deferred<CesiumDocumentRuntime>(); let old!: Loaded, next!: Loaded
    factory.mockImplementationOnce((options: { document: SceneDocument }) => { old = loaded(options.document); return first.promise })
    factory.mockImplementationOnce(async (options: { document: SceneDocument }) => { next = loaded(options.document); return next })
    const selected = vi.fn(), { session, states } = attach({ onSelect: selected })
    updateScene('Rename during startup', scene => { scene.nodes[0].name = 'Latest'; return scene })
    expect(factory.mock.calls[0][0].signal.aborted).toBe(true)
    await expectReady(states)
    expect(session.getRuntime()).toBe(next.runtime)
    factory.mock.calls[0][0].onSelect('a-2')
    expect(selected).not.toHaveBeenCalled()
    first.resolve(old as unknown as CesiumDocumentRuntime)
    await vi.waitFor(() => expect(old.destroy).toHaveBeenCalledOnce())
    expect(session.getRuntime()).toBe(next.runtime)
    expect(next.getDocument().nodes.find(node => node.id === 'a')?.name).toBe('Latest')
  })

  it('retains installed content on failure and retries prepared replacement without adding history', async () => {
    let target!: Loaded
    factory.mockImplementation(async (options: { document: SceneDocument }) => { target = loaded(options.document); return target })
    const { session, states } = attach()
    await expectReady(states)
    const original = target.getDocument(), failure = new Error('Resource unavailable')
    target.updateDocument.mockRejectedValueOnce(failure)
    updateScene('Update URL', scene => { scene.assets.building.url = './new.glb'; return scene })
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(states.at(-1)).toMatchObject({ error: failure, states: { a: { state: 'error' } } })
    expect(target.getDocument()).toEqual(original)
    expect(session.getRuntime()).toBe(target.runtime); expect(target.destroy).not.toHaveBeenCalled()
    const content = projectSession.getSnapshot()
    target.runtime.replaceScene.mockRejectedValueOnce(failure)
    session.refresh()
    await vi.waitFor(() => expect(target.runtime.replaceScene).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(target.getDocument()).toEqual(original)
    session.refresh(); await expectReady(states)
    expect(target.getDocument().resources.building).toMatchObject({ url: './new.glb' })
    expect(target.runtime.replaceScene).toHaveBeenCalledTimes(2)
    expect(projectSession.getSnapshot()).toEqual(content)
    projectEdits.undo()
    await vi.waitFor(() => expect(target.getDocument().resources.building).toMatchObject({ url: './building.glb' }))
    expect(projectEdits.canUndo()).toBe(false)
  })

  it('can retry initial failure and resets the initial camera when another project is loaded', async () => {
    factory.mockRejectedValueOnce(new Error('Initial failure'))
    let target!: Loaded
    factory.mockImplementation(async (options: { document: SceneDocument }) => { target = loaded(options.document); return target })
    const { session, states } = attach()
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('error'))
    expect(session.getRuntime()).toBeUndefined()
    session.refresh(); await expectReady(states)
    const next = projectSession.getSnapshot(); next.project.metadata.id = 'another-project'
    projectSession.loadSnapshot(next)
    await vi.waitFor(() => expect(target.runtime.setCamera).toHaveBeenCalledOnce())
    expect(target.getDocument().id).toBe('another-project')
  })

  it('忽略s callbacks and disposes a late startup result after teardown', async () => {
    const pending = deferred<CesiumDocumentRuntime>(); let target!: Loaded
    factory.mockImplementation((options: { document: SceneDocument }) => { target = loaded(options.document); return pending.promise })
    const selected = vi.fn(), { session, states } = attach({ onSelect: selected })
    session.destroy(); session.destroy()
    const count = states.length
    pending.resolve(target as unknown as CesiumDocumentRuntime)
    await vi.waitFor(() => expect(target.destroy).toHaveBeenCalledOnce())
    factory.mock.calls[0][0].onSelect('a-2')
    expect(selected).not.toHaveBeenCalled(); expect(states).toHaveLength(count)
    updateScene('After teardown', scene => { scene.nodes[0].name = 'No native update'; return scene })
    expect(factory).toHaveBeenCalledOnce(); expect(target.updateDocument).not.toHaveBeenCalled()
  })

  it('reports the newest content without waiting for an obsolete native operation that 忽略s abort', async () => {
    let target!: Loaded
    factory.mockImplementation(async (options: { document: SceneDocument }) => { target = loaded(options.document); return target })
    const { states } = attach()
    await expectReady(states)
    const normal = target.updateDocument.getMockImplementation()!
    const obsolete = deferred<void>(); let signal!: AbortSignal
    target.updateDocument.mockImplementationOnce(async (_document, current) => { signal = current!; await obsolete.promise; signal.throwIfAborted() })
    updateScene('Old', scene => { scene.nodes[0].name = 'Old'; return scene })
    await vi.waitFor(() => expect(signal).toBeDefined())
    updateScene('Latest', scene => { scene.nodes[0].name = 'Latest'; return scene })
    await expectReady(states)
    expect(signal.aborted).toBe(true)
    expect(target.getDocument().nodes.find(node => node.id === 'a')?.name).toBe('Latest')
    obsolete.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(states.at(-1)?.status).toBe('ready')
    expect(target.updateDocument.getMockImplementation()).toBe(normal)
  })
})
