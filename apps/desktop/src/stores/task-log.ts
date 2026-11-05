import { useProjectStore } from '@/project/project.store'
import { useTaskLogStore } from '@/stores/task-log.store'

/** 让调用方和日志面板里的取消操作指向同一个任务。 */
export async function runLoggedTask<T>(title: string, execute: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal,
  describe?: (result: T) => { failed?: boolean; detail: string }): Promise<T> {
  signal?.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const store = useTaskLogStore.getState()
  const epoch = useProjectStore.getState().projectEpoch
  const id = store.start(epoch, title, abort)
  const unsubscribe = useProjectStore.subscribe(state => { if (state.projectEpoch !== epoch) abort() })
  try {
    const result = await execute(controller.signal)
    controller.signal.throwIfAborted()
    const summary = describe?.(result)
    store.finish(id, summary?.failed ? 'failed' : 'succeeded', summary?.detail ?? '处理完成')
    return result
  } catch (reason) {
    store.finish(id, controller.signal.aborted ? 'cancelled' : 'failed', controller.signal.aborted ? '任务已取消' : reason instanceof Error ? reason.message : String(reason))
    throw reason
  } finally { unsubscribe(); signal?.removeEventListener('abort', abort) }
}
