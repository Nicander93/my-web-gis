import type { GisFeature, ProcessingOptions } from '@desktop-webgis/gis-core'
export interface ComplexCase {
  id: string
  features: GisFeature[]
  overlay: GisFeature[]
  options: ProcessingOptions
  expectedCount: number
}
export function complexCases(size?: number): ComplexCase[]
export function verifyComplexResult(testCase: ComplexCase, result: GisFeature[]): void
