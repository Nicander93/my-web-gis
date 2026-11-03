import { HelpCircle } from 'lucide-react'
import { MenuItem } from '@/ui/MenuItem'
import { helpCommands } from '@/commands/help.commands'

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
      <MenuItem icon={HelpCircle} label="操作帮助" onClick={() => handleAction(helpCommands.openHelp)} />
      <MenuItem
        icon={HelpCircle}
        label="关于"
        onClick={() => handleAction(helpCommands.openAbout)}
      />
    </div>
  )
}
