import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

/** Keep explanations available without consuming inspector rows. */
export function SceneInfo({ label, children }: { label: string; children: string }) {
  const id = useId()
  const [position, setPosition] = useState<{ left: number; top: number }>()
  function show(button: HTMLButtonElement): void {
    const rect = button.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(rect.right - 260, window.innerWidth - 268)), top: Math.min(rect.bottom + 6, window.innerHeight - 130) })
  }
  return <>
    <button type="button" className="scene3d-info" aria-label={`${label}说明`} aria-describedby={position ? id : undefined}
      onMouseEnter={event => show(event.currentTarget)} onMouseLeave={event => { if (document.activeElement !== event.currentTarget) setPosition(undefined) }}
      onFocus={event => show(event.currentTarget)} onBlur={() => setPosition(undefined)}
      onClick={event => { event.stopPropagation(); show(event.currentTarget) }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setPosition(undefined) } }}><Info size={13} aria-hidden="true" /></button>
    {position && createPortal(<div id={id} role="tooltip" className="scene3d-info-tooltip" style={position}>{children}</div>, document.body)}
  </>
}

export function ScenePropertyGroup({ title, hint, children, open = true }: { title: string; hint?: string; children: ReactNode; open?: boolean }) {
  return <details className="scene3d-property-section scene3d-property-group" open={open}>
    <summary><span>{title}</span>{hint && <SceneInfo label={title}>{hint}</SceneInfo>}</summary>
    <div className="scene3d-property-group__body">{children}</div>
  </details>
}
