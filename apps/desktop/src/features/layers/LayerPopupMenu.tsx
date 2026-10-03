import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface LayerPopupMenuProps {
  x: number
  y: number
  label: string
  onClose(): void
  children: ReactNode
}

/** Keep layer actions inside the viewport and accessible without a pointer. */
export function LayerPopupMenu({ x, y, label, onClose, children }: LayerPopupMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
    })
  }, [x, y])

  useEffect(() => {
    const node = ref.current
    const origin = document.activeElement
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    function handlePointer(event: MouseEvent): void {
      if (!ref.current?.contains(event.target as Node)) closeRef.current()
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault()
        closeRef.current()
        return
      }
      const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const index = buttons.findIndex((button) => button === document.activeElement)
      if (buttons.length === 0) return
      let next: number
      if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
      else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = buttons.length - 1
      else return
      event.preventDefault()
      buttons[next].focus()
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
      if (origin instanceof HTMLElement && origin.isConnected && (node?.contains(document.activeElement) || document.activeElement === document.body)) origin.focus()
    }
  }, [])

  return createPortal(
    <div ref={ref} className="layer-context-menu menu-dropdown" style={position} role="menu" aria-label={label}>
      <div className="menu-content">{children}</div>
    </div>,
    document.body
  )
}
