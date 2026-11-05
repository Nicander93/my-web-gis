import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { X } from 'lucide-react'
import { constrainWindow, type WindowBounds } from '@/stores/docking-layout'
import { usePreferencesStore } from '@/stores/preferences.store'
import './modeless-window.css'

interface ModelessWindowProps {
  title: string
  children: ReactNode
  onClose(): void
  width?: number
  height?: number
  className?: string
  freezeScale?: boolean
}

/** 可复用的非模态桌面窗框；关闭它不会接管或取消业务操作。 */
export function ModelessWindow({ title, children, onClose, width = 720, height = 440, className = '', freezeScale = false }: ModelessWindowProps) {
  const scale = usePreferencesStore(state => state.fontSize / 12)
  const frame = useRef<HTMLElement>(null)
  const trigger = useRef(typeof document !== 'undefined' ? document.activeElement : null)
  const [bounds, setBounds] = useState(() => constrainWindow({ x: (window.innerWidth - width * scale) / 2, y: 140 * scale, width: width * scale, height: height * scale }, windowArea()))
  const previousScale = useRef(scale)
  const gesture = useRef<{ x: number; y: number; bounds: WindowBounds; resize: boolean } | null>(null)

  useLayoutEffect(() => {
    if (freezeScale) return
    const ratio = scale / previousScale.current
    previousScale.current = scale
    if (ratio === 1) return
    setBounds(value => constrainWindow({ x: value.x + value.width * (1 - ratio) / 2, y: value.y + value.height * (1 - ratio) / 2, width: value.width * ratio, height: value.height * ratio }, windowArea()))
  }, [scale, freezeScale])

  useLayoutEffect(() => {
    frame.current?.focus({ preventScroll: true })
    const resize = () => setBounds(value => constrainWindow(value, windowArea()))
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      const target = trigger.current
      if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true })
    }
  }, [])

  function start(event: PointerEvent<HTMLElement>, resize: boolean) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { x: event.clientX, y: event.clientY, bounds, resize }
  }

  function move(event: PointerEvent<HTMLElement>) {
    const active = gesture.current
    if (!active) return
    const dx = event.clientX - active.x, dy = event.clientY - active.y
    setBounds(constrainWindow(active.resize
      ? { ...active.bounds, width: active.bounds.width + dx, height: active.bounds.height + dy }
      : { ...active.bounds, x: active.bounds.x + dx, y: active.bounds.y + dy }, windowArea()))
  }

  return createPortal(<section ref={frame} role="dialog" aria-modal="false" aria-label={title} tabIndex={-1}
    className={`modeless-window ${className}`.trim()} style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
    onPointerDownCapture={event => {
      const control = (event.target as HTMLElement).closest('button,input,textarea,select,[tabindex]')
      if (!control || control === frame.current) frame.current?.focus({ preventScroll: true })
    }}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing && !event.defaultPrevented) {
        event.preventDefault(); event.stopPropagation(); onClose()
      }
    }}>
    <header className="modeless-window__header" tabIndex={0} aria-label={`移动${title}窗口`}
      onPointerDown={event => start(event, false)} onPointerMove={move}
      onPointerUp={() => { gesture.current = null }} onPointerCancel={() => { gesture.current = null }} onLostPointerCapture={() => { gesture.current = null }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !event.key.startsWith('Arrow')) return
        event.preventDefault()
        const step = event.shiftKey ? 20 : 5
        setBounds(value => constrainWindow({ ...value, x: value.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: value.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) }, windowArea()))
      }}>
      <h2>{title}</h2>
      <Button variant="icon" aria-label={`关闭${title}`} title={`关闭${title}`} onClick={onClose}><X size={15} /></Button>
    </header>
    <div className="modeless-window__body">{children}</div>
    <div className="modeless-window__resize" role="separator" tabIndex={0} aria-label={`调整${title}窗口大小`}
      onPointerDown={event => start(event, true)} onPointerMove={move}
      onPointerUp={() => { gesture.current = null }} onPointerCancel={() => { gesture.current = null }} onLostPointerCapture={() => { gesture.current = null }}
      onKeyDown={event => {
        if (!event.key.startsWith('Arrow')) return
        event.preventDefault()
        setBounds(value => constrainWindow({ ...value, width: value.width + (event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0), height: value.height + (event.key === 'ArrowDown' ? 10 : event.key === 'ArrowUp' ? -10 : 0) }, windowArea()))
      }} />
  </section>, document.body)
}

function windowArea() {
  const statusHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--status-height')) || 0
  return { width: window.innerWidth, height: Math.max(1, window.innerHeight - statusHeight) }
}
