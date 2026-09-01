import { MousePointer2 } from 'lucide-react'

interface StatusBarProps {
  message: string
}

/** 显示应用壳层状态，不写入 Workspace 布局 Store。 */
export function StatusBar({ message }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span className="status-item"><span className="status-dot" />就绪</span>
      <span className="status-item">EPSG:3857</span>
      <span className="status-item"><MousePointer2 size={12} />选择</span>
      <span className="status-message">{message}</span>
    </footer>
  )
}
