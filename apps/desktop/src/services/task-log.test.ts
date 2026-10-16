import { beforeEach, expect, it, vi } from 'vitest'
import { createProject } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { redactTaskText, useTaskLogStore } from '@/stores/task-log.store'
import { runLoggedTask } from './task-log'

beforeEach(() => {
  for (const entry of useTaskLogStore.getState().entries) useTaskLogStore.getState().finish(entry.id, 'cancelled')
  useTaskLogStore.setState({ entries: [] })
  useProjectStore.getState().loadSnapshot({ project: createProject(), featuresByDataset: {} })
})
it('logs completion and failure without changing project state or dirty flags', async () => {
  const before = useProjectStore.getState().getSnapshot(), dirty = useProjectStore.getState().dirty
  await expect(runLoggedTask('解析', async () => 3, undefined, value => ({ detail: `共 ${value} 条` }))).resolves.toBe(3)
  await expect(runLoggedTask('失败任务', async () => { throw new Error('读取失败') })).rejects.toThrow('读取失败')
  expect(useTaskLogStore.getState().entries.map(entry => [entry.status, entry.detail])).toEqual([['succeeded', '共 3 条'], ['failed', '读取失败']])
  expect(useProjectStore.getState().getSnapshot()).toEqual(before)
  expect(useProjectStore.getState().dirty).toBe(dirty)
})
it('links panel cancellation and project replacement to the actual operation', async () => {
  const operation = () => runLoggedTask('运行中', signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })))
  const first = operation()
  useTaskLogStore.getState().cancel(useTaskLogStore.getState().entries[0].id)
  await expect(first).rejects.toMatchObject({ name: 'AbortError' })
  const second = operation()
  useProjectStore.getState().loadSnapshot({ project: createProject(), featuresByDataset: {} })
  await expect(second).rejects.toMatchObject({ name: 'AbortError' })
  expect(useTaskLogStore.getState().entries.every(entry => entry.status === 'cancelled')).toBe(true)
})
it('clears only completed records in the requested project and preserves running callbacks', () => {
  const store = useTaskLogStore.getState(), cancel = vi.fn()
  const running = store.start(1, '运行中', cancel), completed = store.start(1, '完成'), other = store.start(2, '其他工程')
  store.finish(completed, 'succeeded'); store.finish(other, 'succeeded'); store.clear(1)
  expect(useTaskLogStore.getState().entries.map(entry => entry.id)).toEqual([running, other])
  store.cancel(running); store.finish(running, 'succeeded', '迟到结果')
  expect(cancel).toHaveBeenCalledOnce()
  expect(useTaskLogStore.getState().entries[0].status).toBe('cancelled')
})
it('bounds completed history even when many tasks complete together', () => {
  const store = useTaskLogStore.getState()
  const ids = Array.from({ length: 250 }, () => store.start(1, 'task'))
  expect(useTaskLogStore.getState().entries).toHaveLength(250)
  ids.forEach(id => store.finish(id, 'succeeded'))
  expect(useTaskLogStore.getState().entries).toHaveLength(200)
})
it('redacts URL credentials, sensitive query values and authorization headers', () => {
  const text = redactTaskText('https://user:password@example.com/data?token=secret&layer=roads Bearer abc Basic def')
  for (const secret of ['user:', 'password', 'secret', 'abc', 'def']) expect(text).not.toContain(secret)
  expect(text).toContain('layer=roads')
})
