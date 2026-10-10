import { useEffect } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useSessionStore } from '@/stores/session.store'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { layerCommands } from '@/app/commands/layer.commands'
import { capabilitiesForDataset } from '@desktop-webgis/gis-core'
import { StylePanel } from './StylePanel'
import { LabelPanel } from './LabelPanel'
import { Legend } from './Legend'
import { getLayerCapabilities } from '@/app/commands/layer.commands'
import { processingToolName } from '@/features/processing/processing-tools'

type InspectorTab = 'layer' | 'feature' | 'style' | 'label'

export function Inspector() {
  const selectedLayerId = useWorkbenchStore((state) => state.inspectorLayerId)
  const selection = useProjectStore((state) => state.selection)
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  const getNormalizedLayerStyle = useProjectStore(
    (state) => state.getNormalizedLayerStyle
  )
  const setLayerOpacity = useProjectStore((state) => state.setLayerOpacity)
  const ensureStyleDraft = useSessionStore((state) => state.ensureStyleDraft)
  const setTab = useSessionStore((state) => state.setInspectorTab)

  const layerId = selectedLayerId || 'no-layer'
  const session = useSessionStore((state) => state.sessions[layerId])
  const tab: InspectorTab = session?.inspector?.activeTab ?? 'layer'

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

  const geometryTypes = new Set(
    selectedLayer
      ? (featuresByDataset[selectedLayer.datasetId] ?? []).map(
          (feature) => feature.geometry.type
        )
      : []
  )
  const geometryType =
    geometryTypes.size === 1
      ? [...geometryTypes][0]
      : geometryTypes.size > 1
        ? 'Mixed'
        : '—'
  const flags = capabilitiesForDataset(dataset)
  const selectedFeature =
    selectedLayer &&
    selection.layerId === selectedLayerId &&
    selection.featureIds.length === 1
      ? featuresByDataset[selectedLayer.datasetId]?.find(
          (feature) => feature.id === selection.featureIds[0]
        )
      : null

  useEffect(() => {
    if (!selectedLayerId) return
    if (!flags.style) return
    const applied = getNormalizedLayerStyle(selectedLayerId)
    if (applied) {
      ensureStyleDraft(selectedLayerId, applied)
    }
  }, [selectedLayerId, getNormalizedLayerStyle, ensureStyleDraft, flags.style])

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
              <div className="card-title">图层概览</div>
              <div className="inspector-row">
                <span>名称</span>
                <strong>{selectedLayer.name}</strong>
              </div>
              <div className="inspector-row">
                <span>数据源</span>
                <strong>
                  {dataset
                    ? {
                        vector: '本地矢量',
                        wfs: 'WFS 只读快照',
                        wms: 'WMS 影像',
                        wmts: 'WMTS 瓦片'
                      }[dataset.kind]
                    : '—'}
                </strong>
              </div>
              {dataset?.kind === 'vector' && dataset.processing && (
                <details className="processing-provenance">
                  <summary>处理来源</summary>
                  <p>输入图层：{dataset.processing.sourceLayerName}</p>
                  <p>
                    工具：{processingToolName(dataset.processing.options.tool)}
                  </p>
                  <p>
                    范围：
                    {
                      {
                        all: '全部要素',
                        filtered: '图层筛选结果',
                        selected: '当前选中要素'
                      }[dataset.processing.scope]
                    }
                  </p>
                  {dataset.processing.options.tool === 'buffer' && (
                    <p>
                      距离：{dataset.processing.options.distance}{' '}
                      {dataset.processing.options.unit === 'meters'
                        ? '米'
                        : '千米'}
                    </p>
                  )}
                  <p>
                    {dataset.processing.inputCount} 个输入 →{' '}
                    {dataset.processing.outputCount} 个结果
                  </p>
                  {dataset.processing.options.tool === 'dissolve' && (
                    <p>分组：{dataset.processing.options.field || '不分组'}</p>
                  )}
                  {dataset.processing.options.tool === 'extract-location' && (
                    <p>
                      关系：
                      {
                        {
                          intersects: '相交（包括边界）',
                          within: '完全位于其中',
                          disjoint: '不相交'
                        }[dataset.processing.options.predicate]
                      }
                    </p>
                  )}
                  {dataset.processing.options.tool === 'summarize-location' && (
                    <p>
                      统计：
                      {dataset.processing.options.predicate === 'within'
                        ? '完全位于区域内'
                        : '相交（含边界）'}
                      ；{dataset.processing.options.field || '仅数量'}；前缀{' '}
                      {dataset.processing.options.prefix || '无'}
                    </p>
                  )}
                  {dataset.processing.options.tool === 'attribute-join' && (
                    <p>
                      连接：{dataset.processing.options.inputKey} →{' '}
                      {dataset.processing.options.joinKey}；
                      {dataset.processing.options.mode === 'left'
                        ? '保留全部输入'
                        : '仅匹配输入'}
                      ；带入 {dataset.processing.options.fields.join('、')}
                      ；前缀 {dataset.processing.options.prefix || '无'}
                    </p>
                  )}
                  {dataset.processing.options.tool === 'spatial-join' && (
                    <p>
                      空间连接：
                      {dataset.processing.options.predicate === 'within'
                        ? '完整位于其中'
                        : '相交（含边界）'}
                      ；
                      {dataset.processing.options.mode === 'left'
                        ? '保留全部输入'
                        : '仅匹配输入'}
                      ；带入 {dataset.processing.options.fields.join('、')}
                      ；前缀 {dataset.processing.options.prefix || '无'}
                    </p>
                  )}
                  {(dataset.processing.options.tool === 'measure-area' ||
                    dataset.processing.options.tool === 'measure-length' ||
                    dataset.processing.options.tool ===
                      'measure-perimeter') && (
                    <p>
                      测量字段：{dataset.processing.options.field}；单位：
                      {dataset.processing.options.unit}；WGS84 球面 XY
                      模型，不含高程。
                    </p>
                  )}
                  {dataset.processing.options.tool === 'calculate-field' && (
                    <p>
                      字段：{dataset.processing.options.field}；表达式：
                      {dataset.processing.options.expression}
                    </p>
                  )}
                  {dataset.processing.overlay && (
                    <>
                      <p>第二输入：{dataset.processing.overlay.layerName}</p>
                      <p>
                        第二范围：
                        {
                          {
                            all: '全部要素',
                            filtered: '图层筛选结果',
                            selected: '当前选中要素'
                          }[dataset.processing.overlay.scope]
                        }
                        （{dataset.processing.overlay.inputCount} 个要素）
                      </p>
                    </>
                  )}
                  <p>
                    完成时间：
                    {new Date(dataset.processing.completedAt).toLocaleString()}
                  </p>
                </details>
              )}
              <details className="property-section">
                <summary>数据源与几何信息</summary>
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
                          ? dataset.source.bboxWgs84
                              .map((n) => n.toFixed(2))
                              .join(', ')
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
                      <strong>
                        {dataset.source.projection ||
                          dataset.source.supportedCrs ||
                          '—'}
                      </strong>
                    </div>
                    <div className="inspector-row">
                      <span>编码</span>
                      <strong>{dataset.source.requestEncoding}</strong>
                    </div>
                    <div className="inspector-row">
                      <span>矩阵级数</span>
                      <strong>
                        {dataset.source.tileMatrices?.length ?? 0}
                      </strong>
                    </div>
                    <div className="inspector-row">
                      <span>范围</span>
                      <strong>
                        {dataset.source.bboxWgs84
                          ? dataset.source.bboxWgs84
                              .map((n) => n.toFixed(2))
                              .join(', ')
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
                          ? dataset.source.queryExtentWgs84
                              .map((n) => n.toFixed(2))
                              .join(', ')
                          : dataset.source.extentMode === 'full'
                            ? '全范围'
                            : '—'}
                      </strong>
                    </div>
                    <div className="inspector-row">
                      <span>来源</span>
                      <strong title={dataset.source.url}>
                        {dataset.source.url}
                      </strong>
                    </div>
                    <div className="inspector-row">
                      <span>只读快照</span>
                      <strong>
                        是（复制为本地图层后可编辑；不触发 WFS-T）
                      </strong>
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
              </details>
              <div className="inspector-row inspector-opacity-row">
                <span>不透明度</span>
                <label className="inspector-opacity">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(selectedLayer.opacity * 100)}
                    onChange={(e) =>
                      setLayerOpacity(
                        selectedLayerId,
                        Number(e.target.value) / 100
                      )
                    }
                  />
                  <strong>{Math.round(selectedLayer.opacity * 100)}%</strong>
                </label>
              </div>
            </div>
            {caps.canStyle ? (
              <details className="property-section">
                <summary>图例预览</summary>
                <Legend layerId={selectedLayerId} />
              </details>
            ) : null}
            {dataset?.kind === 'wms' ? (
              <p className="config-hint">
                WMS 影像图层支持显示与透明度设置，没有本地要素属性。
              </p>
            ) : null}
            {dataset?.kind === 'wmts' ? (
              <p className="config-hint">
                WMTS 瓦片图层支持显示与透明度设置，没有本地要素属性。
              </p>
            ) : null}
            {dataset?.kind === 'wfs' ? (
              <p className="config-hint">
                此图层是只读服务快照。要编辑，请从图层菜单复制为本地图层；需要最新数据时手动刷新。
              </p>
            ) : null}
          </>
        ) : (
          <div className="workbench-empty">
            <Settings2 size={24} />
            <strong>选择配置对象</strong>
            <p>从图层的更多菜单打开属性、样式或标注。</p>
          </div>
        )
      ) : null}

      {tab === 'style' ? (
        selectedLayerId && caps.canStyle ? (
          <>
            <StylePanel layerId={selectedLayerId} />
            <details className="property-section">
              <summary>图例预览</summary>
              <Legend layerId={selectedLayerId} />
            </details>
          </>
        ) : (
          <div className="empty-state empty-state-box">
            {caps.canStyle
              ? '请选择一个图层'
              : caps.isService
                ? '服务影像图层不支持矢量样式面板'
                : '请选择一个图层'}
          </div>
        )
      ) : null}

      {tab === 'label' ? (
        selectedLayerId && caps.canLabel ? (
          <LabelPanel layerId={selectedLayerId} />
        ) : (
          <div className="empty-state empty-state-box">
            {caps.canLabel
              ? '请选择一个图层'
              : caps.isService
                ? '服务影像图层不支持标注面板'
                : '请选择一个图层'}
          </div>
        )
      ) : null}

      {tab === 'feature' ? (
        <section className="inspector-card">
          {selectedFeature ? (
            <>
              <div className="card-title">要素 {selectedFeature.id}</div>
              <dl className="feature-properties">
                {Object.entries(selectedFeature.properties).map(
                  ([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>
                        {value == null
                          ? '—'
                          : typeof value === 'object'
                            ? JSON.stringify(value)
                            : String(value)}
                      </dd>
                    </div>
                  )
                )}
              </dl>
            </>
          ) : (
            <p>在此图层中选择一个要素，查看属性。</p>
          )}
          {caps.canAttributeTable && (
            <Button
              variant="ghost"
              onClick={() => layerCommands.openAttributeTable(selectedLayerId)}
            >
              打开此图层属性表
            </Button>
          )}
        </section>
      ) : null}
    </div>
  )
}
