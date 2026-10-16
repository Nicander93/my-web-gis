import { useEffect, useRef } from 'react'
import type { CesiumSceneNode } from '@desktop-webgis/cesium-scene-schema'
import type { ResourceStates } from '@/services/diagnostics'
import { useTaskLogStore } from '@/stores/task-log.store'

/** Record state transitions, rather than every runtime refresh or render. */
export function useSceneTaskLog(states: ResourceStates, nodes: CesiumSceneNode[], epoch: number) {
  const tracked = useRef(new Map<string, { taskId: string; state: string }>())
  useEffect(() => {
    const entries = tracked.current
    return () => {
      for (const entry of entries.values()) if (entry.state === 'loading') useTaskLogStore.getState().finish(entry.taskId, 'cancelled', '场景会话已结束')
      entries.clear()
    }
  }, [epoch])
  useEffect(() => {
    const logs = useTaskLogStore.getState()
    for (const [id, entry] of tracked.current) {
      if (!states[id] || !nodes.some(node => node.id === id)) {
        if (entry.state === 'loading') logs.finish(entry.taskId, 'cancelled', '对象已移除')
        tracked.current.delete(id)
      }
    }
    for (const [id, state] of Object.entries(states)) {
      const node = nodes.find(node => node.id === id && 'asset' in node)
      if (!node) continue
      let entry = tracked.current.get(id)
      if (entry?.state === state.state) continue
      if (!entry || entry.state !== 'loading') {
        entry = { taskId: logs.start(epoch, `加载资源：${node.name}`), state: 'loading' }
        tracked.current.set(id, entry)
      }
      if (state.state !== 'loading') logs.finish(entry.taskId, state.state === 'error' ? 'failed' : 'succeeded', state.error ?? '资源加载完成')
      entry.state = state.state
    }
  }, [states, nodes, epoch])
}
