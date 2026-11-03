import { Button as AntButton, type ButtonProps as AntButtonProps } from 'antd'
import type { ComponentPropsWithRef } from 'react'

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'icon' | 'tab'

interface ButtonProps extends Omit<ComponentPropsWithRef<typeof AntButton>, 'type' | 'variant'> {
  variant?: ButtonVariant
  type?: AntButtonProps['htmlType']
}

/** Keeps domain button variants while Ant Design owns control behavior. */
export function Button({ variant = 'default', className = '', type = 'button', ...props }: ButtonProps) {
  return <AntButton htmlType={type}
    type={variant === 'primary' ? 'primary' : variant === 'ghost' || variant === 'icon' || variant === 'tab' ? 'text' : 'default'}
    className={`ui-button ui-button-${variant} ${className}`.trim()} {...props} />
}
