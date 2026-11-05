import { Button as AntButton, type ButtonProps as AntButtonProps } from 'antd'
import type { ComponentPropsWithRef } from 'react'

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'icon' | 'tab'

interface ButtonProps extends Omit<ComponentPropsWithRef<typeof AntButton>, 'type' | 'variant'> {
  variant?: ButtonVariant
  type?: AntButtonProps['htmlType']
}

/** 保留业务侧的按钮变体，控件行为交给 Ant Design。 */
export function Button({ variant = 'default', className = '', type = 'button', ...props }: ButtonProps) {
  return <AntButton htmlType={type}
    type={variant === 'primary' ? 'primary' : variant === 'ghost' || variant === 'icon' || variant === 'tab' ? 'text' : 'default'}
    className={`ui-button ui-button-${variant} ${className}`.trim()} {...props} />
}
