export type StyleGeometry = 'point' | 'line' | 'polygon' | 'mixed'
export type StyleTheme = 'light' | 'dark' | 'system'

export interface StyleProfile {
  layerName: string
  geometry: StyleGeometry
  featureCount: number
  numericFields?: string[]
  categoryFields?: string[]
  theme?: StyleTheme
}

export interface SuggestedLayerStyle {
  stroke: string
  fill: string
  width: number
  pointRadius: number
}

export interface StyleSuggestion {
  style: SuggestedLayerStyle
  rationale: string
  source: 'local' | 'model'
}

export interface StyleModelRequest {
  system: string
  prompt: string
  responseSchema: Record<string, unknown>
}

export interface StyleModelAdapter {
  generate(request: StyleModelRequest): Promise<unknown>
}

const palettes = [
  { stroke: '#386641', fill: '#a7c95755' },
  { stroke: '#1d4e89', fill: '#5fa8d355' },
  { stroke: '#8f2d56', fill: '#d8115950' },
  { stroke: '#7f5539', fill: '#ddb89266' },
  { stroke: '#5a189a', fill: '#c77dff55' }
]

export async function suggestLayerStyle(
  profile: StyleProfile,
  adapter?: StyleModelAdapter
): Promise<StyleSuggestion> {
  if (!adapter) return localStyleSuggestion(profile)
  const output = await adapter.generate(createStyleModelRequest(profile))
  return { style: parseSuggestedStyle(output), rationale: modelRationale(output), source: 'model' }
}

export function localStyleSuggestion(profile: StyleProfile): StyleSuggestion {
  const palette = palettes[stableHash(profile.layerName) % palettes.length] ?? palettes[0]!
  const crowded = profile.featureCount > 10_000
  return {
    style: {
      stroke: palette.stroke,
      fill: profile.geometry === 'line' ? `${palette.stroke}22` : palette.fill,
      width: crowded ? 1 : profile.geometry === 'line' ? 2.5 : 1.5,
      pointRadius: crowded ? 3 : 5
    },
    rationale: crowded ? '要素较多，采用较细线宽和较小点径以降低遮挡。' : '按图层名称稳定选色，并保持适合报告展示的对比度。',
    source: 'local'
  }
}

export function createStyleModelRequest(profile: StyleProfile): StyleModelRequest {
  return {
    system: '你是 GIS 制图助手。只返回符合 JSON Schema 的单一对象，不输出 Markdown。',
    prompt: `为以下二维 GIS 图层建议简洁、可读、适合项目汇报的样式：${JSON.stringify(profile)}`,
    responseSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['stroke', 'fill', 'width', 'pointRadius', 'rationale'],
      properties: {
        stroke: { type: 'string', pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$' },
        fill: { type: 'string', pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$' },
        width: { type: 'number', minimum: 0.5, maximum: 12 },
        pointRadius: { type: 'number', minimum: 1, maximum: 32 },
        rationale: { type: 'string', maxLength: 200 }
      }
    }
  }
}

export function parseSuggestedStyle(output: unknown): SuggestedLayerStyle {
  const value = typeof output === 'string' ? JSON.parse(output) as unknown : output
  if (!isRecord(value)) throw new Error('配图模型返回值必须是 JSON 对象。')
  return {
    stroke: color(value.stroke, 'stroke'),
    fill: color(value.fill, 'fill'),
    width: boundedNumber(value.width, 'width', 0.5, 12),
    pointRadius: boundedNumber(value.pointRadius, 'pointRadius', 1, 32)
  }
}

function modelRationale(output: unknown): string {
  const value = typeof output === 'string' ? JSON.parse(output) as unknown : output
  if (!isRecord(value) || typeof value.rationale !== 'string' || value.rationale.length > 200) {
    return '模型已根据图层概况生成样式。'
  }
  return value.rationale
}

function color(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)) {
    throw new Error(`${field} 必须是 6 位或 8 位十六进制颜色。`)
  }
  return value
}

function boundedNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} 必须处于 ${minimum}..${maximum}。`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
