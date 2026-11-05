import { requireMapContent } from '@desktop-webgis/project'
import { Select, Tabs, theme } from 'antd'
import { useContext } from 'react'
import { createPortal } from 'react-dom'
import { DockHeaderContext } from '@/ui/components/DockHeaderContext'
import { useProjectStore } from '@/project/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { layerCommands, getLayerCapabilities } from '@/commands/layer.commands'
import { AttributeTable } from './AttributeTable'

/** 每个打开的图层各自保留草稿、过滤条件、分页和滚动状态。 */
export function AttributeTableHost() {
  const header = useContext(DockHeaderContext)
  const { hashId } = theme.useToken()
  const project = useProjectStore((state) => state.project)
  const activeId = useWorkbenchStore((state) => state.tableLayerId)
  const openIds = useWorkbenchStore((state) => state.tableLayerIds)
  const layers = openIds.flatMap((id) => {
    const layer = requireMapContent(project).layers.find((item) => item.id === id)
    return layer ? [layer] : []
  })
  const picker = <Select className="table-target-picker" aria-label="属性表图层" style={{ width: 150 }}
    value={activeId ?? undefined} placeholder="选择图层" virtual={false} showSearch={{ optionFilterProp: 'label' }}
    onChange={(id) => layerCommands.openAttributeTable(id)}
    options={requireMapContent(project).layers.filter((layer) => getLayerCapabilities(layer.id).canAttributeTable)
      .map((layer) => ({ value: layer.id, label: layer.name }))} />
  return <div className="attribute-table-host">
    {layers.length === 0 ? <><div className="attribute-table-tab-bar">{picker}</div><AttributeTable /></> :
      <Tabs className="attribute-table-ant-tabs" type="editable-card" hideAdd activeKey={activeId ?? undefined}
        renderTabBar={(props, DefaultTabBar) => header ? createPortal(<div className={`ant-tabs ant-tabs-top ant-tabs-small ant-tabs-card ${hashId}`}><DefaultTabBar {...props} /></div>, header) : <DefaultTabBar {...props} />}
        destroyOnHidden={false}
        onChange={(id) => useWorkbenchStore.getState().bindTable(id)}
        onEdit={(key, action) => {
          if (action === 'remove' && typeof key === 'string') useWorkbenchStore.getState().closeTable(key)
        }} items={layers.map((layer) => ({
          key: layer.id, label: layer.name, closable: true, forceRender: true,
          closeIcon: <span aria-label={`关闭属性表 ${layer.name}`}>×</span>,
          children: <div className="attribute-table-tab-panel" hidden={activeId !== layer.id}>
            <AttributeTable layerId={layer.id} active={activeId === layer.id} />
          </div>
        }))} />}
  </div>
}
