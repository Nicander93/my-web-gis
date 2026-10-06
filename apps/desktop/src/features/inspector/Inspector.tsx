import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { useSessionStore } from '@/stores/session.store'
import { useProjectStore } from '@/stores/project.store'
import { capabilitiesForDataset } from '@desktop-webgis/gis-core'
import { StylePanel } from './StylePanel'
import { LabelPanel } from './LabelPanel'
import { Legend } from './Legend'
import { getLayerCapabilities } from '@/app/commands/layer.commands'
import { processingToolName } from '@/features/processing/processing-tools'

export function Inspector() {
  const browsingLayerId = useProjectStore((state) => state.selectedLayerId)
  const selection = useProjectStore(state => state.selection)
  const tab = useSessionStore(state => state.inspectorTab)
  const selectedLayerId = tab === 'feature' ? selection.layerId : browsingLayerId
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  const getNormalizedLayerStyle = useProjectStore((state) => state.getNormalizedLayerStyle)
  const setLayerOpacity = useProjectStore((state) => state.setLayerOpacity)
  const ensureStyleDraft = useSessionStore((state) => state.ensureStyleDraft)
  const setTab = useSessionStore((state) => state.setInspectorTab)

  const layerId = selectedLayerId || 'no-layer'

  const selectedLayer = selectedLayerId
    ? project.layers.find((layer) => layer.id === selectedLayerId)
    : null

  const dataset = selectedLayer
    ? project.datasets.find((item) => item.id === selectedLayer.datasetId)
    : undefined
  const caps = getLayerCapabilities(selectedLayerId)
  const featureCount = selectedLayer
    ? (featuresByDataset[selectedLayer.datasetId]?.length ?? 0)
    : 0

  const feature = selection.featureIds.length === 1 && selectedLayer ? featuresByDataset[selectedLayer.datasetId]?.find(item => item.id === selection.featureIds[0]) : undefined

  const geometryTypes = new Set(selectedLayer ? (featuresByDataset[selectedLayer.datasetId] ?? []).map(feature => feature.geometry.type) : [])
  const geometryType = geometryTypes.size === 1 ? [...geometryTypes][0] : geometryTypes.size > 1 ? 'Mixed' : '—'
  const flags = capabilitiesForDataset(dataset)

  useEffect(() => {
    if (!selectedLayerId) return
    if (!flags.style) return
    const applied = getNormalizedLayerStyle(selectedLayerId)
    if (applied) {
      ensureStyleDraft(selectedLayerId, applied)
    }
  }, [selectedLayerId, getNormalizedLayerStyle, ensureStyleDraft, flags.style])

  useEffect(() => {
    if (browsingLayerId && tab === 'feature') setTab(browsingLayerId, 'layer')
    // A layer-row click changes inspection scope; map picks keep feature scope.
  }, [browsingLayerId, setTab])

  useEffect(() => {
    if (selection.layerId && selection.featureIds.length) setTab(selection.layerId, 'feature')
  }, [selection, setTab])

  // Service tile layers have no local attributes — keep users on the layer tab.
  useEffect(() => {
    if (!selectedLayerId) return
    if (flags.queryAttributes) return
    if (tab === 'feature' || tab === 'style' || tab === 'label') {
      setTab(selectedLayerId, 'layer')
    }
  }, [selectedLayerId, flags.queryAttributes, tab, setTab])

  return (
    <div className="feature-panel inspector-content">
      <p className="inspector-target">{tab === 'feature' ? `要素属性 · ${selectedLayer?.name ?? '未选择图层'}${feature ? ` / ${feature.id}` : ''}` : `图层属性 · ${selectedLayer?.name ?? '未选择'}`}</p>
      <div className="segmented-tabs" role="tablist" aria-label="检查器标签">
        <Button
          variant={tab === 'layer' ? 'tab' : 'ghost'}
          onClick={() => setTab(layerId, 'layer')}
          role="tab"
          aria-selected={tab === 'layer'}
        >
          图层
        </Button>
        <Button
          variant={tab === 'style' ? 'tab' : 'ghost'}
          onClick={() => setTab(layerId, 'style')}
          role="tab"
          aria-selected={tab === 'style'}
          disabled={!caps.canStyle}
        >
          样式
        </Button>
        <Button
          variant={tab === 'label' ? 'tab' : 'ghost'}
          onClick={() => setTab(layerId, 'label')}
          role="tab"
          aria-selected={tab === 'label'}
          disabled={!caps.canLabel}
        >
          标注
        </Button>
        <Button
          variant={tab === 'feature' ? 'tab' : 'ghost'}
          onClick={() => setTab(layerId, 'feature')}
          role="tab"
          aria-selected={tab === 'feature'}
          disabled={!caps.canAttributeTable}
        >
          要素
        </Button>
      </div>

      {tab === 'layer' ? (
        selectedLayer && selectedLayerId ? (
          <>
            <div className="inspector-card">
              <div className="card-title">当前图层</div>
              <div className="inspector-row">
                <span>名称</span>
                <strong>{selectedLayer.name}</strong>
              </div>
              <div className="inspector-row">
                <span>数据源</span>
                <strong>{dataset?.kind ?? '—'}</strong>
              </div>
              {dataset?.kind === 'vector' && dataset.processing && (
                <details className="processing-provenance">
                  <summary>处理来源</summary>
                  <p>输入图层：{dataset.processing.sourceLayerName}</p>
                  <p>工具：{processingToolName(dataset.processing.options.tool)}</p>
                  <p>范围：{{ all: '全部要素', filtered: '图层筛选结果', selected: '当前选中要素' }[dataset.processing.scope]}</p>
                  {dataset.processing.options.tool === 'buffer' && <p>距离：{dataset.processing.options.distance} {dataset.processing.options.unit === 'meters' ? '米' : '千米'}</p>}
                  <p>{dataset.processing.inputCount} 个输入 → {dataset.processing.outputCount} 个结果</p>
                  {dataset.processing.options.tool === 'dissolve' && <p>分组：{dataset.processing.options.field || '不分组'}</p>}
                  {dataset.processing.options.tool === 'extract-location' && <p>关系：{{ intersects: '相交（包括边界）', within: '完全位于其中', disjoint: '不相交' }[dataset.processing.options.predicate]}</p>}
                  {dataset.processing.options.tool === 'summarize-location' && <p>统计：{dataset.processing.options.predicate === 'within' ? '完全位于区域内' : '相交（含边界）'}；{dataset.processing.options.field || '仅数量'}；前缀 {dataset.processing.options.prefix || '无'}</p>}
                  {dataset.processing.options.tool === 'attribute-join' && <p>连接：{dataset.processing.options.inputKey} → {dataset.processing.options.joinKey}；{dataset.processing.options.mode === 'left' ? '保留全部输入' : '仅匹配输入'}；带入 {dataset.processing.options.fields.join('、')}；前缀 {dataset.processing.options.prefix || '无'}</p>}
                  {dataset.processing.options.tool === 'spatial-join' && <p>空间连接：{dataset.processing.options.predicate === 'within' ? '完整位于其中' : '相交（含边界）'}；{dataset.processing.options.mode === 'left' ? '保留全部输入' : '仅匹配输入'}；带入 {dataset.processing.options.fields.join('、')}；前缀 {dataset.processing.options.prefix || '无'}</p>}
                  {(dataset.processing.options.tool === 'measure-area' || dataset.processing.options.tool === 'measure-length' || dataset.processing.options.tool === 'measure-perimeter') && <p>测量字段：{dataset.processing.options.field}；单位：{dataset.processing.options.unit}；WGS84 球面 XY 模型，不含高程。</p>}
                  {dataset.processing.options.tool === 'calculate-field' && <p>字段：{dataset.processing.options.field}；表达式：{dataset.processing.options.expression}</p>}
                  {dataset.processing.overlay && <>
                    <p>第二输入：{dataset.processing.overlay.layerName}</p>
                    <p>第二范围：{{ all: '全部要素', filtered: '图层筛选结果', selected: '当前选中要素' }[dataset.processing.overlay.scope]}（{dataset.processing.overlay.inputCount} 个要素）</p>
                  </>}
                  <p>完成时间：{new Date(dataset.processing.completedAt).toLocaleString()}</p>
                </details>
              )}
              {dataset?.kind === 'wms' ? (
                <>
                  <div className="inspector-row">
                    <span>WMS 版本</span>
                    <strong>{dataset.source.version}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>图层名</span>
                    <strong>{dataset.source.layerNames.join(', ')}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>CRS</span>
                    <strong>{dataset.source.crs || '视图默认'}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>范围</span>
                    <strong>
                      {dataset.source.bboxWgs84
                        ? dataset.source.bboxWgs84.map((n) => n.toFixed(2)).join(', ')
                        : '—'}
                    </strong>
                  </div>
                </>
              ) : dataset?.kind === 'wmts' ? (
                <>
                  <div className="inspector-row">
                    <span>WMTS 版本</span>
                    <strong>{dataset.source.version}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>图层</span>
                    <strong>{dataset.source.layer}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>TileMatrixSet</span>
                    <strong>{dataset.source.tileMatrixSet}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>投影</span>
                    <strong>{dataset.source.projection || dataset.source.supportedCrs || '—'}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>编码</span>
                    <strong>{dataset.source.requestEncoding}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>矩阵级数</span>
                    <strong>{dataset.source.tileMatrices?.length ?? 0}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>范围</span>
                    <strong>
                      {dataset.source.bboxWgs84
                        ? dataset.source.bboxWgs84.map((n) => n.toFixed(2)).join(', ')
                        : '—'}
                    </strong>
                  </div>
                </>
              ) : dataset?.kind === 'wfs' ? (
                <>
                  <div className="inspector-row">
                    <span>WFS 版本</span>
                    <strong>{dataset.source.version}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>要素类型</span>
                    <strong>{dataset.source.typeName}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>快照要素</span>
                    <strong>
                      {dataset.source.loadedCount ?? featureCount}
                      {dataset.source.complete === false
                        ? dataset.source.truncatedByLimit
                          ? '（截断，不完整）'
                          : '（不完整）'
                        : dataset.source.complete === true
                          ? '（完整）'
                          : ''}
                    </strong>
                  </div>
                  <div className="inspector-row">
                    <span>查询范围</span>
                    <strong>
                      {dataset.source.queryExtentWgs84
                        ? dataset.source.queryExtentWgs84.map((n) => n.toFixed(2)).join(', ')
                        : dataset.source.extentMode === 'full'
                          ? '全范围'
                          : '—'}
                    </strong>
                  </div>
                  <div className="inspector-row">
                    <span>来源</span>
                    <strong title={dataset.source.url}>{dataset.source.url}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>只读快照</span>
                    <strong>是（复制为本地图层后可编辑；不触发 WFS-T）</strong>
                  </div>
                </>
              ) : (
                <>
                  <div className="inspector-row">
                    <span>几何类型</span>
                    <strong>{geometryType}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>要素数量</span>
                    <strong>{featureCount}</strong>
                  </div>
                </>
              )}
              <div className="inspector-row inspector-opacity-row">
                <span>透明度</span>
                <label className="inspector-opacity">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(selectedLayer.opacity * 100)}
                    onChange={(e) =>
                      setLayerOpacity(selectedLayerId, Number(e.target.value) / 100)
                    }
                  />
                  <strong>{Math.round(selectedLayer.opacity * 100)}%</strong>
                </label>
              </div>
            </div>
            {caps.canStyle ? <Legend layerId={selectedLayerId} /> : null}
            {dataset?.kind === 'wms' ? (
              <p className="config-hint">
                WMS 为影像服务图层，不提供本地矢量属性表；GetFeatureInfo 不在本阶段范围。
              </p>
            ) : null}
            {dataset?.kind === 'wmts' ? (
              <p className="config-hint">
                WMTS 为瓦片服务图层，使用真实 TileMatrix（非 XYZ 硬编码）；不提供本地矢量属性表。
              </p>
            ) : null}
            {dataset?.kind === 'wfs' ? (
              <p className="config-hint">
                WFS 快照为只读本地矢量；支持筛选、专题样式、导出与复制为可编辑图层。明确刷新才替换快照；刷新失败保留原快照。复制编辑不触发 WFS-T。
              </p>
            ) : null}
          </>
        ) : (
          <div className="empty-state empty-state-box">请选择一个图层</div>
        )
      ) : null}

      {tab === 'style' ? (
        selectedLayerId && caps.canStyle ? (
          <>
            <StylePanel layerId={selectedLayerId} />
            <Legend layerId={selectedLayerId} />
          </>
        ) : (
          <div className="empty-state empty-state-box">
            {caps.canStyle ? '请选择一个图层' : caps.isService ? '服务影像图层不支持矢量样式面板' : '请选择一个图层'}
          </div>
        )
      ) : null}

      {tab === 'label' ? (
        selectedLayerId && caps.canLabel ? (
          <LabelPanel layerId={selectedLayerId} />
        ) : (
          <div className="empty-state empty-state-box">
            {caps.canLabel ? '请选择一个图层' : caps.isService ? '服务影像图层不支持标注面板' : '请选择一个图层'}
          </div>
        )
      ) : null}

      {tab === 'feature' && (feature ? <div className="inspector-card"><div className="card-title">要素属性</div>{Object.entries(feature.properties).map(([key, value]) => <div key={key} className="inspector-row"><span>{key}</span><strong>{value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</strong></div>)}{!Object.keys(feature.properties).length && <p>此要素没有数据属性。</p>}</div> : <div className="empty-state empty-state-box">{selection.featureIds.length > 1 ? `已选择 ${selection.featureIds.length} 个要素，请选择单个要素查看属性。` : '请选择单个要素查看属性。'}</div>)}
    </div>
  )
}
