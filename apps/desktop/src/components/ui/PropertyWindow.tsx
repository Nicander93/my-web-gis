import { useLayoutEffect, useRef, useState } from 'react'
import { registerPendingPropertyEdit } from '@/services/pending-property-edits'
import type { ReactNode } from 'react'
import { Button, Input, Menu } from 'antd'
import { X } from 'lucide-react'
import './property-window.css'

interface Props {
  title: string
  subtitle: string
  dirty: boolean
  categories: Array<{ key: string; label: string }>
  section: string
  onSection(section: string): void
  query: string
  onQuery(query: string): void
  onClose(): void
  children: ReactNode
  footer: ReactNode
}

/** Modeless frame; drafts and project ownership remain with the feature. */
export function PropertyWindow({ title, subtitle, dirty, categories, section, onSection, query, onQuery, onClose, children, footer }: Props) {
  useLayoutEffect(() => dirty ? registerPendingPropertyEdit() : undefined, [dirty])
  const frame = useRef<HTMLElement>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; offset: typeof offset } | null>(null)
  return <section ref={frame} className="scene-property-window" role="dialog" aria-modal="false" aria-label={title} style={{ marginLeft: offset.x, top: 120 + offset.y }} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing && !event.defaultPrevented) { event.stopPropagation(); onClose() } }}>
    <header onPointerDown={event => {
      if (event.button || (event.target as HTMLElement).closest('button')) return
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, y: event.clientY, offset }
    }} onPointerMove={event => {
      const start = drag.current
      if (!start) return
      const bounds = frame.current!.getBoundingClientRect()
      const margin = Math.max(0, (window.innerWidth - bounds.width) / 2 - 12)
      setOffset({ x: Math.max(-margin, Math.min(margin, start.offset.x + event.clientX - start.x)), y: Math.max(-64, Math.min(window.innerHeight - bounds.height - 132, start.offset.y + event.clientY - start.y)) })
    }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
      <div><strong>{title}</strong><small>{subtitle}{dirty ? ' · 未应用' : ''}</small></div><Button type="text" aria-label="关闭完整属性" icon={<X size={15} />} onClick={onClose} />
    </header>
    <div className="scene-property-window__search"><Input.Search aria-label="搜索属性字段" placeholder="搜索字段名称或 API 名称" value={query} onChange={event => onQuery(event.target.value)} allowClear />{query && <small>当前分类：{categories.find(item => item.key === section)?.label}</small>}</div>
    <div className="scene-property-window__body"><Menu selectedKeys={[section]} items={categories} onClick={({ key }) => onSection(key)} /><div className="scene-property-window__fields">{children}</div></div>
    <footer>{footer}</footer>
  </section>
}
