import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { viewCommands } from './view.commands'
import { useActivityPanelStore } from '@/stores/activity-panel.store'
import { useDockingStore } from '@/stores/docking.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { getActiveEditTool } from '@/features/map/map-runtime-host'

describe('view commands', () => {
  beforeEach(() => {
    useActivityPanelStore.getState().setTab('attributes')
    useActivityPanelStore.setState({ tasksOpen: false, diagnosticsOpen: false })
    useWorkbenchStore.getState().reset()
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

  it('opens tasks and diagnostics independently without changing the attribute dock', () => {
    viewCommands.openTaskLog()
    expect(useActivityPanelStore.getState().tab).toBe('tasks')
    expect(useWorkspaceStore.getState().bottom.open).toBe(false)
    expect(useActivityPanelStore.getState().tasksOpen).toBe(true)
    viewCommands.openDiagnostics()
    expect(useActivityPanelStore.getState().tab).toBe('diagnostics')
    expect(useActivityPanelStore.getState().diagnosticsOpen).toBe(true)
    expect(useActivityPanelStore.getState().tasksOpen).toBe(true)
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

  it('does not move or close the attribute dock when opening task and diagnostic windows', () => {
    useWorkspaceStore.getState().setBottomOpen(true)
    const layout = structuredClone(useDockingStore.getState().layout)
    for (const command of [viewCommands.openTaskLog, viewCommands.openDiagnostics]) {
      useDockingStore.getState().activate('left')
      command()
      expect(useDockingStore.getState().order.at(-1)).toBe('left')
      expect(useWorkspaceStore.getState().bottom.open).toBe(true)
      expect(useDockingStore.getState().layout).toEqual(layout)
    }
    viewCommands.openAttributeTable()
    expect(useDockingStore.getState().order.at(-1)).toBe('bottom')
  })

  it('switches right work panels without changing the map tool or editing target', () => {
    useWorkbenchStore.getState().setActiveTool('modify')
    useWorkbenchStore.getState().setEditLayer('editing-target')
    const tool = getActiveEditTool()
    viewCommands.toggleRightPanel('information')
    expect(useWorkspaceStore.getState().right.open).toBe(true)
    expect(useWorkbenchStore.getState().rightTask).toBe('information')
    expect(useWorkbenchStore.getState().activeTool).toBe('modify')
    expect(getActiveEditTool()).toBe(tool)
    expect(useWorkbenchStore.getState().editLayerId).toBe('editing-target')
    viewCommands.toggleRightPanel('processing')
    expect(useWorkspaceStore.getState().right.open).toBe(true)
    viewCommands.toggleRightPanel('processing')
    expect(useWorkspaceStore.getState().right.open).toBe(false)
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
