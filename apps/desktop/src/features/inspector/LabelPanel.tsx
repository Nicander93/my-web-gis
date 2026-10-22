import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, ColorPicker, InputNumber, Select, Switch } from 'antd'
import type { LabelConfig } from '@desktop-webgis/ol-style'
import { colorToString, rgb } from '@desktop-webgis/ol-style'
import { listAttributeFields, withLabel } from './style-draft'
import { useCartographyEditor } from './useCartographyEditor'
import './cartography-editor.css'
import { SymbolEditor } from './SymbolEditor'

interface LabelPanelProps {
  layerId: string
}

function defaultLabel(field = ''): LabelConfig {
  return {
    field,
    fontSize: 12,
    color: rgb(0, 0, 0),
    strokeColor: rgb(255, 255, 255),
    strokeWidth: 2,
    offsetX: 0,
    offsetY: 0
  }
}

function pickerColor(color: { toRgb(): { r: number; g: number; b: number; a: number } }) {
  return color.toRgb()
}

export function LabelPanel({ layerId }: LabelPanelProps) {
  const [open, setOpen] = useState(false)
  const editor = useCartographyEditor(layerId)
  useEffect(() => { setOpen(false) }, [layerId])
  return <>
    {editor.fragment && <Button size="small" disabled={editor.locked} onClick={() => setOpen(true)}>专业标注编辑…</Button>}
    <LabelPanelBody layerId={layerId} />
    {open && <SymbolEditor layerId={layerId} initialType="symbol" onClose={() => setOpen(false)} />}
  </>
}

