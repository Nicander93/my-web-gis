import { useEffect, useState } from 'react'
import { Alert, Button, Input, InputNumber, Select, Space } from 'antd'
import {
  createLineWidthExpression,
  readLineWidthExpression,
  type LineWidthPlan,
  type LineWidthStop
} from '@desktop-webgis/ol-style/cartography-operations'

interface LineWidthEditorProps {
  value: unknown
  disabled?: boolean
  onChange: (value: unknown) => void
  onBegin?: () => void
  onFinish?: () => void
}

type WidthMode = LineWidthPlan['kind'] | 'expression'

function asPlan(value: unknown): LineWidthPlan | undefined {
  try {
    const result = readLineWidthExpression(value)
    if (result.kind === 'expression') return undefined
    return result
  } catch {
    return undefined
  }
}

function modeOf(value: unknown): WidthMode {
  if (typeof value === 'number') return 'fixed'
  return asPlan(value)?.kind ?? 'expression'
}

function defaultPlan(mode: 'fixed'): Extract<LineWidthPlan, { kind: 'fixed' }>
function defaultPlan(mode: 'field'): Extract<LineWidthPlan, { kind: 'field' }>
function defaultPlan(mode: 'zoom-linear'): Extract<LineWidthPlan, { kind: 'zoom-linear' }>
function defaultPlan(mode: 'zoom-step'): Extract<LineWidthPlan, { kind: 'zoom-step' }>
function defaultPlan(mode: Exclude<WidthMode, 'expression'>): LineWidthPlan
function defaultPlan(mode: Exclude<WidthMode, 'expression'>): LineWidthPlan {
  switch (mode) {
    case 'fixed': return { kind: 'fixed', value: 2 }
    case 'field': return { kind: 'field', field: '', factor: 1 }
    case 'zoom-linear': return { kind: 'zoom-linear', stops: [{ zoom: 0, width: 1 }, { zoom: 24, width: 3 }] }
    case 'zoom-step': return { kind: 'zoom-step', base: 1, stops: [{ zoom: 8, width: 2 }] }
  }
}

function changeStop(stops: readonly LineWidthStop[], index: number, key: keyof LineWidthStop, value: number): LineWidthStop[] {
  return stops.map((stop, candidate) => candidate === index ? { ...stop, [key]: value } : stop)
}

function formatJson(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2)
}

function nextZoomStop(stops: readonly LineWidthStop[]): number | undefined {
  const lastZoom = stops.at(-1)?.zoom ?? -1
  if (lastZoom >= 24) return undefined
  return Math.min(24, Math.floor(lastZoom) + 1)
}

