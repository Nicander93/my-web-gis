import type { LucideIcon } from 'lucide-react'

interface MenuItemProps {
  icon?: LucideIcon
  label: string
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  onClick(): void
}

export function MenuItem({ icon: Icon, label, shortcut, disabled, checked, onClick }: MenuItemProps) {
  return (
    <button
      className="menu-item"
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-item-content">
        {Icon && <Icon size={16} strokeWidth={1.8} />}
        <span>{label}</span>
      </span>
      {(shortcut || checked !== undefined) && <span className="menu-item-shortcut">{checked ? '✓' : shortcut}</span>}
    </button>
  )
}
