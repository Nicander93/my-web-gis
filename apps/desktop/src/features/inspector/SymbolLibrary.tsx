import { useState } from 'react'
import { Alert, Button, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Upload } from 'antd'
import { isTauri } from '@tauri-apps/api/core'
import { createId, getEffectiveLocked, getLayerCartography, setLayerCartography } from '@desktop-webgis/gis-core'
import { BUILTIN_SYMBOL_PRESETS, instantiateSymbolPreset, parseSymbolPreset, type SymbolPreset } from '@desktop-webgis/ol-style/symbol-library'
import { createStyleAsset, verifyStyleAssets, type ProjectStyleAsset } from '@desktop-webgis/ol-style/style-assets'
import { useProjectStore } from '@/stores/project.store'
import { downloadProject } from '@/services/browser-project-files'
import { pickSaveFile, writeTextFile } from '@/services/files'
import { finishStyleInteraction } from './style-interaction'
import { readPersonalSymbolLibrary, writePersonalSymbolLibrary, type PersonalSymbolLibrary } from './symbol-library-store'
import { importSymbolPresetBundle, serializeSymbolPresetBundle } from './symbol-library-bundle'
import { SymbolPreview } from './SymbolPreview'

async function exportPreset(preset: SymbolPreset): Promise<void> {
  await verifyStyleAssets(preset.assets)
  const content = JSON.stringify(preset, null, 2)
  if (!isTauri()) { downloadProject(content, `${preset.name}.symbol.json`); return }
  const path = await pickSaveFile({ title: '导出符号', defaultPath: `${preset.name}.symbol.json`, filters: [{ name: '符号包', extensions: ['json'] }] })
  if (path) await writeTextFile(path, content)
}

async function exportPresetBundle(presets: readonly SymbolPreset[]): Promise<void> {
  const content = await serializeSymbolPresetBundle(presets)
  const name = 'my-symbols.symbols.json'
  if (!isTauri()) { downloadProject(content, name); return }
  const path = await pickSaveFile({ title: '导出符号集合', defaultPath: name, filters: [{ name: '符号集合', extensions: ['json'] }] })
  if (path) await writeTextFile(path, content)
}

