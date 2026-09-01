import type { ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'icon' | 'tab'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

/** 提供 Desktop Shell 使用的轻量按钮基元。 */
export function Button({ variant = 'default', className = '', ...props }: ButtonProps) {
  return <button className={`ui-button ui-button-${variant} ${className}`.trim()} {...props} />
}
