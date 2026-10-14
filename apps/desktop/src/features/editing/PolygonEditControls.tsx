import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { Alert, Button, Form, Input, Progress, Select, Space } from 'antd'
import { Merge, Split } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { emitCommandStatus } from '@/app/commands/status'
import { setActiveEditTool } from '@/features/map/map-runtime-host'
import { getPolygonTarget, preparePolygonEdit, type AttributePolicy, type LineString, type MultiLineString } from './polygon-edit'
import { calculatePolygonEdit } from './polygon-worker'

/** Editing commands are enabled only for a bound polygon selection. */
export function PolygonEditControls() {
  const project = useProjectStore((state) => state.project)
  const selection = useProjectStore((state) => state.selection)
  const rows = useProjectStore((state) => state.featuresByDataset)
  const layerId = useWorkbenchStore((state) => state.editLayerId)
  const layer = project.layers.find((item) => item.id === layerId)
  const selected = layer && selection.layerId === layerId ? selection.featureIds : []
  const polygonsOnly = selected.length > 0 && selected.every((id) => rows[layer!.datasetId]?.some((feature) => feature.id === id &&
    (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')))
  const [operation, setOperation] = useState<{ mode: 'merge' | 'split'; layerId: string; ids: string[] } | null>(null)
  function open(mode: 'merge' | 'split'): void {
    if (!layerId) return
    setActiveEditTool('pan')
    setOperation({ mode, layerId, ids: [...selected] })
  }
  return <>
    <Button type="text" className="toolbar-button" aria-label="合并面" disabled={!polygonsOnly || selected.length < 2} onClick={() => open('merge')}>
      <Merge size={18} aria-hidden="true" /><span className="toolbar-button-label">合并面</span>
    </Button>
    <Button type="text" className="toolbar-button" aria-label="分割面" disabled={!polygonsOnly} onClick={() => open('split')}>
      <Split size={18} aria-hidden="true" /><span className="toolbar-button-label">分割面</span>
    </Button>
    {operation && <PolygonEditDialog {...operation} onClose={() => setOperation(null)} />}
  </>
}

function PolygonEditDialog({ mode, layerId, ids, onClose }: { mode: 'merge' | 'split'; layerId: string; ids: string[]; onClose(): void }) {
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  const [projectId] = useState(project.id)
  const [datasetId] = useState(project.layers.find((layer) => layer.id === layerId)?.datasetId)
  const [primaryId, setPrimaryId] = useState(ids[0])
  const [policy, setPolicy] = useState<AttributePolicy>('primary')
  const cutters = project.layers.flatMap((layer) => (featuresByDataset[layer.datasetId] ?? []).flatMap((feature) =>
    feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString'
      ? [{ key: JSON.stringify([layer.id, feature.id]), label: `${layer.name} / ${feature.id}`, geometry: feature.geometry }] : []))
  const [source, setSource] = useState<'existing' | 'json'>(cutters.length ? 'existing' : 'json')
  const [cutterId, setCutterId] = useState(cutters[0]?.key)
  const [json, setJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [notice, setNotice] = useState<{ text: string; type: 'error' | 'info' } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const applyButton = useRef<ComponentRef<typeof Button>>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (busy || notice?.type !== 'info') return
    const frame = requestAnimationFrame(() => applyButton.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [busy, notice])
  const layer = project.layers.find((item) => item.id === layerId)
  const title = mode === 'merge' ? '合并面' : '分割面'

  async function apply(): Promise<void> {
    if (controller.current) return
    setNotice(null)
    let operation: AbortController | null = null
    try {
      const before = useProjectStore.getState().getSnapshot()
      if (before.project.id !== projectId || layer?.datasetId !== datasetId || useWorkbenchStore.getState().editLayerId !== layerId) throw new Error('工程或编辑目标已改变，请重新打开操作窗口')
      let cutter: LineString | MultiLineString | undefined
      if (mode === 'split') {
        if (source === 'existing') cutter = cutters.find((item) => item.key === cutterId)?.geometry
        else {
          const value = JSON.parse(json)
          const geometry = value?.type === 'Feature' ? value.geometry : value
          if (geometry?.type !== 'LineString' && geometry?.type !== 'MultiLineString') throw new Error('请输入 LineString / MultiLineString GeoJSON')
          cutter = geometry
        }
        if (!cutter) throw new Error('请选择或输入切割线')
      }
      const prepared = preparePolygonEdit(before, layerId, ids, mode === 'merge'
        ? { mode, primaryId, policy } : { mode, cutter: cutter! })
      operation = new AbortController(); controller.current = operation
      setBusy(true); setProgress(0)
      const geometry = await calculatePolygonEdit(prepared.input, operation.signal, (done, total) => {
        if (!operation!.signal.aborted) setProgress(Math.round(done / total * 100))
      })
      if (operation.signal.aborted) return
      const current = useProjectStore.getState().getSnapshot()
      const target = getPolygonTarget(current, layerId, ids)
      if (current.project.id !== projectId || target.dataset.id !== datasetId || useWorkbenchStore.getState().editLayerId !== layerId ||
        JSON.stringify({ dataset: target.dataset, features: target.features }) !== prepared.fingerprint) throw new Error('计算期间数据或编辑目标已改变，结果未应用，请重新计算')
      const result = prepared.finish(geometry)
      useProjectStore.getState().executeEditCommand(result.command)
      useProjectStore.getState().setSelection(result.selection)
      emitCommandStatus(result.message)
      onClose()
    } catch (error) {
      if (operation?.signal.aborted) setNotice({ text: '计算已取消，未修改数据', type: 'info' })
      else setNotice({ text: error instanceof Error ? error.message : String(error), type: 'error' })
    } finally {
      if (controller.current === operation) { controller.current = null; setBusy(false) }
    }
  }
  return <EditorDialog title={title} busy={busy} onClose={onClose}>
    <Form layout="vertical" onFinish={apply}>
      <p>固定目标：{layer?.name ?? '目标已不存在'}；已选 {ids.length} 个面。修改原图层，可一步撤销。</p>
      {mode === 'merge' ? <>
        <Form.Item label="属性来源要素"><Select aria-label="属性来源要素" disabled={busy} value={primaryId} onChange={setPrimaryId}
          options={ids.map((id) => ({ value: id, label: id }))} /></Form.Item>
        <Form.Item label="属性策略"><Select aria-label="合并属性策略" disabled={busy} value={policy} onChange={setPolicy}
          options={[{ value: 'primary', label: '保留指定要素属性' }, { value: 'sum', label: '数值字段求和，其他字段保留指定要素' },
            { value: 'null-conflicts', label: '冲突值设为空，相同值保留' }]} /></Form.Item>
        <Alert role="note" type="info" title="数值求和跳过空值；非空字段不接受冲突设空。主要素 ID 保留，其他输入要素由合并结果替代。" />
      </> : <>
        <Form.Item label="切割线来源"><Select aria-label="切割线来源" value={source} disabled={busy} onChange={setSource}
          options={[{ value: 'existing', label: '已有线要素', disabled: !cutters.length }, { value: 'json', label: 'GeoJSON 线（WGS84 经纬度）' }]} /></Form.Item>
        {source === 'existing' ? <Form.Item label="切割线"><Select aria-label="切割线要素" disabled={busy} value={cutterId} onChange={setCutterId}
          showSearch={{ optionFilterProp: 'label' }} options={cutters.map((item) => ({ value: item.key, label: item.label }))} /></Form.Item>
          : <Form.Item label="切割线 GeoJSON"><Input.TextArea aria-label="切割线 GeoJSON" disabled={busy} value={json} rows={4}
            placeholder={'{"type":"LineString","coordinates":[[116,39],[117,40]]}'} onChange={(event) => setJson(event.target.value)} /></Form.Item>}
        <Alert role="note" type="info" title="切割线须贯穿边界或构成闭环；折线和多段线均可。分片继承原属性，最大分片保留原 ID。" />
      </>}
      <p>仅支持有效二维面；高程/M 值和跨日期变更线输入会报错，不会静默丢弃。</p>
      {busy && <><Progress percent={progress} size="small" /><p>正在校验和计算几何，可取消。</p></>}
      {notice && <Alert role="alert" type={notice.type} title={notice.text} />}
      <Space className="desktop-dialog-actions">
        <Button disabled={busy} onClick={onClose}>关闭</Button>
        <Button ref={applyButton} type="primary" htmlType="submit" disabled={busy}>计算并应用</Button>
        {busy && <Button htmlType="button" onClick={(event) => { event.preventDefault(); controller.current?.abort() }}>取消计算</Button>}
      </Space>
    </Form>
  </EditorDialog>
}