export function SymbolLibrary({ layerId, onClose }: { layerId: string; onClose: () => void }) {
  const project = useProjectStore(state => state.project)
  const [error, setError] = useState<string>()
  const [library, setLibrary] = useState<PersonalSymbolLibrary>(() => {
    try { return readPersonalSymbolLibrary() } catch (error) {
      // Render the error after initialization without discarding the stored library.
      queueMicrotask(() => setError(String(error)))
      return { version: 1, presets: [], favorites: [], recent: [], colorRamps: [] }
    }
  })
  const [scope, setScope] = useState('all'), [query, setQuery] = useState(''), [category, setCategory] = useState('all')
  const [manager, setManager] = useState(false), [name, setName] = useState('我的符号')
  const [fontFamily, setFontFamily] = useState(''), [source, setSource] = useState('用户导入'), [license, setLicense] = useState('许可待确认')
  const [rampName, setRampName] = useState('自定义色带'), [rampColors, setRampColors] = useState('#2166ac,#f7f7f7,#b2182b')
  const [busy, setBusy] = useState(false)
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([])
  const locked = getEffectiveLocked(project, layerId)
  const all = [...BUILTIN_SYMBOL_PRESETS, ...library.presets]
  const shown = all.filter(preset => (category === 'all' || preset.category === category) && (scope === 'all' || scope === 'mine' && library.presets.some(item => item.id === preset.id) || scope === 'favorites' && library.favorites.includes(preset.id) || scope === 'recent' && library.recent.includes(preset.id)) && `${preset.name} ${preset.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()))

  async function persist(next: PersonalSymbolLibrary) {
    await writePersonalSymbolLibrary(next); setLibrary(next)
  }
  async function run(action: () => void | Promise<void>) {
    setBusy(true); setError(undefined)
    try { await action() } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  function currentSnapshot() {
    const store = useProjectStore.getState()
    if (getEffectiveLocked(store.project, layerId) || !getLayerCartography(store.project, layerId)) throw new Error('当前图层已删除或锁定')
    finishStyleInteraction(layerId)
    return store.getSnapshot()
  }
  async function apply(preset: SymbolPreset) {
    const epoch = useProjectStore.getState().projectEpoch
    await verifyStyleAssets(preset.assets)
    if (epoch !== useProjectStore.getState().projectEpoch) throw new Error('工程已切换，请重新选择符号')
    const snapshot = currentSnapshot()
    const fragment = getLayerCartography(snapshot.project, layerId)!
    snapshot.project = setLayerCartography(snapshot.project, layerId, instantiateSymbolPreset(preset, fragment.binding.styleSourceId, () => createId('drawing')))
    snapshot.project.cartography!.assets = [...new Map([...(snapshot.project.cartography!.assets ?? []), ...preset.assets].map(asset => [asset.id, structuredClone(asset)])).values()]
    if (!useProjectStore.getState().applySnapshotAsEdit(snapshot, '选择符号预设')) throw new Error('符号未应用')
    await persist({ ...library, recent: [preset.id, ...library.recent.filter(id => id !== preset.id)].slice(0, 20) })
  }
  async function saveCurrent() {
    const epoch = useProjectStore.getState().projectEpoch
    const snapshot = currentSnapshot(), fragment = getLayerCartography(snapshot.project, layerId)!
    const styleFingerprint = JSON.stringify({ layers: fragment.styleLayers, assets: snapshot.project.cartography?.assets ?? [] })
    const preset: SymbolPreset = { id: createId('personal-symbol'), name: name.trim() || '我的符号', category: category === 'line' || category === 'polygon' ? category : 'point', tags: ['自定义'], attribution: { source, license }, layers: fragment.styleLayers.map(layer => ({ ...structuredClone(layer), ...('source' in layer ? { source: 'preset' } : {}) })), assets: structuredClone(snapshot.project.cartography!.assets ?? []) }
    await verifyStyleAssets(preset.assets)
    const latest = useProjectStore.getState()
    const latestFragment = getLayerCartography(latest.project, layerId)
    if (latest.projectEpoch !== epoch || getEffectiveLocked(latest.project, layerId) || !latestFragment
        || styleFingerprint !== JSON.stringify({ layers: latestFragment.styleLayers, assets: latest.project.cartography?.assets ?? [] })) throw new Error('工程、图层或样式在校验期间已改变，请重新保存符号')
    await persist({ ...library, presets: [...library.presets, preset] })
  }
  async function importAsset(file: File) {
    if (file.size > 4 * 1024 * 1024) throw new Error('单个资源须小于 4 MiB')
    const epoch = useProjectStore.getState().projectEpoch
    const mimeType = /\.svg$/i.test(file.name) ? 'image/svg+xml' : /\.png$/i.test(file.name) ? 'image/png' : /\.woff2$/i.test(file.name) ? 'font/woff2' : undefined
    if (!mimeType) throw new Error('支持 SVG、PNG 和 WOFF2')
    const asset = await createStyleAsset({ name: file.name, mimeType, bytes: new Uint8Array(await file.arrayBuffer()), attribution: { source, license }, fontFamily: mimeType === 'font/woff2' ? fontFamily : undefined })
    // Decode before storing so a valid header alone cannot install a broken image/font.
    if (mimeType === 'font/woff2') await new FontFace(fontFamily, `url(${asset.dataUrl})`).load()
    else { const image = new Image(); image.src = asset.dataUrl; await image.decode() }
    if (epoch !== useProjectStore.getState().projectEpoch) throw new Error('工程已切换，请重新导入')
    const snapshot = currentSnapshot()
    snapshot.project.cartography!.assets = [...new Map([...(snapshot.project.cartography!.assets ?? []), asset].map(item => [item.id, item])).values()]
    useProjectStore.getState().applySnapshotAsEdit(snapshot, '导入符号资源')
  }

  async function importBundle(file: File) {
    if (file.size > 34 * 1024 * 1024) throw new Error('符号集合过大')
    const next = await importSymbolPresetBundle(await file.text())
    setLibrary(next)
    setSelectedPresetIds([])
  }
  function useAsset(asset: ProjectStyleAsset) {
    const snapshot = currentSnapshot(), fragment = getLayerCartography(snapshot.project, layerId)!
    const target = fragment.styleLayers.find(layer => asset.mimeType === 'font/woff2' ? layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined : layer.type === 'fill' || layer.type === 'symbol')
    const layers = structuredClone(fragment.styleLayers)
    if (asset.mimeType === 'font/woff2') {
      if (!target || target.type !== 'symbol') throw new Error('请先在专业编辑器新增注记绘制层')
      const layer = layers.find(layer => layer.id === target.id)!
      if (layer.type === 'symbol') layer.layout = { ...layer.layout, 'text-font': [asset.fontFamily!] }
    } else if (target?.type === 'fill') {
      const layer = layers.find(layer => layer.id === target.id)!
      if (layer.type === 'fill') layer.paint = { ...layer.paint, 'fill-pattern': asset.id }
    } else {
      layers.push({ id: createId('drawing'), source: fragment.binding.styleSourceId, type: 'symbol', layout: { 'icon-image': asset.id, 'icon-size': 1 } })
    }
    useProjectStore.getState().setLayerCartography(layerId, layers)
  }
  return <>
    <Modal open title="选择符号" width={880} onCancel={onClose} footer={<Button onClick={onClose}>关闭</Button>}>
      {error && <Alert type="error" showIcon title={error} />}
      <Space wrap style={{ marginBottom: 12 }}>
        <Input aria-label="搜索符号" placeholder="搜索名称、标签" value={query} onChange={event => setQuery(event.target.value)} />
        <Select aria-label="符号分类" value={category} onChange={setCategory} options={[{ value: 'all', label: '全部类型' }, { value: 'point', label: '点' }, { value: 'line', label: '线' }, { value: 'polygon', label: '面' }]} />
        <Button onClick={() => setManager(true)}>管理符号库与项目资源…</Button>
      </Space>
      <Tabs activeKey={scope} onChange={setScope} items={[['all', '全部'], ['mine', '我的符号'], ['favorites', '收藏'], ['recent', '最近使用']].map(([key, label]) => ({ key, label }))} />
      <Table rowKey="id" size="small" pagination={{ pageSize: 8 }} dataSource={shown} columns={[
        { title: '预览', render: (_, preset) => <SymbolPreview preset={preset} /> }, { title: '名称', dataIndex: 'name' }, { title: '标签', render: (_, preset) => preset.tags.join('、') },
        { title: '来源 / 许可', render: (_, preset) => `${preset.attribution.source} / ${preset.attribution.license}` },
        { title: '操作', render: (_, preset) => <Space><Button size="small" disabled={locked || busy} onClick={() => void run(() => apply(preset))}>使用</Button><Button size="small" disabled={busy} onClick={() => void run(() => persist({ ...library, favorites: library.favorites.includes(preset.id) ? library.favorites.filter(id => id !== preset.id) : [...library.favorites, preset.id] }))}>{library.favorites.includes(preset.id) ? '取消收藏' : '收藏'}</Button></Space> },
      ]} />
    </Modal>
    {manager && <Modal open title="符号库与项目资源" width={920} onCancel={() => setManager(false)} footer={<Button onClick={() => setManager(false)}>关闭</Button>}>
      {error && <Alert type="error" showIcon title={error} />}
        <Space wrap>
          <Input aria-label="自定义符号名称" value={name} onChange={event => setName(event.target.value)} />
          <Button disabled={locked || busy} onClick={() => void run(saveCurrent)}>保存当前图层为预设</Button>
          <Upload accept=".json" showUploadList={false} beforeUpload={file => { void run(async () => { if (file.size > 34 * 1024 * 1024) throw new Error('符号包过大'); const preset = await parseSymbolPreset(await file.text()); preset.id = createId('personal-symbol'); await persist({ ...library, presets: [...library.presets, preset] }) }); return false }}>
            <Button disabled={busy}>导入单个符号</Button>
          </Upload>
          <Upload accept=".json,.symbols.json" showUploadList={false} beforeUpload={file => { void run(() => importBundle(file)); return false }}>
            <Button disabled={busy}>导入符号集合</Button>
          </Upload>
          <Button disabled={busy || selectedPresetIds.length === 0} onClick={() => void run(() => exportPresetBundle(library.presets.filter(preset => selectedPresetIds.includes(preset.id))))}>批量导出</Button>
          <Popconfirm title={`删除已选的 ${selectedPresetIds.length} 个预设？`} okText="删除" cancelText="取消" disabled={selectedPresetIds.length === 0} onConfirm={() => void run(async () => { await persist({ ...library, presets: library.presets.filter(preset => !selectedPresetIds.includes(preset.id)) }); setSelectedPresetIds([]) })}>
            <Button danger disabled={busy || selectedPresetIds.length === 0}>批量删除</Button>
          </Popconfirm>
        </Space>
      <Table
        rowKey="id"
        size="small"
        dataSource={library.presets}
        pagination={{ pageSize: 4 }}
        rowSelection={{ selectedRowKeys: selectedPresetIds, onChange: keys => setSelectedPresetIds(keys.map(String)) }}
        columns={[{ title: '我的符号', dataIndex: 'name' }, { title: '操作', render: (_, preset) => <Space><Button disabled={busy} onClick={() => void run(() => exportPreset(preset))}>导出</Button><Button danger disabled={busy} onClick={() => void run(async () => { await persist({ ...library, presets: library.presets.filter(item => item.id !== preset.id) }); setSelectedPresetIds(ids => ids.filter(id => id !== preset.id)) })}>删除</Button></Space> }]}
      />
      <Space wrap style={{ marginBlock: 12 }}><Input aria-label="资源来源" value={source} onChange={event => setSource(event.target.value)} /><Input aria-label="资源许可" value={license} onChange={event => setLicense(event.target.value)} /><Input aria-label="字体名称" placeholder="WOFF2 字体名称" value={fontFamily} onChange={event => setFontFamily(event.target.value)} /><Upload accept=".svg,.png,.woff2" showUploadList={false} beforeUpload={file => { void run(() => importAsset(file)); return false }}><Button disabled={locked || busy}>导入项目资源</Button></Upload></Space>
      <Table rowKey="id" size="small" dataSource={project.cartography?.assets ?? []} pagination={{ pageSize: 5 }} columns={[{ title: '项目资源', dataIndex: 'name' }, { title: '格式', dataIndex: 'mimeType' }, { title: '内容哈希', render: (_, asset) => asset.contentHash.slice(0, 12) }, { title: '操作', render: (_, asset) => <Button disabled={locked || busy} onClick={() => void run(() => useAsset(asset))}>用于当前图层</Button> }]} />
      <Space wrap><Input aria-label="色带名称" value={rampName} onChange={event => setRampName(event.target.value)} /><Input aria-label="色带颜色" value={rampColors} onChange={event => setRampColors(event.target.value)} /><Button disabled={busy} onClick={() => void run(async () => { const colors = rampColors.split(',').map(color => color.trim()); if (colors.length < 2 || colors.length > 32 || colors.some(color => !/^#[a-f\d]{6}$/i.test(color))) throw new Error('色带需要 2–32 个逗号分隔的十六进制颜色'); await persist({ ...library, colorRamps: [...library.colorRamps, { id: createId('ramp'), name: rampName, colors }] }) })}>保存色带</Button></Space>
      <Table rowKey="id" size="small" dataSource={library.colorRamps} pagination={{ pageSize: 3 }} columns={[{ title: '我的色带', dataIndex: 'name' }, { title: '颜色', render: (_, ramp) => ramp.colors.join(' → ') }]} />
    </Modal>}
  </>
}
