import { useState, type DragEvent, type ReactNode } from 'react'
import { Box, Building2, ChevronDown, ChevronRight, Folder, Layers2, Map, MoreHorizontal, LockKeyhole, Shapes, Waves } from 'lucide-react'
import { getCesiumSceneNodeState, getCesiumSceneGroupState, getCesiumSceneDescendantIds } from '@desktop-webgis/cesium-scene-schema'
import type { CesiumSceneNode, CesiumSceneGroup, CesiumScene } from '@desktop-webgis/cesium-scene-schema'
import type { SceneSelectionMode } from './scene3d-selection'

export interface SceneLayerState { state: 'loading' | 'ready' | 'error'; error?: string }
interface Props {
  scene: CesiumScene; search: string; selectedIds: readonly string[]; selectedGroup: string | null
  states: Record<string, SceneLayerState>
  onContext(id: string, x: number, y: number, group?: boolean): void
  onSelect(id: string, mode?: SceneSelectionMode, order?: string[]): void
  onGroup(id: string): void
  onVisible(ids: string[], visible: boolean): void
  onGroupVisible(id: string, visible: boolean): void
  onLocate(id: string): void
  onMove(ids: string[], groupId?: string, beforeId?: string): void
  onMoveGroup(id: string, parentId?: string): void
}
const typeLabels = { '3dtiles': '3D Tiles', model: '模型', geojson: '矢量数据', imagery: '影像底图', water: '水面', graphic: '标绘图形' }
const icons = { '3dtiles': Building2, model: Box, geojson: Layers2, imagery: Map, water: Waves, graphic: Shapes }

