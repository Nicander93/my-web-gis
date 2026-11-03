import { createContext } from 'react'

/** Lets a docked feature contribute its tabs without adding another content row. */
export const DockHeaderContext = createContext<HTMLElement | null>(null)
