import { createCesiumDocumentRuntime, type CesiumDocumentRuntime, type CesiumSceneRuntimeOptions, type CesiumSceneRuntime, type ResourceReferenceResolver } from '@desktop-webgis/cesium-scene-runtime'
import { bindSceneRuntime, type SceneController, type SceneRuntimeBinding } from '@desktop-webgis/scene-core'
import type { ProjectSnapshot } from '@desktop-webgis/project'
import { createProjectSceneProjection, type ProjectSceneProjection } from '@/io/project-scene-document'

export interface SceneDocumentState {
  status: 'loading' | 'ready' | 'error'
  runtime?: CesiumSceneRuntime
  states: Record<string, { state: 'loading' | 'ready' | 'error'; error?: string }>
  error?: unknown
}

interface SceneDocumentSessionOptions extends Omit<CesiumSceneRuntimeOptions, 'scene' | 'onLayerState'> {
  resolveReference?: ResourceReferenceResolver
  controller: SceneController
  readSnapshot(): ProjectSnapshot
  onState(state: SceneDocumentState): void
}

/** 把权威的 Project 投影到 Cesium，并把原生回调翻译回宿主 ID。 */
export function createSceneDocumentSession(options: SceneDocumentSessionOptions) {
  const { controller, readSnapshot, onState, onSelect, onEdit, ...nativeOptions } = options
  let requested = createProjectSceneProjection(readSnapshot())
  let applied: ProjectSceneProjection | undefined
  let mounted: CesiumDocumentRuntime | undefined, binding: SceneRuntimeBinding | undefined
  let startup: AbortController | undefined
  let generation = 0, observation = 0, destroyed = false, reload = false

  function publish(status: SceneDocumentState['status'], error?: unknown): void {
    if (destroyed) return
    const states: SceneDocumentState['states'] = {}
    for (const [hostId, documentId] of requested.scene3dNodeIds) {
      const definition = requested.document.nodes.find(node => node.id === documentId)
      if (definition?.type === 'group') continue
      const previousId = applied?.scene3dNodeIds.get(hostId)
      const previous = applied?.document.nodes.find(node => node.id === previousId)
      const unchanged = JSON.stringify(definition) === JSON.stringify(previous) &&
        (!definition || !('resource' in definition) || JSON.stringify(requested.document.resources[definition.resource]) === JSON.stringify(applied?.document.resources[definition.resource]))
      const native = mounted?.runtime.layers.getLayer(documentId)
      const state = status === 'ready' || unchanged ? native?.state === 'ready' ? 'ready' : 'loading' : status
      states[hostId] = { state, ...(state === 'error' ? { error: error instanceof Error ? error.message : typeof error === 'string' ? error : '资源加载失败。请检查地址或重试；已显示的场景保留。' } : {}) }
    }
    onState({ status, runtime: mounted?.runtime, states, ...(error === undefined ? {} : { error }) })
  }

  async function observe(): Promise<void> {
    const current = ++observation
    const state = await binding?.settled()
    if (destroyed || current !== observation || !state || state.status === 'disposed') return
    if (state.status === 'error') publish('error', state.error)
    else if (state.status === 'ready') publish('ready')
  }

  async function start(): Promise<void> {
    startup?.abort()
    const operation = new AbortController(), current = ++generation, projection = requested
    startup = operation
    publish('loading')
    try {
      const loaded = await createCesiumDocumentRuntime({ ...nativeOptions, document: projection.document, viewId: 'city', signal: operation.signal,
        onSelect(id, properties, mode) {
          if (destroyed || current !== generation || !applied) return
          const hostId = id === null ? null : applied.hostSceneNodeIds.get(id)
          if (hostId !== undefined) onSelect?.(hostId, properties, mode)
        },
        onEdit(event) {
          const hostId = applied?.hostSceneNodeIds.get(event.id)
          if (!destroyed && current === generation && hostId !== undefined) onEdit?.({ ...event, id: hostId })
        }
      })
      if (destroyed || current !== generation || operation.signal.aborted) { loaded.destroy(); return }
      mounted = loaded; applied = projection; startup = undefined
      binding = bindSceneRuntime(controller, {
        async updateDocument(document, signal) {
          signal.throwIfAborted()
          const next = requested, forceReload = reload
          reload = false
          await loaded.updateDocument(document, signal, { reload: forceReload })
          signal.throwIfAborted()
          applied = next
        }
      })
      await observe()
    } catch (error) {
      if (!destroyed && current === generation && !operation.signal.aborted) { startup = undefined; publish('error', error) }
    }
  }

  // 先注册再绑定：身份映射必须针对同一份内容修订来捕获。
  const unsubscribe = controller.subscribe(() => {
    requested = createProjectSceneProjection(readSnapshot())
    if (!mounted) { void start(); return }
    publish('loading')
    queueMicrotask(() => { if (!destroyed) void observe() })
  })
  void start()
  return {
    getRuntime: () => mounted?.runtime,
    getRuntimeNodeId: (hostId: string) => applied?.scene3dNodeIds.get(hostId),
    getHostNodeId: (documentId: string) => applied?.hostSceneNodeIds.get(documentId),
    /** 通过准备好的替换重试；成功之前，之前可见的图层继续保持显示。 */
    refresh() {
      if (destroyed) return
      requested = createProjectSceneProjection(readSnapshot())
      if (!binding) { void start(); return }
      reload = true; publish('loading'); binding.refresh(); void observe()
    },
    destroy() {
      if (destroyed) return
      destroyed = true; generation++; observation++
      unsubscribe(); startup?.abort(); binding?.dispose(); mounted?.destroy()
      mounted = undefined; applied = undefined
    }
  }
}
