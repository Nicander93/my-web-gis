import { createCesiumDocumentRuntime, type CesiumDocumentRuntime, type CityRuntimeOptions, type CitySceneRuntime } from '@desktop-webgis/cesium-scene-runtime'
import { bindSceneRuntime, type SceneController, type SceneRuntimeBinding } from '@desktop-webgis/scene-core'
import type { ProjectSnapshot } from '@desktop-webgis/gis-core'
import { createProjectSceneProjection, type ProjectSceneProjection } from '../scene/project-scene-document'

export interface CityDocumentState {
  status: 'loading' | 'ready' | 'error'
  runtime?: CitySceneRuntime
  states: Record<string, { state: 'loading' | 'ready' | 'error'; error?: string }>
  error?: unknown
}

interface CityDocumentSessionOptions extends Omit<CityRuntimeOptions, 'scene' | 'onLayerState'> {
  controller: SceneController
  readSnapshot(): ProjectSnapshot
  onState(state: CityDocumentState): void
}

/** Projects the authoritative Project into Cesium and translates native callbacks back to host IDs. */
export function createCityDocumentSession(options: CityDocumentSessionOptions) {
  const { controller, readSnapshot, onState, onSelect, onEdit, ...nativeOptions } = options
  let requested = createProjectSceneProjection(readSnapshot())
  let applied: ProjectSceneProjection | undefined
  let mounted: CesiumDocumentRuntime | undefined, binding: SceneRuntimeBinding | undefined
  let startup: AbortController | undefined
  let generation = 0, observation = 0, destroyed = false, reload = false

  function publish(status: CityDocumentState['status'], error?: unknown): void {
    if (destroyed) return
    const states: CityDocumentState['states'] = {}
    for (const [hostId, documentId] of requested.cityNodeIds) {
      const definition = requested.document.nodes.find(node => node.id === documentId)
      if (definition?.type === 'group') continue
      const previousId = applied?.cityNodeIds.get(hostId)
      const previous = applied?.document.nodes.find(node => node.id === previousId)
      const unchanged = JSON.stringify(definition) === JSON.stringify(previous) &&
        (!definition || !('resource' in definition) || JSON.stringify(requested.document.resources[definition.resource]) === JSON.stringify(applied?.document.resources[definition.resource]))
      const native = mounted?.runtime.layers.getLayer(documentId)
      const state = status === 'ready' || unchanged ? native?.state === 'ready' ? 'ready' : 'loading' : status
      states[hostId] = { state, ...(state === 'error' ? { error: '资源加载失败。请检查地址或重试；已显示的场景保留。' } : {}) }
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
          const hostId = id === null ? null : applied.hostCityNodeIds.get(id)
          if (hostId !== undefined) onSelect?.(hostId, properties, mode)
        },
        onEdit(event) {
          const hostId = applied?.hostCityNodeIds.get(event.id)
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

  // Register before binding: identity mappings must be captured for the same content revision.
  const unsubscribe = controller.subscribe(() => {
    requested = createProjectSceneProjection(readSnapshot())
    if (!mounted) { void start(); return }
    publish('loading')
    queueMicrotask(() => { if (!destroyed) void observe() })
  })
  void start()
  return {
    getRuntime: () => mounted?.runtime,
    getRuntimeNodeId: (hostId: string) => applied?.cityNodeIds.get(hostId),
    getHostNodeId: (documentId: string) => applied?.hostCityNodeIds.get(documentId),
    /** Retry through prepared replacement; the previously visible layers remain until it succeeds. */
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
