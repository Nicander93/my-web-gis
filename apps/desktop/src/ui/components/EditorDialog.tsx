import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Modal } from 'antd'

interface EditorDialogProps {
  title: string
  children: ReactNode
  onClose(): void
  busy?: boolean
  className?: string
}

/** 模态的焦点边界、键盘退出和焦点恢复都由 Ant Design 负责。 */
export function EditorDialog({ title, children, onClose, busy = false, className = '' }: EditorDialogProps) {
  const body = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement : null)
  useLayoutEffect(() => () => {
    // 宿主会直接移除这个组件，所以 Modal 不能等待 open=false 的过渡。
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
      // 在浏览器把焦点移回自身界面或 body 之前，在边界处拦截。
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
      container: { padding: 0, border: '1px solid var(--color-border-strong)', borderRadius: 7,
        overflow: 'hidden', boxShadow: '0 22px 55px #0c221e35' },
      header: { height: 41, padding: '0 42px 0 13px', display: 'flex', alignItems: 'center',
        marginBottom: 0, borderBottom: '1px solid var(--color-border)' },
      body: { maxHeight: 'calc(100dvh - 110px)', overflow: 'auto' } }}>
    <div ref={body}>{children}</div>
  </Modal>
}
