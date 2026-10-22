import { createId } from '@desktop-webgis/gis-core'
import { parseSymbolPreset, validateSymbolPreset, type SymbolPreset } from '@desktop-webgis/ol-style/symbol-library'
import { verifyStyleAssets } from '@desktop-webgis/ol-style/style-assets'
import { readPersonalSymbolLibrary, writePersonalSymbolLibrary, type PersonalSymbolLibrary } from './symbol-library-store'

const BUNDLE_FORMAT = 'my-web-gis.symbol-set'
const MAX_BUNDLE_CHARACTERS = 34 * 1024 * 1024

interface SymbolPresetBundle {
  format: typeof BUNDLE_FORMAT
  version: 1
  presets: SymbolPreset[]
}

export async function serializeSymbolPresetBundle(presets: readonly SymbolPreset[]): Promise<string> {
  validatePresetIds(presets)
  for (const preset of presets) {
    const errors = validateSymbolPreset(preset)
    if (errors.length) throw new Error(`符号“${preset.name}”无效：${errors.join('；')}`)
    await verifyStyleAssets(preset.assets)
  }
  const text = JSON.stringify({ format: BUNDLE_FORMAT, version: 1, presets: presets.map(preset => structuredClone(preset)) } satisfies SymbolPresetBundle, null, 2)
  if (text.length > MAX_BUNDLE_CHARACTERS) throw new Error('符号集合超过大小限制')
  return text
}

export async function importSymbolPresetBundle(
  text: string,
  storage: Storage = localStorage,
  allocateId: () => string = () => createId('personal-symbol')
): Promise<PersonalSymbolLibrary> {
  const presets = await parseSymbolPresetBundle(text)
  const library = readPersonalSymbolLibrary(storage)
  const imported = presets.map(preset => ({ ...preset, id: allocateId() }))
  const next: PersonalSymbolLibrary = { ...library, presets: [...library.presets, ...imported] }
  await writePersonalSymbolLibrary(next, storage)
  return next
}

async function parseSymbolPresetBundle(text: string): Promise<SymbolPreset[]> {
  if (text.length > MAX_BUNDLE_CHARACTERS) throw new Error('符号集合超过大小限制')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('符号集合 JSON 无效') }
  if (!parsed || typeof parsed !== 'object') throw new Error('符号集合结构无效')
  const bundle = parsed as Partial<SymbolPresetBundle>
  if (bundle.format !== BUNDLE_FORMAT || bundle.version !== 1 || !Array.isArray(bundle.presets) || !bundle.presets.length || bundle.presets.length > 256) {
    throw new Error('符号集合版本或内容无效')
  }
  validatePresetIds(bundle.presets)
  const presets: SymbolPreset[] = []
  for (const preset of bundle.presets) presets.push(await parseSymbolPreset(JSON.stringify(preset)))
  return presets
}

function validatePresetIds(presets: readonly SymbolPreset[]): void {
  if (presets.length > 256) throw new Error('符号集合最多包含 256 个预设')
  const ids = new Set<string>()
  for (const preset of presets) {
    if (!preset || typeof preset.id !== 'string' || !preset.id || ids.has(preset.id)) throw new Error('符号集合包含空 ID 或重复 ID')
    ids.add(preset.id)
  }
}
