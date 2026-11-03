import { useSyncExternalStore } from 'react'
import { RuntimeFeatureData } from './feature-data-runtime'

/** Runtime data owner; Project/Zustand holds configuration and revisions rather than feature arrays. */
export const featureData = new RuntimeFeatureData()

/** Legacy full-row consumers share immutable views until provider queries replace these reads. */
export function useFeaturesByDataset() {
  return useSyncExternalStore(featureData.subscribe, featureData.readSnapshot, featureData.readSnapshot)
}

/** Pending/schema/save lifecycle does not depend on replacing the effective row cache. */
export function useFeatureEditState() {
  return useSyncExternalStore(featureData.subscribeEdits, featureData.getEditState, featureData.getEditState)
}
