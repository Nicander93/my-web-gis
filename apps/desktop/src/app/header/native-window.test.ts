import { expect, it, vi } from 'vitest'
import { allowWindowClose, createCloseSession, subscribeMaximized, type WindowCloseHost } from './native-window'
import { hasPendingPropertyEdits, registerPendingPropertyEdit } from '@/services/pending-property-edits'

function host(overrides: Partial<WindowCloseHost> = {}): WindowCloseHost {
  return {
    projectEpoch: () => 1,
    contentVersion: () => 1,
    hasDirtyDrafts: () => false,
    resolveDrafts: async () => true,
    isProjectDirty: () => false,
    confirmUnsaved: async () => 'cancel',
    saveProject: async () => true,
    discardRecovery: async () => undefined,
    ...overrides
  }
}

it('closes immediately when the project and drafts are clean', async () => {
  const confirmUnsaved = vi.fn(async () => 'save' as const)
  expect(await allowWindowClose(host({ confirmUnsaved }))).toBe(true)
  expect(confirmUnsaved).not.toHaveBeenCalled()
})

it('asks about drafts before the unsaved-project prompt', async () => {
  const resolveDrafts = vi.fn(async () => false)
  const confirmUnsaved = vi.fn(async () => 'save' as const)
  expect(await allowWindowClose(host({
    hasDirtyDrafts: () => true,
    resolveDrafts,
    isProjectDirty: () => true,
    confirmUnsaved
  }))).toBe(false)
  expect(resolveDrafts).toHaveBeenCalled()
  expect(confirmUnsaved).not.toHaveBeenCalled()
})

it('stays open when the project is replaced while drafts are decided', async () => {
  let epoch = 1
  expect(await allowWindowClose(host({
    projectEpoch: () => epoch,
    hasDirtyDrafts: () => true,
    resolveDrafts: async () => { epoch = 2; return true },
    isProjectDirty: () => true
  }))).toBe(false)
})

it('does not save again when the prompt already persisted the project', async () => {
  let dirty = true
  const saveProject = vi.fn(async () => true)
  expect(await allowWindowClose(host({
    isProjectDirty: () => dirty,
    confirmUnsaved: async () => { dirty = false; return 'save' },
    saveProject
  }))).toBe(true)
  expect(saveProject).not.toHaveBeenCalled()
})

it('saves then re-checks dirty and epoch before allowing close', async () => {
  let dirty = true
  const saveProject = vi.fn(async () => { dirty = false; return true })
  expect(await allowWindowClose(host({
    isProjectDirty: () => dirty,
    confirmUnsaved: async () => 'save',
    saveProject
  }))).toBe(true)
  expect(saveProject).toHaveBeenCalled()

  expect(await allowWindowClose(host({
    isProjectDirty: () => true,
    confirmUnsaved: async () => 'save',
    saveProject: async () => false
  }))).toBe(false)

  dirty = true
  expect(await allowWindowClose(host({
    isProjectDirty: () => dirty,
    confirmUnsaved: async () => 'save',
    saveProject: async () => { dirty = true; return true }
  }))).toBe(false)
})

it('discards recovery on an explicit abandon and cancels without side effects', async () => {
  const discardRecovery = vi.fn(async () => undefined)
  const saveProject = vi.fn(async () => true)
  expect(await allowWindowClose(host({
    isProjectDirty: () => true,
    confirmUnsaved: async () => 'discard',
    discardRecovery,
    saveProject
  }))).toBe(true)
  expect(discardRecovery).toHaveBeenCalled()
  expect(saveProject).not.toHaveBeenCalled()

  expect(await allowWindowClose(host({
    isProjectDirty: () => true,
    confirmUnsaved: async () => 'cancel',
    discardRecovery,
    saveProject
  }))).toBe(false)
  expect(saveProject).not.toHaveBeenCalled()
})

