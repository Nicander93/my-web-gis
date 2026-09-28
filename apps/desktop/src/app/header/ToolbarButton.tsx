import type { LucideIcon } from 'lucide-react'

interface ToolbarButtonProps {
  icon: LucideIcon
  label: string
  disabled?: boolean
  onClick(): void
}

export function ToolbarButton({ icon: Icon, label, disabled, onClick }: ToolbarButtonProps) {
  return (
    <button
      className="toolbar-button"
      type="button"
      disabled={disabled}
      title={label}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={1.8} />
    </button>
  )
}