export function LineWidthEditor({ value, disabled = false, onChange, onBegin, onFinish }: LineWidthEditorProps) {
  const [mode, setMode] = useState<WidthMode>(() => modeOf(value))
  const [advancedValue, setAdvancedValue] = useState(() => formatJson(value))
  const plan = asPlan(value)
  const isExpression = mode === 'expression'

  useEffect(() => {
    setMode(modeOf(value))
    setAdvancedValue(formatJson(value))
  }, [value])

  function emit(next: LineWidthPlan) {
    try {
      if (next.kind === 'field' && !next.field.trim()) return
      onChange(createLineWidthExpression(next))
    } catch {
      // Keep the last valid MapLibre expression while a stop or field is being edited.
    }
  }

  function selectMode(nextMode: WidthMode) {
    setMode(nextMode)
    onBegin?.()
    if (nextMode === 'expression') {
      setAdvancedValue(formatJson(value))
      return
    }
    emit(defaultPlan(nextMode))
  }

  function updateStops(kind: 'zoom-linear' | 'zoom-step', stops: readonly LineWidthStop[]) {
    if (kind === 'zoom-linear') {
      emit({ kind, stops })
      return
    }
    const current = plan?.kind === 'zoom-step' ? plan : defaultPlan('zoom-step')
    emit({ ...current, stops })
  }

  function applyAdvanced() {
    try {
      const parsed: unknown = JSON.parse(advancedValue)
      if (typeof parsed === 'number' && (!Number.isFinite(parsed) || parsed < 0)) throw new Error('固定线宽必须是有限非负数')
      readLineWidthExpression(parsed)
      onBegin?.()
      onChange(parsed)
      setMode(modeOf(parsed))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setErrorMessage(message)
    }
  }

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const optionValues: Array<{ value: WidthMode; label: string }> = [
    { value: 'fixed', label: '固定值' },
    { value: 'field', label: '字段 × 倍率' },
    { value: 'zoom-linear', label: 'Zoom 线性' },
    { value: 'zoom-step', label: 'Zoom 阶梯' },
    { value: 'expression', label: '高级表达式' }
  ]

  return (
    <div className="symbol-width-editor">
      <Select
        aria-label="线宽方式"
        disabled={disabled}
        value={mode}
        options={optionValues}
        onChange={selectMode}
        onBlur={onFinish}
      />
      {mode === 'fixed' ? (
        <InputNumber
          aria-label="固定线宽"
          disabled={disabled}
          min={0}
          max={64}
          step={0.5}
          value={typeof value === 'number' ? value : plan?.kind === 'fixed' ? plan.value : 2}
          onFocus={onBegin}
          onChange={next => { if (next !== null) onChange(next) }}
          onBlur={onFinish}
        />
      ) : null}
      {mode === 'field' ? (() => {
        const fieldPlan = plan?.kind === 'field' ? plan : defaultPlan('field')
        return (
          <div className="symbol-width-editor__field-row">
            <Input
              aria-label="线宽字段"
              disabled={disabled}
              placeholder="数值字段"
              value={fieldPlan.field}
              onFocus={onBegin}
              onChange={event => emit({ ...fieldPlan, field: event.target.value })}
              onBlur={onFinish}
            />
            <span>×</span>
            <InputNumber
              aria-label="线宽倍率"
              disabled={disabled}
              min={0}
              step={0.25}
              value={fieldPlan.factor}
              onFocus={onBegin}
              onChange={next => { if (next !== null) emit({ ...fieldPlan, factor: next }) }}
              onBlur={onFinish}
            />
          </div>
        )
      })() : null}
      {mode === 'zoom-linear' || mode === 'zoom-step' ? (() => {
        const zoomPlan = mode === 'zoom-linear'
          ? plan?.kind === 'zoom-linear' ? plan : defaultPlan('zoom-linear')
          : plan?.kind === 'zoom-step' ? plan : defaultPlan('zoom-step')
        const stops = zoomPlan.stops
        const nextZoom = nextZoomStop(stops)
        return (
          <div className="symbol-width-editor__zoom">
            {zoomPlan.kind === 'zoom-step' ? (
              <label className="symbol-editor__control">
                <span>基础线宽</span>
                <InputNumber
                  aria-label="阶梯基础线宽"
                  disabled={disabled}
                  min={0}
                  step={0.5}
                  value={zoomPlan.base}
                  onFocus={onBegin}
                  onChange={next => { if (next !== null) emit({ ...zoomPlan, base: next }) }}
                  onBlur={onFinish}
                />
              </label>
            ) : null}
            {stops.map((stop, index) => (
              <div className="symbol-width-editor__stop" key={`${index}:${stop.zoom}`}>
                <label className="symbol-editor__control">
                  <span>Zoom</span>
                  <InputNumber
                    aria-label={`线宽 stop ${index + 1} Zoom`}
                    disabled={disabled}
                    min={0}
                    max={24}
                    value={stop.zoom}
                    onFocus={onBegin}
                    onChange={next => { if (next !== null) updateStops(mode, changeStop(stops, index, 'zoom', next)) }}
                    onBlur={onFinish}
                  />
                </label>
                <label className="symbol-editor__control">
                  <span>线宽</span>
                  <InputNumber
                    aria-label={`线宽 stop ${index + 1} 值`}
                    disabled={disabled}
                    min={0}
                    step={0.5}
                    value={stop.width}
                    onFocus={onBegin}
                    onChange={next => { if (next !== null) updateStops(mode, changeStop(stops, index, 'width', next)) }}
                    onBlur={onFinish}
                  />
                </label>
                {stops.length > (mode === 'zoom-linear' ? 2 : 1) ? (
                  <Button
                    aria-label={`删除线宽 stop ${index + 1}`}
                    disabled={disabled}
                    size="small"
                    onClick={() => updateStops(mode, stops.filter((_, candidate) => candidate !== index))}
                  >删除</Button>
                ) : null}
              </div>
            ))}
            <Button
              disabled={disabled || stops.length >= 8 || nextZoom === undefined}
              size="small"
              onClick={() => { if (nextZoom !== undefined) updateStops(mode, [...stops, { zoom: nextZoom, width: stops.at(-1)?.width ?? 1 }]) }}
            >添加 stop</Button>
          </div>
        )
      })() : null}
      {isExpression ? (
        <div className="symbol-width-editor__advanced">
          <Alert
            type="info"
            showIcon
            message="当前线宽使用标准表达式，原 AST 已保留。"
            description="可在下方直接编辑 MapLibre JSON 表达式。"
          />
          {errorMessage ? <Alert type="error" message={errorMessage} /> : null}
          <Input.TextArea
            aria-label="线宽表达式 JSON"
            disabled={disabled}
            autoSize={{ minRows: 3, maxRows: 8 }}
            value={advancedValue}
            onFocus={onBegin}
            onChange={event => { setAdvancedValue(event.target.value); setErrorMessage(null) }}
            onBlur={onFinish}
          />
          <Space>
            <Button disabled={disabled} size="small" type="primary" onClick={applyAdvanced}>应用 JSON</Button>
          </Space>
        </div>
      ) : null}
    </div>
  )
}
