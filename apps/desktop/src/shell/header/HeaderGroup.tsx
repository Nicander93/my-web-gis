import type { ReactNode } from 'react'

interface HeaderGroupProps {
  label: string
  children: ReactNode
}

/** 对齐一组相关命令，保持 Header 内容紧凑。 */
export function HeaderGroup({ label, children }: HeaderGroupProps) {
  return (
    <section className="header-group" aria-label={label}>
      <div className="header-group-actions">{children}</div>
      <span className="header-group-label">{label}</span>
    </section>
  )
}
