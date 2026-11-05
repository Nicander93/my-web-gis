import { useRef } from 'react'
import { Button } from 'antd'

interface ColumnResizeHandleProps {
  field: string
  width: number
  onChange(width: number): void
}

/** 列宽调整属于会话状态；按 Esc 会撤销当前这次拖动，不进入项目历史。 */
export function ColumnResizeHandle({ field, width, onChange }: ColumnResizeHandleProps) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  const resize = (next: number) => onChange(Math.max(80, Math.min(600, Math.round(next))))
  return <Button type="text" className="attr-column-resize" role="separator"
    aria-label={`调整 ${field} 列宽`} aria-orientation="vertical"
    aria-valuemin={80} aria-valuemax={600} aria-valuenow={width}
    title="拖动调整列宽；方向键微调，Esc 取消拖动"
    onClick={(event) => event.stopPropagation()}
    onDoubleClick={(event) => { event.stopPropagation(); resize(160) }}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus()
      drag.current = { x: event.clientX, width }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      if (drag.current) resize(drag.current.width + event.clientX - drag.current.x)
    }}
    onPointerUp={() => { drag.current = null }}
    onPointerCancel={() => { if (drag.current) resize(drag.current.width); drag.current = null }}
    onLostPointerCapture={() => { drag.current = null }}
    onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === 'Escape' && drag.current) { resize(drag.current.width); drag.current = null }
      else if (event.key === 'ArrowLeft') resize(width - (event.shiftKey ? 32 : 8))
      else if (event.key === 'ArrowRight') resize(width + (event.shiftKey ? 32 : 8))
      else if (event.key === 'Home') resize(80)
      else if (event.key === 'End') resize(600)
      else return
      event.preventDefault()
    }} />
}
