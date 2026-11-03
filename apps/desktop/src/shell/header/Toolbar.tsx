import { useEditHistory } from '@/session/project-edits'
import { useFeatureEditState, useFeaturesByDataset } from '@/data/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { useState, type ReactNode } from 'react'
import { Button } from 'antd'
import {
  Check,
  Download,
  Filter,
  Info,
  MapPinned,
  MousePointer2,
  Move,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Scan,
  Settings2,
  Shapes,
  Table2,
  Tag,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { ToolbarButton } from '@/ui/ToolbarButton'
import { SnappingControl } from './SnappingControl'
import { PolygonEditControls } from '@/features/editing/PolygonEditControls'
import { projectCommands } from '@/commands/project.commands'
import { editCommands } from '@/commands/edit.commands'
import { mapCommands } from '@/commands/map.commands'
import {
  layerCommands,
  getLayerCapabilities
} from '@/commands/layer.commands'
import { processingCommands } from '@/commands/processing.commands'
import { useProjectStore } from '@/session/project.store'
import { useWorkbenchStore } from '@/view-state/workbench.store'
import { useLayerViewStore } from '@/view-state/layer-view.store'
import { useSaveStore } from '@/session/save.store'

const tabs = [
  ['map', '地图'],
  ['edit', '编辑'],
  ['data', '数据'],
  ['analysis', '分析']
] as const
type Tab = (typeof tabs)[number][0]
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="workbench-ribbon-group" role="group" aria-label={label}>
      {children}
    </div>
  )
}

