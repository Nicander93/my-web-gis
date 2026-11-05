import { useSyncExternalStore } from 'react'
import { RuntimeFeatureData } from './feature-data-runtime'

/** 运行时数据的持有者；项目配置和修订号由 Project 和 Zustand 管理，它们不存要素数组。 */
export const featureData = new RuntimeFeatureData()

/** 在 Provider 查询替换掉这些读取之前，沿用整行读取的旧调用方共享不可变视图。 */
export function useFeaturesByDataset() {
  return useSyncExternalStore(featureData.subscribe, featureData.readSnapshot, featureData.readSnapshot)
}

/** 待提交、字段结构和保存的生命周期，都不依赖替换有效行缓存。 */
export function useFeatureEditState() {
  return useSyncExternalStore(featureData.subscribeEdits, featureData.getEditState, featureData.getEditState)
}
