import { create } from 'zustand'

interface InformationResult { layerId: string; featureId: string }

/** Identify results are session state, independent of selection and the active map tool. */
export const useInformationStore = create<{
  epoch: number
  results: InformationResult[]
  setResults(epoch: number, results: InformationResult[]): void
}>(set => ({ epoch: -1, results: [], setResults: (epoch, results) => set({ epoch, results }) }))
