import type { ProcessingTool } from '@desktop-webgis/gis-core'

export type DesktopProcessingTool = ProcessingTool | 'check-geometry'

/** UI copy stays in Desktop; the complete record makes new protocol tools require a visible entry. */
const definitions: Record<DesktopProcessingTool, { name: string; description: string }> = {
  'check-geometry': { name: '几何检查', description: '检查坐标、结构和单个要素的拓扑有效性，列出问题及可用的位置。不修改原数据，不检查要素之间的重叠或缝隙。' },
  buffer: { name: '缓冲区', description: '按距离为每个要素生成缓冲面，保留属性。重叠范围不会自动融合。' },
  centroid: { name: '顶点质心', description: '为每个要素生成顶点平均位置。结果可能落在面外，不是面积加权中心。' },
  envelope: { name: '整体外包矩形', description: '为整个输入范围生成一个矩形面，属性记录输入数量。' },
  explode: { name: '多部件拆分', description: '将多点、多线、多面拆成单部件，复制原属性；单部件保持原几何。' },
  clip: { name: '面裁剪', description: '用第二输入的面范围裁剪输入面，保留输入属性。掩膜会先融合，避免重复结果。' },
  'clip-lines': { name: '线裁剪', description: '将线裁剪到面范围内，保留原属性。多个掩膜先融合；多段结果保留在同一多线要素中。' },
  intersect: { name: '面相交', description: '按两层面要素配对生成重叠区域。属性分别使用 A_、B_ 前缀；仅边界接触不生成面。' },
  difference: { name: '面差集', description: '从输入面扣除第二输入的覆盖范围，保留输入属性。完全覆盖的要素不输出。' },
  dissolve: { name: '面融合', description: '融合全部面，或按字段分组融合。仅保留分组字段，不自动汇总其他属性。' },
  'extract-location': { name: '按位置提取', description: '按与第二输入合并范围的空间关系提取点、线或面。每个匹配要素只输出一次，保留完整几何和原属性。' },
  'summarize-location': { name: '按区域统计', description: '保留每个输入区域，统计第二图层中符合空间关系的要素数量，可同时计算数值合计和均值。' },
  'attribute-join': { name: '属性连接', description: '按两层字段的相等值带入属性，保留输入几何。重复连接键明确报错，避免悄悄选择一条记录。' },
  'spatial-join': { name: '空间连接', description: '按空间关系带入第二图层的属性，保留完整输入几何。匹配多个要素时，每个配对输出一条记录。' }
}

export const processingTools = (Object.keys(definitions) as DesktopProcessingTool[]).map(id => ({ id, ...definitions[id] }))
export function processingToolName(tool: ProcessingTool): string { return definitions[tool]?.name ?? tool }
