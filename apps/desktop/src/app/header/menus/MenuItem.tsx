import type { LucideIcon } from 'lucide-react'

interface MenuItemProps {
  icon?: LucideIcon
  label: string
  shortcut?: string
  disabled?: boolean
  onClick(): void
}

export function MenuItem({ icon: Icon, label, shortcut, disabled, onClick }: MenuItemProps) {
  return (
    <button
      className="menu-item"
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-item-content">
        {Icon && <Icon size={16} strokeWidth={1.8} />}
        <span>{label}</span>
      </span>
      {shortcut && <span className="menu-item-shortcut">{shortcut}</span>}
    </button>
  )
}
