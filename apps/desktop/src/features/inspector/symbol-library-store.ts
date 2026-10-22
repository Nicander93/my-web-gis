import { validateSymbolPreset, type SymbolPreset } from '@desktop-webgis/ol-style/symbol-library'
import { validateStyleAssets, verifyStyleAssets } from '@desktop-webgis/ol-style/style-assets'

export interface ColorRampPreset { id: string; name: string; colors: string[] }
export interface PersonalSymbolLibrary { version: 1; presets: SymbolPreset[]; favorites: string[]; recent: string[]; colorRamps: ColorRampPreset[] }
const KEY = 'my-web-gis.symbol-library.v1'

const emptyLibrary = (): PersonalSymbolLibrary => ({ version: 1, presets: [], favorites: [], recent: [], colorRamps: [] })

export function validatePersonalSymbolLibrary(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['我的符号库必须是对象']
  const library = value as PersonalSymbolLibrary
  if (library.version !== 1 || !Array.isArray(library.presets) || library.presets.length > 256
      || !Array.isArray(library.favorites) || library.favorites.length > 256
      || !Array.isArray(library.recent) || library.recent.length > 20
      || !Array.isArray(library.colorRamps) || library.colorRamps.length > 256) return ['我的符号库版本或数量限制无效']
  const ids = new Set<string>()
  for (const preset of library.presets) {
    const errors = validateSymbolPreset(preset)
    if (errors.length) return [`符号预设无效：${errors.join('; ')}`]
    if (!preset.id || preset.id.startsWith('builtin:') || ids.has(preset.id)) return ['个人符号预设 ID 无效或重复']
    ids.add(preset.id)
    if (preset.name !== preset.name.trim() || !preset.name || typeof preset.attribution.source !== 'string' || !preset.attribution.source.trim()
        || typeof preset.attribution.license !== 'string' || !preset.attribution.license.trim()) return ['个人符号预设名称、来源或许可不能为空']
    const assetErrors = validateStyleAssets(preset.assets)
    if (assetErrors.length) return [`预设资源无效：${assetErrors.join('; ')}`]
  }
  if ([...library.favorites, ...library.recent].some(id => typeof id !== 'string' || !id || id.length > 256)) return ['收藏或最近使用的 ID 无效']
  const rampIds = new Set<string>()
  for (const ramp of library.colorRamps) {
    if (!ramp || typeof ramp !== 'object' || typeof ramp.id !== 'string' || !ramp.id || rampIds.has(ramp.id)
        || typeof ramp.name !== 'string' || !ramp.name.trim() || ramp.name.length > 160
        || !Array.isArray(ramp.colors) || ramp.colors.length < 2 || ramp.colors.length > 32
        || ramp.colors.some(color => typeof color !== 'string' || !/^#[a-f\d]{6}$/i.test(color))) return ['个人色带名称、ID 或颜色无效']
    rampIds.add(ramp.id)
  }
  return []
}

function parseStoredLibrary(raw: string): PersonalSymbolLibrary {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('我的符号库 JSON 无效；原始数据已保留') }
  const errors = validatePersonalSymbolLibrary(parsed)
  if (errors.length) throw new Error(`我的符号库格式无效；原始数据已保留：${errors.join('; ')}`)
  return parsed as PersonalSymbolLibrary
}

export function readPersonalSymbolLibrary(storage: Storage = localStorage): PersonalSymbolLibrary {
  const raw = storage.getItem(KEY)
  return raw ? parseStoredLibrary(raw) : emptyLibrary()
}

export async function verifyPersonalSymbolLibrary(value: PersonalSymbolLibrary): Promise<void> {
  const errors = validatePersonalSymbolLibrary(value)
  if (errors.length) throw new Error(`不能保存无效的符号库：${errors.join('; ')}`)
  for (const preset of value.presets) await verifyStyleAssets(preset.assets)
}

export async function writePersonalSymbolLibrary(value: PersonalSymbolLibrary, storage: Storage = localStorage): Promise<void> {
  const errors = validatePersonalSymbolLibrary(value)
  if (errors.length) throw new Error(`不能保存无效的符号库：${errors.join('; ')}`)
  const existing = storage.getItem(KEY)
  if (existing) parseStoredLibrary(existing)
  await verifyPersonalSymbolLibrary(value)
  const latest = storage.getItem(KEY)
  if (latest !== existing) {
    if (latest) parseStoredLibrary(latest)
    throw new Error('符号库在保存期间已被其他窗口修改；请重新加载后再试')
  }
  const serialized = JSON.stringify(value)
  if (serialized.length > 48 * 1024 * 1024) throw new Error('个人符号库超过本地存储安全限额')
  // Quota failures propagate; malformed old data is checked before setItem and left untouched.
  storage.setItem(KEY, serialized)
}
