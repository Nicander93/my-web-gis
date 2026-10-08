import { useState, type ReactNode } from 'react'
import {
  Check,
  Download,
  Filter,
  Layers2,
  MapPinned,
  MousePointer2,
  Move,
  PanelBottom,
  PanelRight,
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
import { ToolbarButton } from './ToolbarButton'
import { SnappingControl } from './SnappingControl'
import { projectCommands } from '@/app/commands/project.commands'
import { editCommands } from '@/app/commands/edit.commands'
import { mapCommands } from '@/app/commands/map.commands'
import {
  layerCommands,
  getLayerCapabilities
} from '@/app/commands/layer.commands'
import { processingCommands } from '@/app/commands/processing.commands'
import { viewCommands } from '@/app/commands/view.commands'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useSessionStore } from '@/stores/session.store'

const tabs = [
  ['map', '地图'],
  ['data', '数据'],
  ['edit', '编辑'],
  ['analysis', '分析'],
  ['view', '视图']
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
  const [tab, setTab] = useState<Tab>('map')
  const project = useProjectStore((state) => state.project)
  const browsedId = useProjectStore((state) => state.selectedLayerId)
  const selection = useProjectStore((state) => state.selection)
  useProjectStore((state) => state.featuresByDataset)
  const editLayerId = useWorkbenchStore((state) => state.editLayerId)
  const active = useWorkbenchStore((state) => state.activeTool)
  const browsed = project.layers.find((layer) => layer.id === browsedId)
  const target = project.layers.find((layer) => layer.id === editLayerId)
  const caps = getLayerCapabilities(browsedId)
  const canUndo = useProjectStore.getState().canUndoEdit()
  const canRedo = useProjectStore.getState().canRedoEdit()
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
            <button
              key={id}
              id={`workbench-tab-${id}`}
              type="button"
              role="tab"
              tabIndex={tab === id ? 0 : -1}
              aria-selected={tab === id}
              aria-controls="workbench-commands"
              onClick={() => setTab(id)}
            >
              {label}
            </button>
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
              <button type="button" onClick={editCommands.end}>
                结束编辑
              </button>
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
            disabled={!canUndo}
            onClick={editCommands.undo}
          />
          <ToolbarButton
            icon={Redo2}
            label="重做"
            disabled={!canRedo}
            onClick={editCommands.redo}
          />
          <ToolbarButton
            icon={Save}
            label="保存项目"
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
                active={active === 'pan'}
                onClick={mapCommands.pan}
              />
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
              <ToolbarButton
                icon={MapPinned}
                label="定位图层"
                disabled={!caps.exists}
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
                disabled={!selection.featureIds.length}
                onClick={mapCommands.clearSelection}
              />
            </Group>
            <Group label="查看">
              <ToolbarButton
                icon={Table2}
                label="属性表"
                disabled={!caps.canAttributeTable}
                onClick={() => layerCommands.openAttributeTable()}
              />
              <ToolbarButton
                icon={Settings2}
                label="图层属性"
                disabled={!caps.exists}
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
                disabled={!caps.canAttributeTable}
                onClick={() => layerCommands.openAttributeTable()}
              />
              <ToolbarButton
                icon={Filter}
                label="图层过滤"
                disabled={!caps.canFilter}
                onClick={() => layerCommands.openFilter()}
              />
              <ToolbarButton
                icon={Pencil}
                label="样式"
                disabled={!caps.canStyle}
                onClick={() => layerCommands.editStyle()}
              />
              <ToolbarButton
                icon={Tag}
                label="标注"
                disabled={!caps.canLabel}
                onClick={() => layerCommands.editLabel()}
              />
            </Group>
            <Group label="输出">
              <ToolbarButton
                icon={Download}
                label="导出图层"
                disabled={!caps.canExport}
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
                disabled={Boolean(editLayerId) || !caps.canEditGeometry}
                onClick={editCommands.begin}
              />
              <ToolbarButton
                icon={Check}
                label="结束编辑"
                disabled={!editLayerId}
                onClick={editCommands.end}
              />
            </Group>
            <Group label="几何">
              <ToolbarButton
                icon={Plus}
                label="绘制要素"
                disabled={!editLayerId}
                active={active.startsWith('draw-')}
                onClick={editCommands.draw}
              />
              <ToolbarButton
                icon={Pencil}
                label="修改几何"
                disabled={!editLayerId}
                active={active === 'modify'}
                onClick={editCommands.modify}
              />
              <ToolbarButton
                icon={Trash2}
                label="单击删除"
                disabled={!editLayerId}
                active={active === 'delete'}
                onClick={editCommands.deleteSelected}
              />
              <SnappingControl />
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
                disabled={!caps.canFilter}
                onClick={() => layerCommands.openFilter()}
              />
              <ToolbarButton
                icon={Table2}
                label="属性与统计"
                disabled={!caps.canAttributeTable}
                onClick={() => {
                  layerCommands.openAttributeTable()
                  if (browsedId)
                    useSessionStore
                      .getState()
                      .setAttributeTableState(browsedId, {
                        statisticsOpen: true
                      })
                }}
              />
            </Group>
          </>
        )}
        {tab === 'view' && (
          <>
            <Group label="面板">
              <ToolbarButton
                icon={Layers2}
                label="图层"
                onClick={viewCommands.toggleLayers}
              />
              <ToolbarButton
                icon={PanelRight}
                label="图层属性"
                onClick={viewCommands.toggleInspector}
              />
              <ToolbarButton
                icon={PanelBottom}
                label="属性表"
                onClick={viewCommands.toggleAttributeTable}
              />
            </Group>
            <Group label="布局">
              <ToolbarButton
                icon={Scan}
                label="专注地图"
                onClick={viewCommands.toggleFocusMode}
              />
              <ToolbarButton
                icon={RotateCcw}
                label="重置布局"
                onClick={viewCommands.resetLayout}
              />
            </Group>
          </>
        )}
      </div>
    </section>
  )
}