/** Recursive folders preserve expansion state while search reveals matching ancestor paths. */
export function SceneTree({ scene, search, selectedIds, selectedGroup, states, onContext, onSelect, onGroup, onVisible, onGroupVisible, onLocate, onMove, onMoveGroup }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const query = search.toLocaleLowerCase()
  const matches = (name: string): boolean => !query || name.toLocaleLowerCase().includes(query)
  const nodesFor = (parent?: string) => scene.nodes.filter(node => node.groupId === parent)
  const groupsFor = (parent?: string) => scene.groups?.filter(group => group.parentId === parent) ?? []
  function groupMatches(group: CesiumSceneGroup): boolean {
    return matches(group.name) || nodesFor(group.id).some(node => matches(node.name)) || groupsFor(group.id).some(groupMatches)
  }
  const order: string[] = []
  function collect(parent?: string, inheritedMatch = false): void {
    for (const node of nodesFor(parent)) if (inheritedMatch || matches(node.name)) order.push(node.id)
    for (const group of groupsFor(parent)) if ((inheritedMatch || groupMatches(group)) && (query || !collapsed[group.id])) collect(group.id, inheritedMatch || !!query && matches(group.name))
  }
  collect()

  function drop(event: DragEvent, parent?: string, beforeId?: string): void {
    event.preventDefault(); event.stopPropagation()
    const folder = event.dataTransfer.getData('application/x-scene3d-group')
    if (folder) { onMoveGroup(folder, parent); return }
    try {
      const ids: unknown = JSON.parse(event.dataTransfer.getData('application/x-scene3d-nodes'))
      if (Array.isArray(ids) && ids.length && ids.every(id => typeof id === 'string')) onMove(ids, parent, beforeId)
    } catch { /* External drags are not scene-object moves. */ }
  }
  function allowDrop(event: DragEvent): void {
    if (!event.dataTransfer.types.some(type => ['application/x-scene3d-nodes', 'application/x-scene3d-group'].includes(type))) return
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'
  }
  function renderNode(node: CesiumSceneNode) {
    const Icon = icons[node.type], state = states[node.id], effective = getCesiumSceneNodeState(scene, node)
    const groupHidden = !getCesiumSceneGroupState(scene, node.groupId).visible
    return <li key={node.id} onContextMenu={event => { event.preventDefault(); onContext(node.id, event.clientX, event.clientY) }} className={`scene3d-layer-row${selectedIds.includes(node.id) ? ' scene3d-layer-row--selected' : ''}${!effective.visible ? ' scene3d-layer-row--hidden' : ''}`} onDragOver={effective.locked ? undefined : allowDrop} onDrop={effective.locked ? undefined : event => drop(event, node.groupId, node.id)}>
      <input type="checkbox" aria-label={`显示${node.name}`} checked={node.visible} disabled={groupHidden} title={groupHidden ? '父文件夹已隐藏' : undefined} onChange={event => onVisible([node.id], event.target.checked)} />
      <button className="scene3d-layer-row__select" draggable={!effective.locked} title={node.name} aria-pressed={selectedIds.includes(node.id)} onDragStart={event => {
        const ids = selectedIds.includes(node.id) ? selectedIds : [node.id]
        if (scene.nodes.some(item => ids.includes(item.id) && getCesiumSceneNodeState(scene, item).locked)) { event.preventDefault(); return }
        event.dataTransfer.setData('application/x-scene3d-nodes', JSON.stringify(ids))
        if (node.type === 'model' && ids.length === 1) event.dataTransfer.setData('application/x-scene3d-node', node.id)
      }} onClick={event => onSelect(node.id, event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : undefined, order)} onDoubleClick={() => onLocate(node.id)} onKeyDown={event => {
        if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); onContext(node.id, rect.left, rect.bottom) }
      }}>
        <Icon size={17} aria-hidden="true" /><span><strong>{node.name}</strong><small className={state?.state === 'error' ? 'scene3d-load-error' : ''}>{state?.state === 'error' ? '加载失败 · 选择查看' : state?.state === 'loading' ? '加载中…' : `${typeLabels[node.type]}${effective.locked ? ' · 已锁定' : ''}${groupHidden ? ' · 文件夹隐藏' : ''}`}</small></span>
      </button>
      <button className="scene3d-object-menu" aria-label={`更多操作：${node.name}`} title="对象菜单" onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); onContext(node.id, rect.left, rect.bottom) }}><MoreHorizontal size={16} /></button>
    </li>
  }
  function renderChildren(parent?: string, inheritedMatch = false): ReactNode {
    return <>
      <ul className="scene3d-layer-list">{nodesFor(parent).filter(node => inheritedMatch || matches(node.name)).map(renderNode)}</ul>
      {groupsFor(parent).filter(group => inheritedMatch || groupMatches(group)).map(group => {
        const folded = !query && !!collapsed[group.id], effective = getCesiumSceneGroupState(scene, group.id)
        const descendantIds = getCesiumSceneDescendantIds(scene, group.id)
        return <section key={group.id} className={`scene3d-scene-group${selectedGroup === group.id ? ' scene3d-scene-group--selected' : ''}`} aria-label={`分组 ${group.name}`}>
          <div className="scene3d-scene-group__header" onContextMenu={event => { event.preventDefault(); onContext(group.id, event.clientX, event.clientY, true) }} onDragOver={effective.locked ? undefined : allowDrop} onDrop={effective.locked ? undefined : event => drop(event, group.id)}>
            <button aria-label={`${folded ? '展开' : '收起'}分组${group.name}`} aria-expanded={!folded} onClick={() => setCollapsed({ ...collapsed, [group.id]: !folded })}>{folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
            <input type="checkbox" aria-label={`显示分组${group.name}`} checked={group.visible} onChange={event => onGroupVisible(group.id, event.target.checked)} />
            <button className="scene3d-scene-group__name" draggable={!effective.locked} onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('application/x-scene3d-group', group.id) }} aria-pressed={selectedGroup === group.id} onClick={() => onGroup(group.id)}><Folder size={15} aria-hidden="true" /><strong>{group.name}</strong><span>{descendantIds.length}</span>{effective.locked && <LockKeyhole size={12} aria-label="已锁定" />}</button>
            <button aria-label={`更多操作：${group.name}`} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); onContext(group.id, rect.left, rect.bottom, true) }}><MoreHorizontal size={16} /></button>
          </div>
          {!folded && <div className="scene3d-folder-children">{renderChildren(group.id, inheritedMatch || !!query && matches(group.name))}{!nodesFor(group.id).length && !groupsFor(group.id).length && !query && <p className="scene3d-group-empty">拖入对象或文件夹</p>}</div>}
        </section>
      })}
    </>
  }
  return <>
    {!!query && !order.length && !groupsFor().some(groupMatches) && <p className="scene3d-empty-message">没有匹配的对象或文件夹</p>}
    {renderChildren()}
    <div className="scene3d-root-drop" onDragOver={allowDrop} onDrop={event => drop(event)}>拖到此处移出分组</div>
  </>
}
