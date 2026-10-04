import { useState } from 'react'
import type { DragEvent } from 'react'
import { Box, Building2, ChevronDown, ChevronRight, Folder, Layers2, LocateFixed, LockKeyhole, Shapes, Waves } from 'lucide-react'
import { getCityNodeState } from '@desktop-webgis/cesium-scene-schema'
import type { CityNode, CityScene } from '@desktop-webgis/cesium-scene-schema'
import type { CitySelectionMode } from './city-selection'

export interface CityLayerState { state: 'loading' | 'ready' | 'error'; error?: string }
interface Props {
  city: CityScene
  search: string
  selectedIds: readonly string[]
  selectedGroup: string | null
  states: Record<string, CityLayerState>
  onSelect(id: string, mode?: CitySelectionMode, order?: string[]): void
  onGroup(id: string): void
  onVisible(ids: string[], visible: boolean): void
  onGroupVisible(id: string, visible: boolean): void
  onLocate(id: string): void
  onMove(ids: string[], groupId?: string, beforeId?: string): void
}
const typeLabels = { '3dtiles': '3D Tiles', model: '模型', geojson: '矢量数据', water: '水面', graphic: '标绘图形' }
const icons = { '3dtiles': Building2, model: Box, geojson: Layers2, water: Waves, graphic: Shapes }

/** One-level folders and transient selection; persisted state stays in scene commands. */
export function CitySceneTree({ city, search, selectedIds, selectedGroup, states, onSelect, onGroup, onVisible, onGroupVisible, onLocate, onMove }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const query = search.toLocaleLowerCase()
  const matches = (node: CityNode): boolean => node.name.toLocaleLowerCase().includes(query)
  const root = city.nodes.filter(node => !node.groupId && matches(node))
  const folders = (city.groups ?? []).map(group => ({ group, nodes: city.nodes.filter(node => node.groupId === group.id && (group.name.toLocaleLowerCase().includes(query) || matches(node))), collapsed: !query && !!collapsed[group.id] })).filter(({ group, nodes }) => !query || nodes.length || group.name.toLocaleLowerCase().includes(query))
  const order = [...root.map(node => node.id), ...folders.flatMap(folder => folder.collapsed ? [] : folder.nodes.map(node => node.id))]
  function drop(event: DragEvent, groupId?: string, beforeId?: string): void {
    event.preventDefault(); event.stopPropagation()
    try {
      const ids: unknown = JSON.parse(event.dataTransfer.getData('application/x-city-nodes'))
      if (Array.isArray(ids) && ids.length && ids.every(id => typeof id === 'string')) onMove(ids, groupId, beforeId)
    } catch { /* External drags are not scene-object moves. */ }
  }
  function allowDrop(event: DragEvent): void {
    if (!event.dataTransfer.types.includes('application/x-city-nodes')) return
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'
  }
  function renderNode(node: CityNode) {
    const Icon = icons[node.type], state = states[node.id], effective = getCityNodeState(city, node), groupHidden = city.groups?.find(group => group.id === node.groupId)?.visible === false
    return <li key={node.id} className={`city-layer-row${selectedIds.includes(node.id) ? ' city-layer-row--selected' : ''}${!effective.visible ? ' city-layer-row--hidden' : ''}`} onDragOver={effective.locked ? undefined : allowDrop} onDrop={effective.locked ? undefined : event => drop(event, node.groupId, node.id)}>
      <input type="checkbox" aria-label={`显示${node.name}`} checked={node.visible} disabled={groupHidden} title={groupHidden ? '所属分组已隐藏，请先显示分组' : undefined} onChange={event => onVisible([node.id], event.target.checked)} />
      <button className="city-layer-row__select" draggable={!effective.locked} title={node.name} aria-pressed={selectedIds.includes(node.id)} onDragStart={event => {
        const ids = selectedIds.includes(node.id) ? selectedIds : [node.id]
        if (city.nodes.some(item => ids.includes(item.id) && getCityNodeState(city, item).locked)) { event.preventDefault(); return }
        event.dataTransfer.setData('application/x-city-nodes', JSON.stringify(ids))
        if (node.type === 'model' && ids.length === 1) event.dataTransfer.setData('application/x-city-node', node.id)
      }} onClick={event => onSelect(node.id, event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : undefined, order)} onDoubleClick={() => onLocate(node.id)}>
        <Icon size={17} aria-hidden="true" /><span><strong>{node.name}</strong><small className={state?.state === 'error' ? 'city-load-error' : ''}>{state?.state === 'error' ? '加载失败 · 选择查看' : state?.state === 'loading' ? '加载中…' : `${typeLabels[node.type]}${effective.locked ? ' · 已锁定' : ''}${groupHidden ? ' · 分组隐藏' : ''}`}</small></span>
      </button>
      <button className="city-layer-row__locate" disabled={state?.state !== 'ready' || !effective.visible} aria-label={`定位${node.name}`} title="定位对象" onClick={() => onLocate(node.id)}><LocateFixed size={14} aria-hidden="true" /></button>
    </li>
  }
  return <>
    {!!query && !root.length && !folders.length && <p className="city-empty-message">没有匹配的对象或分组</p>}
    <ul className="city-layer-list">{root.map(renderNode)}</ul>
    {folders.map(({ group, nodes, collapsed: folded }) => <section key={group.id} className={`city-scene-group${selectedGroup === group.id ? ' city-scene-group--selected' : ''}`} aria-label={`分组 ${group.name}`}>
      <div className="city-scene-group__header" onDragOver={group.locked ? undefined : allowDrop} onDrop={group.locked ? undefined : event => drop(event, group.id)}>
        <button aria-label={`${folded ? '展开' : '收起'}分组${group.name}`} aria-expanded={!folded} onClick={() => setCollapsed({ ...collapsed, [group.id]: !folded })}>{folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
        <input type="checkbox" aria-label={`显示分组${group.name}`} checked={group.visible} onChange={event => onGroupVisible(group.id, event.target.checked)} />
        <button className="city-scene-group__name" aria-pressed={selectedGroup === group.id} onClick={() => onGroup(group.id)}><Folder size={15} aria-hidden="true" /><strong>{group.name}</strong><span>{city.nodes.filter(node => node.groupId === group.id).length}</span>{group.locked && <LockKeyhole size={12} aria-label="已锁定" />}</button>
      </div>
      {!folded && <ul className="city-layer-list city-layer-list--group">{nodes.map(renderNode)}{!nodes.length && !query && <li className="city-group-empty">拖入对象，或从属性面板移动到此分组</li>}</ul>}
    </section>)}
    <div className="city-root-drop" onDragOver={allowDrop} onDrop={event => drop(event)}>拖到此处移出分组</div>
  </>
}
