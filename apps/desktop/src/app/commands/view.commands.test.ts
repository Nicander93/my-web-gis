import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { viewCommands } from './view.commands'
import { useActivityPanelStore } from '@/stores/activity-panel.store'

describe('view commands', () => {
  beforeEach(() => {
    useActivityPanelStore.getState().setTab('attributes')
    const storage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    }
    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        localStorage: storage,
        innerWidth: 1920,
        innerHeight: 1080
      })
    )
    vi.stubGlobal('localStorage', storage)
    useWorkspaceStore.setState({
      left: { open: false, width: 330 },
      right: { open: false, width: 390 },
      bottom: { open: false, height: 360 },
      focusMode: false,
      savedLayout: null
    })
  })

  it('opens log and diagnostic tabs and switches back to the attribute table without closing the dock', () => {
    viewCommands.openTaskLog()
    expect(useActivityPanelStore.getState().tab).toBe('tasks')
    expect(useWorkspaceStore.getState().bottom.open).toBe(true)
    viewCommands.openDiagnostics()
    expect(useActivityPanelStore.getState().tab).toBe('diagnostics')
    viewCommands.toggleAttributeTable()
    expect(useWorkspaceStore.getState().bottom.open).toBe(true)
    expect(useActivityPanelStore.getState().tab).toBe('attributes')
    viewCommands.toggleAttributeTable()
    expect(useWorkspaceStore.getState().bottom.open).toBe(false)
  })

  it('reports the state after toggling a panel', () => {
    const messages: string[] = []
    const listener = (event: Event) =>
      messages.push((event as CustomEvent<string>).detail)
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

  it('resets layout to map-first defaults with right panel closed', () => {
    useWorkspaceStore.setState({
      left: { open: false, width: 400 },
      right: { open: false, width: 500 },
      bottom: { open: true, height: 400 }
    })

    viewCommands.resetLayout()

    const state = useWorkspaceStore.getState()
    expect(state.left).toEqual({ open: true, width: 260 })
    expect(state.right).toEqual({ open: false, width: 320 })
    expect(state.bottom).toEqual({ open: false, height: 280 })
  })

  it('constrains overlay panels individually without subtracting their widths from the map', () => {
    useWorkspaceStore.setState({
      left: { open: true, width: 350 },
      right: { open: true, width: 400 },
      bottom: { open: true, height: 300 }
    })

    vi.stubGlobal(
      'window',
      Object.assign(new EventTarget(), {
        localStorage: {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined
        },
        innerWidth: 800,
        innerHeight: 600
      })
    )

    useWorkspaceStore.getState().constrainPanelSizes()

    const state = useWorkspaceStore.getState()
    expect(state.left.width).toBe(350)
    expect(state.right.width).toBe(400)
    expect(state.bottom.height).toBeLessThanOrEqual(300)
  })
})
