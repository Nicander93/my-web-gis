export type DockPanelId = 'left' | 'right' | 'bottom'
export type DockPosition = 'left' | 'right' | 'bottom' | 'floating'

export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface WindowPlacement { dock: DockPosition; bounds: WindowBounds; maximized: boolean }
export type DockLayout = Record<DockPanelId, WindowPlacement>

export const panelDefinitions = {
  left: { title: '图层', dock: 'left', bounds: { x: 30, y: 30, width: 280, height: 440 } },
  right: { title: '检查器', dock: 'right', bounds: { x: 340, y: 40, width: 340, height: 440 } },
  bottom: { title: '属性表', dock: 'bottom', bounds: { x: 80, y: 100, width: 800, height: 300 } }
} satisfies Record<DockPanelId, { title: string; dock: DockPosition; bounds: WindowBounds }>

/** 窗口几何属于本机布局，不进入项目和编辑历史。 */
export function createDockLayout(): DockLayout {
  return Object.fromEntries(Object.entries(panelDefinitions).map(([id, panel]) => [
    id, { dock: panel.dock, bounds: { ...panel.bounds }, maximized: false }
  ])) as DockLayout
}

/** Docked side panels and the attribute table share visible workspace space without resizing the map. */
export function getDockedSideInsets(layout: DockLayout, panels: Record<'left' | 'right', { open: boolean; width: number }>): { left: number; right: number } {
  const result = { left: 0, right: 0 }
  for (const id of ['left', 'right'] as const) {
    const placement = layout[id]
    if (!panels[id].open || placement.maximized || placement.dock !== 'left' && placement.dock !== 'right') continue
    const width = placement.dock === id ? panels[id].width : placement.bounds.width
    result[placement.dock] = Math.max(result[placement.dock], width)
  }
  return result
}

/** 即使窗口比屏幕小，也让标题栏、关闭按钮和整个窗体保持可访问。 */
export function constrainWindow(bounds: WindowBounds, area: { width: number; height: number }): WindowBounds {
  const limitWidth = Math.max(1, area.width)
  const limitHeight = Math.max(1, area.height)
  const width = Math.min(limitWidth, Math.max(Math.min(220, limitWidth), finite(bounds.width, 320)))
  const height = Math.min(limitHeight, Math.max(Math.min(140, limitHeight), finite(bounds.height, 300)))
  return {
    width, height,
    x: Math.min(limitWidth - width, Math.max(0, finite(bounds.x, 0))),
    y: Math.min(limitHeight - height, Math.max(0, finite(bounds.y, 0)))
  }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 防止损坏或旧布局中的未知值把窗口恢复到屏幕外。 */
export function parseDockLayout(input: unknown): DockLayout {
  const result = createDockLayout()
  if (!input || typeof input !== 'object') return result
  for (const id of Object.keys(result) as DockPanelId[]) {
    const item = (input as Record<string, unknown>)[id]
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<WindowPlacement>
    if (candidate.dock === 'left' || candidate.dock === 'right' || candidate.dock === 'bottom' || candidate.dock === 'floating') result[id].dock = candidate.dock
    const bounds = candidate.bounds
    if (bounds && typeof bounds === 'object') {
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        result[id].bounds[key] = finite(bounds[key], result[id].bounds[key])
      }
    }
    result[id].maximized = candidate.maximized === true
  }
  return result
}
