import { useEffect, useId, useState } from 'react'
import { Button, Input, InputNumber, Switch, Tooltip } from 'antd'
import { TILESET_PARAMETER_DESCRIPTORS, type TilesetNode } from '@desktop-webgis/cesium-scene-schema'
import { ScenePropertyGroup } from './ScenePropertyGroup'

interface Props {
  node: TilesetNode
  query?: string
  onChange(patch: Partial<TilesetNode>): void
  onValidity?(apiName: string, valid: boolean): void
}

/** Descriptors drive presentation only; the runtime applies an explicit allowlist. */
export function TilesetParameterFields({ node, query, onChange, onValidity }: Props) {
  const instanceId = useId()
  const inputId = (id: string) => `${instanceId}-${id}`
  const [search, setSearch] = useState('')
  const [resets, setResets] = useState<Record<string, number>>({})
  const term = (query ?? search).trim().toLowerCase()
  const descriptors = TILESET_PARAMETER_DESCRIPTORS.filter(item => item.lifecycle === 'runtime' && ['number', 'boolean'].includes(item.kind))
  const matches = (item: typeof descriptors[number]) => `${item.apiName} ${item.group} ${item.help} ${item.search}`.toLowerCase().includes(term)
  const groups = [...new Set(descriptors.map(item => item.group))]
  return <div className="tileset-parameters">
    {query === undefined && <Input.Search aria-label="搜索参数" placeholder="搜索 API 或中文说明" allowClear value={search} onChange={event => setSearch(event.target.value)} />}
    {!descriptors.some(matches) && <p className="editor-help">没有匹配的已支持参数。</p>}
    {groups.map(group => <div key={group} hidden={!descriptors.some(item => item.group === group && matches(item))}><ScenePropertyGroup title={group}>
      {descriptors.filter(item => item.group === group).map(item => <div key={item.id} className="tileset-parameters__row" hidden={!matches(item)}>
        <Tooltip title={item.help}><label htmlFor={inputId(item.id)}><code>{item.apiName}</code><small>{item.lifecycle === 'runtime' ? '运行时' : item.lifecycle}</small></label></Tooltip>
        {item.kind === 'boolean' ? <Switch id={inputId(item.id)} aria-label={item.apiName} checked={Boolean(node[item.apiName as keyof TilesetNode] ?? item.defaultValue)} onChange={value => onChange({ [item.apiName]: value })} /> : <ParameterNumber key={resets[item.apiName] ?? 0} id={inputId(item.id)} apiName={item.apiName} value={Number(node[item.apiName as keyof TilesetNode] ?? item.defaultValue)} min={item.min} max={item.max} step={item.step} validate={item.validate} onValidity={valid => onValidity?.(item.apiName, valid)} onChange={value => onChange({ [item.apiName]: value })} />}
        <Tooltip title={`恢复默认值 ${item.defaultValue}`}><Button type="text" size="small" aria-label={`重置 ${item.apiName}`} onClick={() => { setResets(state => ({ ...state, [item.apiName]: (state[item.apiName] ?? 0) + 1 })); onValidity?.(item.apiName, true); onChange({ [item.apiName]: item.defaultValue }) }}>复位</Button></Tooltip>
      </div>)}
    </ScenePropertyGroup></div>)}
    <p className="editor-help">Cesium 1.145.0 · 仅列出已接通保存、预览和运行时的参数。设备画质在场景设置中单独保存。</p>
  </div>
}

function ParameterNumber({ id, apiName, value, min, max, step, validate, onChange, onValidity }: { id: string; apiName: string; value: number; min?: number; max?: number; step?: number; validate(value: unknown): boolean; onChange(value: number): void; onValidity(valid: boolean): void }) {
  const [draft, setDraft] = useState<number | null>(value)
  useEffect(() => { setDraft(value); onValidity(true) }, [value])
  const valid = draft !== null && validate(draft)
  function commit(): void { if (valid && draft !== value) onChange(draft) }
  return <InputNumber id={id} aria-label={apiName} value={draft} min={min} max={max} step={step} status={valid ? undefined : 'error'} onChange={next => { setDraft(next); onValidity(next !== null && validate(next)) }} onBlur={commit} onPressEnter={event => event.currentTarget.blur()} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setDraft(value); onValidity(true) } }} />
}
