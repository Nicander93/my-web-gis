import { checkGeometries } from '@desktop-webgis/spatial-analysis'
import type { GeometryCheckInput } from '@desktop-webgis/spatial-analysis'

/** 在改动项目或历史之前，先校验整个手势的结果。永远不要静默修补。 */
export function assertValidGeometryEdits(features: readonly GeometryCheckInput[]): void {
  const report = checkGeometries(features)
  const issue = report.issues[0]
  if (issue) throw new Error(`未提交本次编辑：要素 ${issue.featureId}，${issue.message}。已保留原有数据。`)
}
