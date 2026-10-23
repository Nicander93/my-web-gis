import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Select, Segmented } from 'antd'
import { validateCesiumTilesetStyle } from '@desktop-webgis/cesium-scene-runtime'
import { PropertyField } from '@/components/ui/PropertyFields'

interface Props {
  value?: Record<string, unknown>
  fields?: string[]
  onChange(value: Record<string, unknown> | undefined): void
  onValidity(valid: boolean): void
}

/** The native JSON is authoritative; visual edits replace only the chosen expression. */
export function TilesetStyleDraft({ value, fields = [], onChange, onValidity }: Props) {
  const [mode, setMode] = useState('visual')
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2))
  const [error, setError] = useState('')
  const [field, setField] = useState<string>()
  const [comparison, setComparison] = useState('>=')
  const [operand, setOperand] = useState('0')
  const [color, setColor] = useState('#2f7655')
  const applied = useRef<string | undefined>(JSON.stringify(value))
  useEffect(() => {
    const incoming = JSON.stringify(value)
    if (incoming === applied.current) return
    applied.current = incoming
    setText(JSON.stringify(value ?? {}, null, 2)); setError(''); onValidity(true)
  }, [value])

  function update(next: string): void {
    setText(next)
    try {
      const parsed: unknown = JSON.parse(next)
      const result = validateCesiumTilesetStyle(parsed)
      if (!result.valid) throw new Error(result.error)
      const style = parsed as Record<string, unknown>
      applied.current = JSON.stringify(style)
      onChange(style); onValidity(true); setError('')
    } catch (reason) {
      onValidity(false); setError(reason instanceof Error ? reason.message : '样式无效')
    }
  }
  let draft = value ?? {}
  try { const parsed = JSON.parse(text); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) draft = parsed } catch { /* Keep the last valid visual representation while JSON is incomplete. */ }
  const expression = draft.color
  const conditions = expression && typeof expression === 'object' && 'conditions' in expression ? (expression as { conditions: unknown }).conditions : undefined
  const rules = Array.isArray(conditions) && conditions.every(row => Array.isArray(row) && row.length === 2 && row.every(item => typeof item === 'string')) ? conditions as string[][] : undefined
  const canEditColor = expression === undefined || typeof expression === 'string' || !!rules
  const availableFields = fields.filter(name => /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name))
  function writeColor(next: unknown): void { update(JSON.stringify({ ...draft, color: next }, null, 2)) }
  function updateRule(index: number, column: number, next: string): void {
    if (rules) writeColor({ ...(expression as object), conditions: rules.map((row, i) => i === index ? row.map((item, j) => j === column ? next : item) : row) })
  }
  return <section className="tileset-style-draft" aria-label="3D Tiles 原生样式">
    <Segmented aria-label="样式编辑方式" value={mode} options={[{ value: 'visual', label: '颜色与规则' }, { value: 'json', label: 'Style JSON' }]} onChange={setMode} />
    {error && <Alert type="error" showIcon title={error} />}
    {mode === 'json' ? <Input.TextArea aria-label="Cesium3DTileStyle JSON" spellCheck={false} autoSize={{ minRows: 10, maxRows: 24 }} value={text} onChange={event => update(event.target.value)} /> : <>
      {!canEditColor ? <Alert type="info" title="当前 color 使用复杂原生定义，请在 Style JSON 中编辑。其他配置会原样保留。" /> : <>
        <PropertyField label="基础色" alias="color"><Input aria-label="基础色（CSS）" value={color} onChange={event => setColor(event.target.value)} /><Button onClick={() => writeColor(`color(${JSON.stringify(color)})`)}>设置基础色</Button></PropertyField>
        {typeof expression === 'string' && <code>{expression}</code>}
        {rules?.map((row, index) => <div className="tileset-style-draft__rule" key={index}>
          <Input aria-label={`规则条件 ${index + 1}`} value={row[0]} onChange={event => updateRule(index, 0, event.target.value)} />
          <Input aria-label={`规则颜色 ${index + 1}`} value={row[1]} onChange={event => updateRule(index, 1, event.target.value)} />
          <Button danger aria-label={`删除规则 ${index + 1}`} onClick={() => writeColor({ ...(expression as object), conditions: rules.filter((_, i) => i !== index) })}>删除</Button>
        </div>)}
        <PropertyField label="属性字段" alias="Feature metadata"><Select aria-label="样式规则属性" value={field} options={availableFields.map(name => ({ value: name, label: name }))} onChange={setField} placeholder="先在画布中拾取构件" /></PropertyField>
        {!availableFields.length && <p className="editor-help">尚未取得可用的构件属性。先拾取有元数据的构件，或在 Style JSON 中编写原生表达式。</p>}
        <div className="tileset-style-draft__condition"><Select aria-label="规则比较" value={comparison} options={['>=', '>', '<=', '<', '===', '!=='].map(value => ({ value, label: value }))} onChange={setComparison} /><Input aria-label="规则比较值" value={operand} onChange={event => setOperand(event.target.value)} /><Button disabled={!field || !availableFields.includes(field)} onClick={() => {
          const literal = operand.trim() && Number.isFinite(Number(operand)) ? String(Number(operand)) : JSON.stringify(operand)
          const fallback = typeof expression === 'string' ? expression : 'color("white")'
          const next = [...(rules ?? [['true', fallback]])]
          const fallbackIndex = next.findIndex(row => row[0].trim() === 'true')
          next.splice(fallbackIndex < 0 ? next.length : fallbackIndex, 0, ['${' + field + '} ' + comparison + ' ' + literal, `color(${JSON.stringify(color)})`])
          writeColor({ ...(rules ? expression as object : {}), conditions: next })
        }}>添加属性规则</Button></div>
      </>}
    </>}
    <Button onClick={() => { applied.current = undefined; setText('{}'); setError(''); onValidity(true); onChange(undefined) }}>清除持久样式</Button>
    <p className="editor-help">原生 Cesium3DTileStyle；当前选择高亮不会写入工程。未识别的合法字段保留在 JSON 中。</p>
  </section>
}
