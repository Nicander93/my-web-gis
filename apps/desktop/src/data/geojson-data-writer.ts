import { stringifyManagedDatasetFile, type PersistFeatureRows } from '@desktop-webgis/project'
import { readTextFile, writeTextFile } from '@/platform/files'

/** Explicit GeoJSON destination; uses the existing native atomic-file adapter.
 * Expected text detects changes before writing; it is not an OS compare-and-swap lock.
 */
export function createGeoJsonDataWriter(path: string, expectedText?: string): PersistFeatureRows {
  if (!path.trim()) throw new Error('请选择 GeoJSON 数据保存路径')
  let expected = expectedText
  return async (features, signal, fields) => {
    signal?.throwIfAborted()
    if (expected !== undefined) {
      const current = await readTextFile(path)
      signal?.throwIfAborted()
      if (current !== expected) throw new Error('数据文件已被外部修改，请重新载入后再保存')
    }
    const content = stringifyManagedDatasetFile(features, fields)
    signal?.throwIfAborted()
    await writeTextFile(path, content)
    // Atomic publication was acknowledged; cancellation after this point cannot reverse it.
    expected = content
  }
}
