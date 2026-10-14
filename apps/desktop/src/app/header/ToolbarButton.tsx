import type { LucideIcon } from 'lucide-react'
import { Button } from 'antd'

interface ToolbarButtonProps {
  icon: LucideIcon
  label: string
  disabled?: boolean
  active?: boolean
  onClick(): void
}

export function ToolbarButton({
  icon: Icon,
  label,
  disabled,
  active,
  onClick
}: ToolbarButtonProps) {
  return (
    <Button
      className="toolbar-button"
      type="text" htmlType="button"
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
      <span className="toolbar-button-label">{label}</span>
    </Button>
  )
}
