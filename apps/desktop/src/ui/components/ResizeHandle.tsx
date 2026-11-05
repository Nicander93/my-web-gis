import { useRef } from 'react'

interface ResizeHandleProps {
  orientation: 'horizontal' | 'vertical'
  onResize(delta: number): void
  label: string
}

/** 使用 Pointer Events 报告面板拖拽位移，不感知具体面板业务。 */
export function ResizeHandle({ orientation, onResize, label }: ResizeHandleProps) {
  const lastPoint = useRef<{ x: number; y: number } | null>(null)

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    lastPoint.current = { x: event.clientX, y: event.clientY }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!lastPoint.current) return
    const delta = orientation === 'horizontal' ? event.clientX - lastPoint.current.x : event.clientY - lastPoint.current.y
    lastPoint.current = { x: event.clientX, y: event.clientY }
    onResize(delta)
  }

  function stopResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    lastPoint.current = null
  }

  return (
    <div
      className={`resize-handle resize-handle-${orientation}`}
      role="separator"
      aria-label={label}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopResize}
      onPointerCancel={stopResize}
    />
  )
}
