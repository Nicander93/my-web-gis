import { create } from 'zustand'

interface InformationResult { layerId: string; featureId: string }

/** 识别结果属于会话状态，与选中集和当前地图工具无关。 */
export const useInformationStore = create<{
  epoch: number
  results: InformationResult[]
  setResults(epoch: number, results: InformationResult[]): void
}>(set => ({ epoch: -1, results: [], setResults: (epoch, results) => set({ epoch, results }) }))
