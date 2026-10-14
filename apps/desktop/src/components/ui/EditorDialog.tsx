import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Modal } from 'antd'

interface EditorDialogProps {
  title: string
  children: ReactNode
  onClose(): void
  busy?: boolean
  className?: string
}

/** Ant Design owns the modal focus boundary, keyboard exit and restoration. */
export function EditorDialog({ title, children, onClose, busy = false, className = '' }: EditorDialogProps) {
  const body = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement : null)
  useLayoutEffect(() => () => {
    // Hosts remove this component directly, so Modal cannot wait for an open=false transition.
    queueMicrotask(() => {
      if (!body.current?.isConnected && trigger.current?.isConnected) trigger.current.focus()
    })
  }, [])
  return <Modal open title={title} footer={null} centered width={620}
    className={`desktop-editor-modal ${className}`}
    closable={{ disabled: busy, 'aria-label': `关闭${title}` }}
    keyboard={!busy} mask={{ closable: !busy }} onCancel={onClose} destroyOnHidden
    focusable={{ trap: true, focusTriggerAfterClose: true }}
    modalRender={(content) => <div onKeyDownCapture={(event) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return
      // Wrap at the boundary before the browser moves focus to its chrome/body.
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]'
      )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0)
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus()
      }
    }}>{content}</div>}
    afterOpenChange={(open) => {
      if (!open) return
      const first = Array.from(body.current?.querySelectorAll<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex="0"]'
      ) ?? []).find((element) => element.getClientRects().length > 0)
      first?.focus()
    }}
    styles={{ wrapper: { position: 'fixed', inset: 0 },
      container: { padding: 0, border: '1px solid #cfdcd2', borderRadius: 7,
        overflow: 'hidden', boxShadow: '0 22px 55px #0c221e35' },
      header: { height: 41, padding: '0 42px 0 13px', display: 'flex', alignItems: 'center',
        marginBottom: 0, borderBottom: '1px solid #dfe6e0' },
      body: { maxHeight: 'calc(100dvh - 110px)', overflow: 'auto' } }}>
    <div ref={body}>{children}</div>
  </Modal>
}