function LabelPanelBody({ layerId }: LabelPanelProps) {
  const editor = useCartographyEditor(layerId)
  const fields = useMemo(() => listAttributeFields(editor.features), [editor.features])

  if (!editor.layer || !editor.style) return <div className="empty-state empty-state-box">请选择一个图层</div>
  if (!editor.editable) {
    return (
      <div className="inspector-card cartography-editor label-panel">
        <div className="cartography-editor__heading">标注</div>
        <Alert
          type="info"
          showIcon
          message={editor.locked ? '图层已锁定' : editor.fragment ? '高级标准样式为只读' : '当前图层不支持矢量样式编辑'}
          description={editor.locked ? '请先解锁图层或所属文件夹，再编辑标注。' : editor.fragment
            ? '当前样式无法由兼容面板无损编辑。标注配置保持原样，本面板不会覆盖未知表达式。'
            : '标准矢量标注样式绑定仅适用于矢量数据图层。'}
        />
      </div>
    )
  }

  const style = editor.style
  const enabled = Boolean(style.label?.field)
  const label = style.label ?? defaultLabel(fields[0] ?? '')

  function updateLabel(partial: Partial<LabelConfig>, property: string) {
    editor.updateStyle(withLabel(style, { ...label, ...partial }), `label.${property}`)
  }

  function begin(property: string) {
    editor.updateStyle(style, `label.${property}`)
  }

  return (
    <div className="inspector-card cartography-editor label-panel">
      <div className="cartography-editor__heading">标注</div>
      {editor.error ? <Alert type="error" message={editor.error} /> : null}
      <section className="cartography-editor__section">
        <div className="cartography-editor__section-title">文字标注</div>
        <div className="cartography-editor__controls">
          <label className="cartography-editor__switch">
            <span>启用标注</span>
            <Switch
              checked={enabled}
              onChange={checked => {
                editor.finish()
                editor.updateStyle(withLabel(style, checked ? defaultLabel(fields[0] ?? 'name') : undefined))
              }}
            />
          </label>
          <label className="cartography-editor__field">
            <span>标注字段</span>
            <Select
              aria-label="标注字段"
              disabled={!enabled}
              value={label.field || undefined}
              placeholder="选择字段"
              options={fields.map(field => ({ value: field, label: field }))}
              onChange={field => { editor.finish(); updateLabel({ field }, 'field') }}
            />
          </label>
          <label className="cartography-editor__field">
            <span>字号（px）</span>
            <InputNumber
              aria-label="标注字号"
              disabled={!enabled}
              min={6}
              max={72}
              value={label.fontSize ?? 12}
              onFocus={() => begin('fontSize')}
              onChange={value => { if (value !== null) updateLabel({ fontSize: value }, 'fontSize') }}
              onBlur={editor.finish}
            />
          </label>
          <label className="cartography-editor__field">
            <span>文字颜色</span>
            <ColorPicker
              aria-label="标注文字颜色"
              disabled={!enabled}
              value={colorToString(label.color ?? rgb(0, 0, 0))}
              showText
              format="rgb"
              onOpenChange={open => { if (open) begin('color'); else editor.finish() }}
              onChange={color => updateLabel({ color: pickerColor(color) }, 'color')}
            />
          </label>
          <label className="cartography-editor__field">
            <span>描边颜色</span>
            <ColorPicker
              aria-label="标注描边颜色"
              disabled={!enabled}
              value={colorToString(label.strokeColor ?? rgb(255, 255, 255))}
              showText
              format="rgb"
              onOpenChange={open => { if (open) begin('strokeColor'); else editor.finish() }}
              onChange={color => updateLabel({ strokeColor: pickerColor(color) }, 'strokeColor')}
            />
          </label>
          <label className="cartography-editor__field">
            <span>描边宽度（px）</span>
            <InputNumber
              aria-label="标注描边宽度"
              disabled={!enabled}
              min={0}
              max={8}
              step={0.5}
              value={label.strokeWidth ?? 2}
              onFocus={() => begin('strokeWidth')}
              onChange={value => { if (value !== null) updateLabel({ strokeWidth: value }, 'strokeWidth') }}
              onBlur={editor.finish}
            />
          </label>
          <label className="cartography-editor__field">
            <span>水平偏移（px）</span>
            <InputNumber
              aria-label="标注水平偏移"
              disabled={!enabled}
              min={-256}
              max={256}
              step={1}
              value={label.offsetX ?? 0}
              onFocus={() => begin('offsetX')}
              onChange={value => { if (value !== null) updateLabel({ offsetX: value }, 'offsetX') }}
              onBlur={editor.finish}
            />
          </label>
          <label className="cartography-editor__field">
            <span>垂直偏移（px）</span>
            <InputNumber
              aria-label="标注垂直偏移"
              disabled={!enabled}
              min={-256}
              max={256}
              step={1}
              value={label.offsetY ?? 0}
              onFocus={() => begin('offsetY')}
              onChange={value => { if (value !== null) updateLabel({ offsetY: value }, 'offsetY') }}
              onBlur={editor.finish}
            />
          </label>
        </div>
      </section>

      <section className="cartography-editor__section">
        <div className="cartography-editor__section-title">缩放范围</div>
        <div className="cartography-editor__controls cartography-editor__controls--two">
          <label className="cartography-editor__field">
            <span>最小 Zoom</span>
            <InputNumber
              aria-label="标注最小缩放"
              disabled={!enabled}
              min={0}
              max={24}
              value={label.minZoom}
              placeholder="不限"
              onFocus={() => begin('minZoom')}
              onChange={value => updateLabel({ minZoom: value ?? undefined }, 'minZoom')}
              onBlur={editor.finish}
            />
          </label>
          <label className="cartography-editor__field">
            <span>最大 Zoom</span>
            <InputNumber
              aria-label="标注最大缩放"
              disabled={!enabled}
              min={0}
              max={24}
              value={label.maxZoom}
              placeholder="不限"
              onFocus={() => begin('maxZoom')}
              onChange={value => updateLabel({ maxZoom: value ?? undefined }, 'maxZoom')}
              onBlur={editor.finish}
            />
          </label>
        </div>
        <p className="cartography-editor__note">仅在指定的地图 Zoom 范围内显示标注。</p>
      </section>
    </div>
  )
}
