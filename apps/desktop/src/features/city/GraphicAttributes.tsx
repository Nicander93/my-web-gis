import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { GraphicNode } from '@desktop-webgis/cesium-scene-schema'
import { attributeRows, parseAttributeRows } from './graphic-attributes'
import type { AttributeRow, AttributeType } from './graphic-attributes'

export function GraphicAttributes({ node, onApply }: { node: GraphicNode; onApply(properties: Record<string, unknown>): void }) {
  const [rows, setRows] = useState(() => attributeRows(node.properties))
  const [error, setError] = useState('')
  function change(id: string, patch: Partial<AttributeRow>): void { setRows(rows.map(row => row.id === id ? { ...row, ...patch } : row)); setError('') }
  return <form className="city-property-section" onSubmit={event => { event.preventDefault(); try { onApply(parseAttributeRows(rows)); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '属性无效') } }}>
    <h3>对象属性 <span className="city-object-count">{rows.length}</span></h3><p className="editor-help">字段可用于标注和弹窗。编辑完成后统一应用。</p>
    <div className="city-attribute-editor">{rows.map((row, index) => <fieldset key={row.id}><legend>字段 {index + 1}</legend><div className="city-attribute-editor__header"><input aria-label={`字段名 ${index + 1}`} placeholder="字段名" value={row.name} onChange={event => change(row.id, { name: event.target.value })} /><select aria-label={`字段类型 ${index + 1}`} value={row.type} onChange={event => { const type = event.target.value as AttributeType; change(row.id, { type, value: type === 'boolean' ? 'false' : type === 'null' ? 'null' : row.value }) }}><option value="string">文本</option><option value="number">数字</option><option value="boolean">布尔</option><option value="null">空值</option><option value="json">JSON</option></select><button type="button" className="city-danger-action" aria-label={`移除属性 ${index + 1}`} onClick={() => setRows(rows.filter(item => item.id !== row.id))}><Trash2 size={14} aria-hidden="true" /></button></div>
      {row.type === 'boolean' ? <select aria-label={`字段值 ${index + 1}`} value={row.value} onChange={event => change(row.id, { value: event.target.value })}><option value="true">true</option><option value="false">false</option></select> : row.type === 'json' ? <textarea aria-label={`字段值 ${index + 1}`} value={row.value} spellCheck={false} onChange={event => change(row.id, { value: event.target.value })} /> : <input aria-label={`字段值 ${index + 1}`} placeholder={row.type === 'null' ? 'null' : '字段值'} disabled={row.type === 'null'} type={row.type === 'number' ? 'number' : 'text'} step="any" value={row.value} onChange={event => change(row.id, { value: event.target.value })} />}
    </fieldset>)}</div>
    <button className="city-text-action" type="button" onClick={() => setRows([...rows, { id: crypto.randomUUID(), name: '', type: 'string', value: '' }])}><Plus size={14} aria-hidden="true" />添加属性</button>
    {error && <p className="editor-error" role="alert">{error}</p>}<button className="button-primary" type="submit">应用属性</button>
  </form>
}
