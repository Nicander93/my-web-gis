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
    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage, innerWidth: 1920, innerHeight: 1080 }))
    vi.stubGlobal('localStorage', storage)
    useWorkspaceStore.setState({
      left: { open: false, width: 330 },
      right: { open: false, width: 390 },
      bottom: { open: false, height: 360 },
      focusMode: false,
      savedLayout: null
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

  it('saves layout before entering focus mode and restores exactly on exit', () => {
    useWorkspaceStore.setState({
      left: { open: true, width: 280 },
      right: { open: true, width: 320 },
      bottom: { open: true, height: 240 }
    })

    viewCommands.toggleFocusMode()

    const afterEnter = useWorkspaceStore.getState()
    expect(afterEnter.focusMode).toBe(true)
    expect(afterEnter.left.open).toBe(false)
    expect(afterEnter.right.open).toBe(false)
    expect(afterEnter.bottom.open).toBe(false)
    expect(afterEnter.savedLayout).toEqual({
      left: { open: true, width: 280 },
      right: { open: true, width: 320 },
      bottom: { open: true, height: 240 }
    })

    viewCommands.toggleFocusMode()

    const afterExit = useWorkspaceStore.getState()
    expect(afterExit.focusMode).toBe(false)
    expect(afterExit.left).toEqual({ open: true, width: 280 })
    expect(afterExit.right).toEqual({ open: true, width: 320 })
    expect(afterExit.bottom).toEqual({ open: true, height: 240 })
    expect(afterExit.savedLayout).toBeNull()
  })

  it('resets layout to new defaults with right panel open', () => {
    useWorkspaceStore.setState({
      left: { open: false, width: 400 },
      right: { open: false, width: 500 },
      bottom: { open: true, height: 400 }
    })

    viewCommands.resetLayout()

    const state = useWorkspaceStore.getState()
    expect(state.left).toEqual({ open: true, width: 260 })
    expect(state.right).toEqual({ open: true, width: 300 })
    expect(state.bottom).toEqual({ open: false, height: 240 })
  })

  it('constrains panel sizes when window shrinks to prevent map squeeze', () => {
    useWorkspaceStore.setState({
      left: { open: true, width: 350 },
      right: { open: true, width: 400 },
      bottom: { open: true, height: 300 }
    })

    vi.stubGlobal('window', Object.assign(new EventTarget(), { 
      localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
      innerWidth: 800,
      innerHeight: 600 
    }))

    useWorkspaceStore.getState().constrainPanelSizes()

    const state = useWorkspaceStore.getState()
    const totalWidth = state.left.width + state.right.width
    expect(totalWidth).toBeLessThanOrEqual(800 - 320)
    expect(state.bottom.height).toBeLessThanOrEqual(300)
  })
})
