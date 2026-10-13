import { useId } from 'react'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { layerCommands, getLayerCapabilities } from '@/app/commands/layer.commands'
import { AttributeTable } from './AttributeTable'

/** Each open layer retains its own drafts, filters, pagination and scroll state. */
export function AttributeTableHost() {
  const project = useProjectStore((state) => state.project)
  const activeId = useWorkbenchStore((state) => state.tableLayerId)
  const openIds = useWorkbenchStore((state) => state.tableLayerIds)
  const prefix = useId()
  const layers = openIds.flatMap((id) => {
    const layer = project.layers.find((item) => item.id === id)
    return layer ? [layer] : []
  })
  const picker = (
    <select className="table-target-picker" aria-label="属性表图层"
      value={activeId ?? ''}
      onChange={(event) => layerCommands.openAttributeTable(event.target.value)}>
      <option value="" disabled>选择图层</option>
      {project.layers.filter((layer) => getLayerCapabilities(layer.id).canAttributeTable)
        .map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
    </select>
  )
  return <div className="attribute-table-host">
    <div className="attribute-table-tab-bar">{picker}
    {layers.length > 0 && <div className="attribute-table-tabs" role="tablist" aria-label="打开的属性表">
      {layers.map((layer, index) => <div className="attribute-table-tab" key={layer.id}>
        <button type="button" role="tab" id={`${prefix}-tab-${index}`}
          aria-controls={`${prefix}-panel-${index}`} aria-selected={activeId === layer.id}
          tabIndex={activeId === layer.id ? 0 : -1}
          onClick={() => useWorkbenchStore.getState().bindTable(layer.id)}
          onKeyDown={(event) => {
            let next: number | undefined
            if (event.key === 'ArrowRight') next = (index + 1) % layers.length
            if (event.key === 'ArrowLeft') next = (index + layers.length - 1) % layers.length
            if (event.key === 'Home') next = 0
            if (event.key === 'End') next = layers.length - 1
            if (next === undefined) return
            event.preventDefault()
            useWorkbenchStore.getState().bindTable(layers[next].id)
            document.getElementById(`${prefix}-tab-${next}`)?.focus()
          }}>{layer.name}</button>
        <button type="button" aria-label={`关闭属性表 ${layer.name}`}
          onClick={() => useWorkbenchStore.getState().closeTable(layer.id)}>×</button>
      </div>)}
    </div>}</div>
    {layers.length === 0 ? <AttributeTable /> :
      layers.map((layer, index) => <div key={layer.id} role="tabpanel"
        id={`${prefix}-panel-${index}`} aria-labelledby={`${prefix}-tab-${index}`}
        className="attribute-table-tab-panel" hidden={activeId !== layer.id}>
        <AttributeTable layerId={layer.id} active={activeId === layer.id} />
      </div>)}
  </div>
}
