import { stringifyManagedDatasetFile, type PersistFeatureRows } from '@desktop-webgis/project'
import { readTextFile, writeTextFile } from '@/platform/files'

/** 显式指定 GeoJSON 的写入目标，复用已有的原生原子文件适配器。
 * 期望文本只用来在写入前发现变化，它并不是操作系统级的比较并交换锁。
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
    // 原子发布已经确认，此后再取消也无法撤销。
    expected = content
  }
}
