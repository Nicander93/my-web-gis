import type { LucideIcon } from 'lucide-react'
import { Button, Tooltip } from 'antd'

interface ToolbarButtonProps {
  icon: LucideIcon
  label: string
  disabled?: boolean
  disabledReason?: string
  active?: boolean
  loading?: boolean
  onClick(): void
}

export function ToolbarButton({
  icon: Icon,
  label,
  disabled,
  disabledReason,
  active,
  loading,
  onClick
}: ToolbarButtonProps) {
  const reason = disabled ? disabledReason ?? `${label}：当前状态下不可用` : label
  return <Tooltip title={reason} trigger={disabled ? ['hover', 'focus'] : ['hover']} classNames={{ root: 'ribbon-tool-tooltip' }}>
    <span className="ribbon-tool-anchor" tabIndex={disabled ? 0 : undefined} aria-label={disabled ? reason : undefined}>
    <Button
      className="toolbar-button"
      type="text" htmlType="button"
      disabled={disabled}
      loading={loading} aria-busy={loading}
      title={reason}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
      <span className="toolbar-button-label">{label}</span>
    </Button>
    </span>
  </Tooltip>
}