/** 两行任务功能区；低频命令由菜单与图层上下文菜单提供。 */
export function Toolbar() {
  const saving = useSaveStore((state) => state.pending > 0)
  const [tab, setTab] = useState<Tab>('map')
  const project = useProjectStore((state) => state.project)
  const browsedId = useLayerViewStore((state) => state.selectedLayerId)
  const selection = useLayerViewStore((state) => state.selection)
  useFeaturesByDataset()
  const editLayerId = useWorkbenchStore((state) => state.editLayerId)
  const active = useWorkbenchStore((state) => state.activeTool)
  const identifying = useWorkbenchStore(state => state.identifyActive)
  const browsed = requireMapContent(project).layers.find((layer) => layer.id === browsedId)
  const target = requireMapContent(project).layers.find((layer) => layer.id === editLayerId)
  const caps = getLayerCapabilities(browsedId)
  const { canUndo, canRedo } = useEditHistory()
  const editState = useFeatureEditState()
  const dataLayer = target ?? browsed
  const datasetPending = dataLayer ? editState.datasets.find(dataset => dataset.datasetId === dataLayer.datasetId)?.pendingCount ?? 0 : 0
  const dataBusy = editState.saving
  return (
    <section className="workbench-ribbon" aria-label="二维功能区">
      <div className="workbench-ribbon-top">
        <nav
          role="tablist"
          aria-label="工作任务"
          onKeyDown={(event) => {
            if (
              (event.target as HTMLElement).getAttribute('role') !== 'tab' ||
              !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
            )
              return
            const index = tabs.findIndex(([id]) => id === tab)
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? tabs.length - 1
                  : (index +
                      (event.key === 'ArrowRight' ? 1 : -1) +
                      tabs.length) %
                    tabs.length
            event.preventDefault()
            setTab(tabs[next][0])
            document.getElementById(`workbench-tab-${tabs[next][0]}`)?.focus()
          }}
        >
          {tabs.map(([id, label]) => (
            <Button
              key={id}
              id={`workbench-tab-${id}`}
              type="text" htmlType="button"
              role="tab"
              tabIndex={tab === id ? 0 : -1}
              aria-selected={tab === id}
              aria-controls="workbench-commands"
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </nav>
        <div
          className="workbench-context"
          title={
            target
              ? `编辑目标已锁定：${target.name}；浏览其他图层不会切换编辑目标`
              : browsed?.name
          }
        >
          {target ? (
            <>
              <span className="editing-badge">编辑中</span>
              <strong>{target.name}</strong>
              <Button type="text" htmlType="button" onClick={editCommands.end}>
                结束编辑
              </Button>
            </>
          ) : (
            <>
              <span>当前图层</span>
              <strong>{browsed?.name ?? '未选择'}</strong>
            </>
          )}
        </div>
        <div className="workbench-quick">
          <ToolbarButton
            icon={Undo2}
            label="撤销"
            disabled={!canUndo} disabledReason="没有可撤销的编辑记录"
            onClick={editCommands.undo}
          />
          <ToolbarButton
            icon={Redo2}
            label="重做"
            disabled={!canRedo} disabledReason="没有可重做的编辑记录"
            onClick={editCommands.redo}
          />
          <ToolbarButton
            icon={Save}
            label="保存项目"
            disabled={saving} disabledReason="正在保存项目，请稍候" loading={saving}
            onClick={projectCommands.saveProject}
          />
        </div>
      </div>
      <div
        className="workbench-ribbon-commands"
        id="workbench-commands"
        role="tabpanel"
        aria-labelledby={`workbench-tab-${tab}`}
      >
        {tab === 'map' && (
          <>
            <Group label="导航">
              <ToolbarButton
                icon={Move}
                label="平移"
                active={active === 'pan' && !identifying}
                onClick={mapCommands.pan}
              />
              <ToolbarButton icon={Info} label="识别" active={identifying} onClick={mapCommands.identify} />
              <ToolbarButton
                icon={ZoomIn}
                label="放大"
                onClick={mapCommands.zoomIn}
              />
              <ToolbarButton
                icon={ZoomOut}
                label="缩小"
                onClick={mapCommands.zoomOut}
              />
              <ToolbarButton
                icon={Scan}
                label="全图"
                onClick={mapCommands.zoomToAll}
              />
              <ToolbarButton icon={MapPinned} label="设为初始视角" onClick={mapCommands.setInitialView} />
              <ToolbarButton
                icon={MapPinned}
                label="定位图层"
                disabled={!caps.exists} disabledReason="请先选择图层"
                onClick={() => layerCommands.zoomToLayer()}
              />
            </Group>
            <Group label="选择">
              <ToolbarButton
                icon={MousePointer2}
                label="选择要素"
                active={active === 'select'}
                onClick={mapCommands.select}
              />
              <ToolbarButton
                icon={RotateCcw}
                label="清除选择"
                disabled={!selection.featureIds.length} disabledReason="当前没有选中要素"
                onClick={mapCommands.clearSelection}
              />
            </Group>
            <Group label="查看">
              <ToolbarButton
                icon={Table2}
                label="属性表"
                disabled={!caps.canAttributeTable} disabledReason="请先选择支持属性表的数据图层"
                onClick={() => layerCommands.openAttributeTable()}
              />
              <ToolbarButton
                icon={Settings2}
                label="图层属性"
                disabled={!caps.exists} disabledReason="请先选择图层"
                onClick={() => layerCommands.properties()}
              />
            </Group>
          </>
        )}
        {tab === 'data' && (
          <>
            <Group label="导入">
              <ToolbarButton
                icon={Plus}
                label="添加数据"
                onClick={projectCommands.addData}
              />
            </Group>
            <Group label="图层">
              <ToolbarButton
                icon={Table2}
                label="属性表"
                disabled={!caps.canAttributeTable} disabledReason="请先选择支持属性表的数据图层"
                onClick={() => layerCommands.openAttributeTable()}
              />
              <ToolbarButton
                icon={Filter}
                label="图层过滤"
                disabled={!caps.canFilter} disabledReason="请先选择支持字段过滤的矢量图层"
                onClick={() => layerCommands.openFilter()}
              />
              <ToolbarButton
                icon={Pencil}
                label="样式"
                disabled={!caps.canStyle} disabledReason="当前图层不支持样式编辑，请选择可配置样式的图层"
                onClick={() => layerCommands.editStyle()}
              />
              <ToolbarButton
                icon={Tag}
                label="标注"
                disabled={!caps.canLabel} disabledReason="请先选择支持标注的矢量图层"
                onClick={() => layerCommands.editLabel()}
              />
            </Group>
            <Group label="输出">
              <ToolbarButton
                icon={Save}
                label="保存数据"
                disabled={!datasetPending || dataBusy} disabledReason={!dataLayer ? '请先选择图层' : dataBusy ? '正在保存数据，请稍候' : '当前数据源没有未提交编辑'}
                loading={dataBusy}
                onClick={() => { void layerCommands.saveData(dataLayer?.id) }}
              />
              <ToolbarButton
                icon={RotateCcw}
                label="放弃数据"
                disabled={!datasetPending || dataBusy} disabledReason={!dataLayer ? '请先选择图层' : dataBusy ? '正在保存数据，请稍候' : '当前数据源没有未提交编辑'}
                onClick={() => layerCommands.discardData(dataLayer?.id)}
              />
              <ToolbarButton
                icon={Download}
                label="导出图层"
                disabled={!caps.canExport} disabledReason="请先选择支持导出的数据图层"
                onClick={() => layerCommands.export()}
              />
            </Group>
          </>
        )}
        {tab === 'edit' && (
          <>
            <Group label="目标">
              <ToolbarButton
                icon={Pencil}
                label="开始编辑"
                disabled={Boolean(editLayerId) || !caps.canEditGeometry} disabledReason={editLayerId ? "已有编辑会话，请先结束当前编辑" : "请先选择未锁定且支持几何编辑的图层"}
                onClick={editCommands.begin}
              />
              <ToolbarButton
                icon={Check}
                label="结束编辑"
                disabled={!editLayerId} disabledReason="请先开始编辑并固定编辑目标"
                onClick={editCommands.end}
              />
              <ToolbarButton
                icon={Save}
                label="保存数据"
                disabled={!datasetPending || dataBusy} disabledReason={!dataLayer ? '请先选择图层' : dataBusy ? '正在保存数据，请稍候' : '当前数据源没有未提交编辑'}
                loading={dataBusy}
                onClick={() => { void layerCommands.saveData(dataLayer?.id) }}
              />
              <ToolbarButton
                icon={RotateCcw}
                label="放弃数据"
                disabled={!datasetPending || dataBusy} disabledReason={!dataLayer ? '请先选择图层' : dataBusy ? '正在保存数据，请稍候' : '当前数据源没有未提交编辑'}
                onClick={() => layerCommands.discardData(dataLayer?.id)}
              />
            </Group>
            <Group label="几何">
              <ToolbarButton
                icon={Plus}
                label="绘制要素"
                disabled={!editLayerId} disabledReason="请先开始编辑并固定编辑目标"
                active={active.startsWith('draw-')}
                onClick={editCommands.draw}
              />
              <ToolbarButton
                icon={Pencil}
                label="修改几何"
                disabled={!editLayerId} disabledReason="请先开始编辑并固定编辑目标"
                active={active === 'modify'}
                onClick={editCommands.modify}
              />
              <ToolbarButton
                icon={Trash2}
                label="单击删除"
                disabled={!editLayerId} disabledReason="请先开始编辑并固定编辑目标"
                active={active === 'delete'}
                onClick={editCommands.deleteSelected}
              />
              <SnappingControl />
              <PolygonEditControls />
            </Group>
          </>
        )}
        {tab === 'analysis' && (
          <>
            <Group label="处理">
              <ToolbarButton
                icon={Shapes}
                label="空间处理"
                onClick={processingCommands.open}
              />
            </Group>
            <Group label="数据检查">
              <ToolbarButton
                icon={Filter}
                label="图层过滤"
                disabled={!caps.canFilter} disabledReason="请先选择支持字段过滤的矢量图层"
                onClick={() => layerCommands.openFilter()}
              />
              <ToolbarButton
                icon={Table2}
                label="属性与统计"
                disabled={!caps.canAttributeTable} disabledReason="请先选择支持属性表的数据图层"
                onClick={() => {
                  layerCommands.openAttributeTable()
                  if (browsedId)
                    useLayerViewStore
                      .getState()
                      .setAttributeTableState(browsedId, {
                        statisticsOpen: true
                      })
                }}
              />
            </Group>
          </>
        )}

      </div>
    </section>
  )
}
