import { HelpCircle } from 'lucide-react'
import { MenuItem } from './MenuItem'

interface HelpMenuProps {
  onClose(): void
}

export function HelpMenu({ onClose }: HelpMenuProps) {
  function handleAction(action: () => void) {
    action()
    onClose()
  }

  return (
    <div className="menu-content">
      <MenuItem
        icon={HelpCircle}
        label="关于"
        onClick={() => handleAction(() => console.log('About'))}
      />
    </div>
  )
}
