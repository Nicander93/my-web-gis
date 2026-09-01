import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { viewCommands } from './view.commands'

describe('view commands', () => {
  beforeEach(() => {
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    }
    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }))
    vi.stubGlobal('localStorage', storage)
    useWorkspaceStore.setState({
      left: { open: false, width: 330 },
      right: { open: false, width: 390 },
      bottom: { open: false, height: 360 }
    })
  })

  it('reports the state after toggling a panel', () => {
    const messages: string[] = []
    const listener = (event: Event) => messages.push((event as CustomEvent<string>).detail)
    window.addEventListener('desktop-webgis:command-status', listener)

    viewCommands.toggleLayers()

    window.removeEventListener('desktop-webgis:command-status', listener)
    expect(useWorkspaceStore.getState().left.open).toBe(true)
    expect(messages.at(-1)).toBe('图层面板已打开')
  })

  it('keeps the last panel size when restoring it', () => {
    useWorkspaceStore.getState().restoreLeft()
    useWorkspaceStore.getState().restoreRight()
    useWorkspaceStore.getState().restoreBottom()

    expect(useWorkspaceStore.getState().left.width).toBe(330)
    expect(useWorkspaceStore.getState().right.width).toBe(390)
    expect(useWorkspaceStore.getState().bottom.height).toBe(360)
  })
})
