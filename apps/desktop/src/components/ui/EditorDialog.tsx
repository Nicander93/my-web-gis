import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface EditorDialogProps {
  title: string
  children: ReactNode
  onClose(): void
  busy?: boolean
  className?: string
}

/** A modal boundary with consistent focus, keyboard exit and focus restoration. */
export function EditorDialog({
  title,
  children,
  onClose,
  busy = false,
  className = ''
}: EditorDialogProps) {
  const element = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const siblings: Array<{ element: HTMLElement; inert: boolean }> = []
    // Keep focus and assistive navigation inside the modal, preserving existing inert state.
    let branch: HTMLElement | null = overlay.current
    while (branch?.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          siblings.push({ element: sibling, inert: sibling.inert })
          sibling.inert = true
        }
      }
      branch = branch.parentElement
      if (branch === document.body) break
    }
    const first = Array.from(
      element.current?.querySelectorAll<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)'
      ) ?? []
    ).find((item) => item.getClientRects().length > 0)
    first?.focus()
    return () => {
      for (const sibling of siblings) sibling.element.inert = sibling.inert
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return (
    <div
      ref={overlay}
      className="dialog-overlay"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) close.current()
      }}
    >
      <div
        ref={element}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`dialog-content editor-dialog ${className}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            if (!busy) close.current()
          }
          if (event.key !== 'Tab') return
          const items = Array.from(
            element.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
            ) ?? []
          ).filter((item) => item.getClientRects().length > 0)
          const first = items[0],
            last = items.at(-1)
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
      >
        <header className="dialog-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="dialog-close"
            aria-label={`关闭${title}`}
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
