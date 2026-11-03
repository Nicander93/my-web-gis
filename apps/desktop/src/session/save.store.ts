import { create } from 'zustand'

/** Save activity belongs to the application session, never to the project file. */
export const useSaveStore = create<{ pending: number }>(() => ({ pending: 0 }))
