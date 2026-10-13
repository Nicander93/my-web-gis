import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Maximize2, Minimize2, PanelsTopLeft, X } from 'lucide-react'
import { useDockingStore } from '@/stores/docking.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { constrainWindow, panelDefinitions, type DockPanelId, type DockPosition, type WindowBounds, type WindowPlacement } from './docking-layout'
import './docking.css'

interface DockWindowProps {
  id: DockPanelId
  title: string
  label: string
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  onClose?(): void
}

interface Gesture {
  startX: number
  startY: number
  bounds: WindowBounds
  kind: 'move' | 'resize'
  target: HTMLElement
  pointerId: number
}

/** 覆盖式窗口：停靠和浮动都不参与地图的布局和生命周期。 */
export function DockWindow({ id, title, label, actions, children, footer, onClose }: DockWindowProps) {
  const ref = useRef<HTMLElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const placement = useDockingStore(state => state.layout[id])
  const order = useDockingStore(state => state.order)
  const panel = useWorkspaceStore(state => state[id])
  const [draft, setDraft] = useState<WindowPlacement | null>(null)
  const [area, setArea] = useState({ width: 1000, height: 600 })
  const current = draft ?? placement
  const bounds = constrainWindow(current.bounds, area)
  const style: CSSProperties = current.maximized ? { inset: 0 } : current.dock === 'floating'
    ? { left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }
    : current.dock === 'bottom'
      ? { left: 0, right: 0, bottom: 0, height: Math.min(!draft && current.dock === id && 'height' in panel ? panel.height : bounds.height, area.height) }
      : { top: 0, bottom: 0, [current.dock]: 0, width: Math.min(!draft && current.dock === id && 'width' in panel ? panel.width : bounds.width, area.width) }
  style.display = panel.open ? undefined : 'none'
  style.zIndex = 5 + order.indexOf(id)

  useEffect(() => {
    if (panel.open) useDockingStore.getState().activate(id)
  }, [id, panel.open])

  useEffect(() => {
    const root = ref.current?.parentElement
    if (!root) return
    const measure = () => setArea({ width: root.clientWidth, height: root.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  function stop(commit: boolean): void {
    const active = gesture.current
    if (!active) return
    gesture.current = null
    if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId)
    if (commit && draft) useDockingStore.getState().update(id, { ...draft, bounds: constrainWindow(draft.bounds, area) })
    setDraft(null)
  }

  useEffect(() => {
    function cancel(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || !gesture.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const active = gesture.current
      gesture.current = null
      if (active.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId)
      setDraft(null)
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [])

  function begin(event: PointerEvent<HTMLElement>, kind: Gesture['kind']): void {
    if (event.button !== 0 || current.maximized || (kind === 'move' && (event.target as HTMLElement).closest('button,select,input'))) return
    const root = ref.current?.parentElement?.getBoundingClientRect()
    const rect = ref.current?.getBoundingClientRect()
    if (!root || !rect) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const initial = { x: rect.left - root.left, y: rect.top - root.top, width: rect.width, height: rect.height }
    gesture.current = { startX: event.clientX, startY: event.clientY, bounds: initial, kind, target: event.currentTarget, pointerId: event.pointerId }
  }

  function move(event: PointerEvent<HTMLElement>): void {
    const active = gesture.current
    if (!active) return
    const dx = event.clientX - active.startX, dy = event.clientY - active.startY
    if (active.kind === 'move') {
      if (!draft && Math.abs(dx) + Math.abs(dy) < 4) return
      setDraft({ dock: 'floating', bounds: constrainWindow({ ...active.bounds, x: active.bounds.x + dx, y: active.bounds.y + dy }, area), maximized: false })
    } else {
      const resized = { ...active.bounds }
      if (current.dock === 'floating') { resized.width += dx; resized.height += dy }
      else if (current.dock === 'bottom') { resized.y += dy; resized.height -= dy }
      else if (current.dock === 'right') { resized.x += dx; resized.width -= dx }
      else resized.width += dx
      setDraft({ ...current, bounds: constrainWindow(resized, area) })
    }
  }

  function finish(): void {
    if (gesture.current?.kind === 'resize' && draft && draft.dock === id) {
      const store = useWorkspaceStore.getState()
      if (draft.dock === 'bottom') store.setBottomHeight(draft.bounds.height)
      else if (id === 'left') store.setLeftWidth(draft.bounds.width)
      else if (id === 'right') store.setRightWidth(draft.bounds.width)
    }
    stop(true)
  }

  function dock(position: DockPosition): void {
    const rect = ref.current?.getBoundingClientRect()
    const root = ref.current?.parentElement?.getBoundingClientRect()
    const nextBounds = position === 'floating' && rect && root
      ? constrainWindow({ x: rect.left - root.left + 30, y: rect.top - root.top + 30, width: Math.min(rect.width, panelDefinitions[id].bounds.width), height: Math.min(rect.height, 440) }, area)
      : bounds
    useDockingStore.getState().update(id, { dock: position, bounds: nextBounds, maximized: false })
  }

  function close(): void {
    onClose?.()
    const store = useWorkspaceStore.getState()
    if (id === 'left') store.setLeftOpen(false)
    else if (id === 'right') store.setRightOpen(false)
    else store.setBottomOpen(false)
  }

  return <aside ref={ref} className={`workspace-panel dock-window dock-window--${current.dock} panel-${id}`} style={style} aria-label={label} aria-hidden={!panel.open}
    onPointerDownCapture={() => useDockingStore.getState().activate(id)} onFocusCapture={() => useDockingStore.getState().activate(id)}>
    <header className="panel-titlebar dock-window__title" tabIndex={0} aria-label={`移动${title}窗口`}
      onPointerDown={event => begin(event, 'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => stop(false)} onLostPointerCapture={() => stop(false)}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || current.dock !== 'floating' || current.maximized || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        const step = event.shiftKey ? 20 : 5
        useDockingStore.getState().update(id, { ...current, bounds: constrainWindow({ ...bounds, x: bounds.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: bounds.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) }, area) })
      }}>
      <h2 title={title}>{title}</h2>
      <div className="panel-actions">
        {actions}
        <select className="dock-window__position" aria-label={`${title}停靠位置`} value={current.dock} onChange={event => dock(event.target.value as DockPosition)}>
          <option value="left">左侧</option><option value="right">右侧</option><option value="bottom">底部</option><option value="floating">浮动</option>
        </select>
        <button type="button" className="ui-button ui-button-icon" title={current.dock === 'floating' ? '停靠窗口' : '浮动窗口'} aria-label={current.dock === 'floating' ? `停靠${title}` : `浮动${title}`} onClick={() => dock(current.dock === 'floating' ? id : 'floating')}><PanelsTopLeft size={14} /></button>
        <button type="button" className="ui-button ui-button-icon" aria-label={`${current.maximized ? '还原' : '最大化'}${title}`} onClick={() => useDockingStore.getState().update(id, { ...current, maximized: !current.maximized })}>{current.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        <button type="button" className="ui-button ui-button-icon" title={`关闭${title}`} aria-label={id === 'left' ? '收起图层面板' : id === 'right' ? '收起右侧面板' : '关闭属性表窗口'} onClick={close}><X size={14} /></button>
      </div>
    </header>
    <div className="panel-body">{children}</div>
    {footer}
    {!current.maximized && <div role="separator" tabIndex={0} aria-label={`调整${title}窗口大小`} className={`dock-window__resize dock-window__resize--${current.dock}`}
      onPointerDown={event => begin(event, 'resize')} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => stop(false)} onLostPointerCapture={() => stop(false)}
      onKeyDown={event => {
        if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        const dx = event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0
        const dy = event.key === 'ArrowDown' ? 10 : event.key === 'ArrowUp' ? -10 : 0
        if (current.dock === 'floating') useDockingStore.getState().update(id, { ...current, bounds: constrainWindow({ ...bounds, width: bounds.width + dx, height: bounds.height + dy }, area) })
        else if (current.dock !== id) {
          useDockingStore.getState().update(id, { ...current, bounds: constrainWindow({ ...bounds, width: bounds.width + dx, height: bounds.height + dy }, area) })
        } else {
          const state = useWorkspaceStore.getState()
          if (id === 'bottom') state.setBottomHeight(state.bottom.height + dy)
          else if (id === 'left') state.setLeftWidth(state.left.width + dx)
          else state.setRightWidth(state.right.width + dx)
        }
      }} />}
  </aside>
}
