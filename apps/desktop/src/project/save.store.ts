import { create } from 'zustand'

/** 保存活动的状态属于应用会话，不会写进项目文件。 */
export const useSaveStore = create<{ pending: number }>(() => ({ pending: 0 }))
