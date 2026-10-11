import type { PopupDefinition } from '@desktop-webgis/scene-schema'
import { layerCommands } from '@/app/commands/layer.commands'

/** Field choices are applied as one scene command; clearing all fields removes the popup. */
export function PopupFields({ layerId, fields, popup }: { layerId: string; fields: string[]; popup?: PopupDefinition }) {
  const available = [...new Set([...fields, ...(popup?.fields.map(field => field.field) ?? []), ...(popup?.titleField ? [popup.titleField] : [])])]
  return <details className="inspector-popup">
    <summary>属性弹窗 <span>{popup ? `${popup.fields.length} 个字段` : '未配置'}</span></summary>
    <label className="inspector-row">
      <span>标题字段</span>
      <select aria-label="弹窗标题字段" disabled={!popup} value={popup?.titleField ?? ''}
        onChange={event => {
          if (!popup) return
          const { titleField, ...definition } = popup
          layerCommands.setPopup(layerId, event.target.value ? { ...definition, titleField: event.target.value } : definition)
        }}>
        <option value="">图层名称</option>
        {available.map(field => <option key={field} value={field}>{field}</option>)}
      </select>
    </label>
    {available.map(field => <label className="inspector-row" key={field}>
      <span>{field}</span>
      <input type="checkbox" aria-label={`弹窗显示字段 ${field}`} checked={popup?.fields.some(item => item.field === field) ?? false}
        onChange={event => layerCommands.setPopup(layerId, {
          ...(popup?.titleField ? { titleField: popup.titleField } : {}),
          fields: event.target.checked ? [...(popup?.fields ?? []), { field }] : (popup?.fields ?? []).filter(item => item.field !== field)
        })} />
    </label>)}
  </details>
}
