import { create } from 'zustand'

export type TaskStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'
export interface TaskEntry {
  id: string
  projectEpoch: number
  title: string
  status: TaskStatus
  startedAt: number
  finishedAt?: number
  detail: string
}
interface TaskLogState {
  entries: TaskEntry[]
  start(projectEpoch: number, title: string, cancel?: () => void): string
  finish(id: string, status: Exclude<TaskStatus, 'running'>, detail?: string): void
  cancel(id: string): void
  clear(projectEpoch: number): void
}
const cancellations = new Map<string, () => void>()
function trim(entries: TaskEntry[]): TaskEntry[] {
  const completed = new Set(entries.filter(entry => entry.status !== 'running').slice(-200).map(entry => entry.id))
  return entries.filter(entry => entry.status === 'running' || completed.has(entry.id))
}

/** Keep copied errors useful without exposing common credential forms. */
export function redactTaskText(text: string): string {
  return text.replace(/(Bearer|Basic)\s+[^\s"']+/gi, '$1 [已隐藏]')
    .replace(/https?:\/\/[^\s<>"']+/gi, value => {
      try {
        const url = new URL(value)
        url.username = ''; url.password = ''
        for (const key of [...url.searchParams.keys()]) if (/token|key|secret|password|signature|credential|auth/i.test(key)) url.searchParams.set(key, '[已隐藏]')
        return url.toString()
      } catch { return value }
    }).slice(0, 12000)
}

/** Session-only operational records never enter project snapshots or Undo history. */
export const useTaskLogStore = create<TaskLogState>((set, get) => ({
  entries: [],
  start(projectEpoch, title, cancel) {
    const id = crypto.randomUUID()
    if (cancel) cancellations.set(id, cancel)
    set(state => ({ entries: trim([...state.entries,
      { id, projectEpoch, title: redactTaskText(title), status: 'running', startedAt: Date.now(), detail: '' }]) }))
    return id
  },
  finish(id, status, detail = '') {
    cancellations.delete(id)
    set(state => ({ entries: trim(state.entries.map(entry => entry.id === id && entry.status === 'running' ? { ...entry, status, detail: redactTaskText(detail), finishedAt: Date.now() } : entry)) }))
  },
  cancel(id) {
    if (!get().entries.some(entry => entry.id === id && entry.status === 'running')) return
    const cancel = cancellations.get(id)
    if (cancel) { cancel(); get().finish(id, 'cancelled', '用户取消了任务') }
  },
  clear(projectEpoch) { set(state => ({ entries: state.entries.filter(entry => entry.projectEpoch !== projectEpoch || entry.status === 'running') })) }
}))

export function canCancelTask(id: string): boolean { return cancellations.has(id) }
