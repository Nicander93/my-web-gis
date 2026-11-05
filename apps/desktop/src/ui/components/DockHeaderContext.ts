import { createContext } from 'react'

/** 让停靠的功能组件提供自己的页签，而不额外增加一行内容。 */
export const DockHeaderContext = createContext<HTMLElement | null>(null)
