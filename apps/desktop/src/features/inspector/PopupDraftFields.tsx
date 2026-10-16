import { Checkbox, Input, Select, Switch } from 'antd'
import type { PopupDefinition } from '@desktop-webgis/scene-schema'

/** All changes remain in the parent window's draft until Apply or OK. */
export function PopupDraftFields({ popup, fields, onChange }: { popup?: PopupDefinition; fields: string[]; onChange(popup: PopupDefinition | undefined): void }) {
  const available = [...new Set([...fields, ...(popup?.fields.map(item => item.field) ?? []), ...(popup?.titleField ? [popup.titleField] : [])])]
  return <div className="scene-property-window__json">
    <label className="scene-property-window__field"><span>启用属性弹窗<small>interaction.popup</small></span><Switch aria-label="启用属性弹窗" checked={!!popup} onChange={enabled => onChange(enabled ? { fields: [] } : undefined)} /></label>
    {popup && <>
      <label className="scene-property-window__field"><span>标题字段<small>popup.titleField</small></span><Select aria-label="弹窗标题字段" value={popup.titleField} allowClear options={available.map(field => ({ value: field, label: field }))} onChange={value => {
        const { titleField: _previous, ...definition } = popup
        onChange(value ? { ...definition, titleField: value } : definition)
      }} /></label>
      <span>显示字段</span><Checkbox.Group aria-label="弹窗显示字段" options={available.map(field => ({ value: field, label: field }))} value={popup.fields.map(item => item.field)} onChange={values => onChange({ ...popup, fields: values.map(value => popup.fields.find(item => item.field === value) ?? { field: String(value) }) })} />
      {!available.length && <p>此数据集没有可用的属性字段。</p>}
      {popup.fields.map(item => <label key={item.field} className="scene-property-window__field"><span>{item.field}<small>显示名称</small></span><Input aria-label={`弹窗字段标签 ${item.field}`} value={item.label ?? ''} onChange={event => onChange({ ...popup, fields: popup.fields.map(field => field.field === item.field ? { ...field, label: event.target.value } : field) })} /></label>)}
    </>}
  </div>
}