it('reuses one in-flight close decision for overlapping requests', async () => {
  let finish!: (value: boolean) => void
  const decide = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  const session = createCloseSession(decide)
  const first = session.request()
  const second = session.request()
  expect(decide).toHaveBeenCalledTimes(1)
  finish(false)
  expect(await first).toBe(false)
  expect(await second).toBe(false)
  const third = session.request()
  finish(true)
  expect(await third).toBe(true)
  expect(decide).toHaveBeenCalledTimes(2)
})

it('rejects closure if a reported successful draft resolution still leaves edits', async () => {
  const confirmUnsaved = vi.fn(async () => 'discard' as const)
  expect(await allowWindowClose(host({ hasDirtyDrafts: () => true, confirmUnsaved }))).toBe(false)
  expect(confirmUnsaved).not.toHaveBeenCalled()
})

it('allows closure once drafts are actually applied and the resulting project is saved', async () => {
  let drafts = true, dirty = false
  expect(await allowWindowClose(host({
    hasDirtyDrafts: () => drafts,
    resolveDrafts: async () => { drafts = false; dirty = true; return true },
    isProjectDirty: () => dirty,
    confirmUnsaved: async () => 'save',
    saveProject: async () => { dirty = false; return true }
  }))).toBe(true)
})

it('retains a different project opened during asynchronous recovery deletion', async () => {
  let epoch = 1
  expect(await allowWindowClose(host({
    projectEpoch: () => epoch, isProjectDirty: () => true,
    confirmUnsaved: async () => 'discard',
    discardRecovery: async () => { epoch = 2 }
  }))).toBe(false)
})

it('retains edits made while the discard confirmation is open', async () => {
  let version = 1
  const discardRecovery = vi.fn(async () => {})
  expect(await allowWindowClose(host({
    contentVersion: () => version, isProjectDirty: () => true,
    confirmUnsaved: async () => { version++; return 'discard' }, discardRecovery
  }))).toBe(false)
  expect(discardRecovery).not.toHaveBeenCalled()
})

it('retains new content or drafts appearing during recovery deletion', async () => {
  for (const kind of ['content', 'draft'] as const) {
    let version = 1, drafts = false
    expect(await allowWindowClose(host({
      contentVersion: () => version, hasDirtyDrafts: () => drafts, isProjectDirty: () => true,
      confirmUnsaved: async () => 'discard',
      discardRecovery: async () => { if (kind === 'content') version++; else drafts = true }
    }))).toBe(false)
  }
})

it('rejects new drafts even if an asynchronous save reports success', async () => {
  let drafts = false, dirty = true
  expect(await allowWindowClose(host({
    hasDirtyDrafts: () => drafts, isProjectDirty: () => dirty,
    confirmUnsaved: async () => 'save',
    saveProject: async () => { drafts = true; dirty = false; return true }
  }))).toBe(false)
})

it('tracks independent modeless form edits until every owner releases them', () => {
  const first = registerPendingPropertyEdit(), second = registerPendingPropertyEdit()
  try {
    expect(hasPendingPropertyEdits()).toBe(true)
    first(); first()
    expect(hasPendingPropertyEdits()).toBe(true)
    second()
    expect(hasPendingPropertyEdits()).toBe(false)
  } finally { first(); second() }
})

it('drops maximized updates that arrive after unsubscribe', async () => {
  const pending: Array<(value: boolean) => void> = []
  let resized: () => void = () => {}
  const seen: boolean[] = []
  const stop = subscribeMaximized({
    isMaximized: () => new Promise(resolve => pending.push(resolve)),
    onResized: async (handler) => {
      resized = handler
      return () => { resized = () => {} }
    }
  }, (value) => seen.push(value), () => {})
  await Promise.resolve()
  expect(pending).toHaveLength(1)
  resized()
  expect(pending).toHaveLength(2)
  stop()
  pending[0](true)
  pending[1](false)
  expect(seen).toEqual([])
})
