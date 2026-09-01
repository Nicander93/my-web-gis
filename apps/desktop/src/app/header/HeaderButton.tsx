import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface HeaderButtonProps {
  icon: LucideIcon
  label: string
  shortcut?: string
  onClick(): void
}

/** Ribbon 中的紧凑命令按钮。 */
export function HeaderButton({ icon: Icon, label, shortcut, onClick }: HeaderButtonProps) {
  return (
    <Button className="header-button" onClick={onClick} title={shortcut ? `${label} (${shortcut})` : label}>
      <Icon size={17} strokeWidth={1.7} />
      <span>{label}</span>
    </Button>
  )
}
