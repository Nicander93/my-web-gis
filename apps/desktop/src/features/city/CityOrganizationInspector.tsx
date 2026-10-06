import { useState } from 'react'
import { getCityNodeState } from '@desktop-webgis/cesium-scene-schema'
import type { CityGroup, CityNode, CityScene } from '@desktop-webgis/cesium-scene-schema'
import { CityInfo } from './CityPropertyGroup'

interface BatchProps {
  city: CityScene; nodes: CityNode[]
  onVisible(value: boolean): void; onLock(value: boolean): void; onMove(groupId?: string): void
  onCopy(): void; onDelete(): void
}
function mixed(values: unknown[]): string { return values.every(value => value === values[0]) ? String(values[0] ?? '未分组') : '混合值' }

export function CityBatchInspector({ city, nodes, onVisible, onLock, onMove, onCopy, onDelete }: BatchProps) {
  const states = nodes.map(node => getCityNodeState(city, node)), locked = states.some(state => state.locked)
  const inheritedLock = nodes.some(node => city.groups?.find(group => group.id === node.groupId)?.locked)
  const mixedGroups = !nodes.every(node => node.groupId === nodes[0].groupId)
  const groupId = mixedGroups ? '' : nodes[0].groupId ?? ''
  return <div className="city-properties">
    <section className="city-property-section"><h3>已选择 {nodes.length} 个对象<CityInfo label="批量操作">批量操作统一应用，可一次撤销。单对象几何和资源设置请单独选择后编辑。</CityInfo></h3>
      <dl className="city-attribute-list"><div><dt>对象类型</dt><dd>{mixed(nodes.map(node => node.type))}</dd></div><div><dt>自身显隐</dt><dd>{mixed(nodes.map(node => node.visible ? '显示' : '隐藏'))}</dd></div><div><dt>实际显隐</dt><dd>{mixed(states.map(state => state.visible ? '显示' : '隐藏'))}</dd></div><div><dt>实际锁定</dt><dd>{mixed(states.map(state => state.locked ? '锁定' : '未锁定'))}</dd></div></dl>
      <div className="city-form-actions"><button className="button-secondary" onClick={() => onVisible(true)}>全部显示</button><button className="button-secondary" onClick={() => onVisible(false)}>全部隐藏</button></div>
      {nodes.some(node => city.groups?.find(group => group.id === node.groupId)?.visible === false) && <p className="editor-help">所属分组隐藏时，显示对象不会改变分组的隐藏状态。</p>}
    </section>
    <section className="city-property-section"><h3>组织</h3><label className="editor-field">所属分组<select value={groupId} disabled={locked} onChange={event => onMove(event.target.value || undefined)}><option value="" disabled={mixedGroups}>{mixedGroups ? '混合值' : '未分组'}</option>{city.groups?.map(group => <option key={group.id} value={group.id} disabled={group.locked}>{group.name}{group.locked ? '（已锁定）' : ''}</option>)}</select></label><button className="city-text-action" disabled={locked || nodes.every(node => !node.groupId)} onClick={() => onMove()}>移出分组</button>
      <div className="city-form-actions"><button className="button-secondary" onClick={() => onLock(true)}>全部锁定</button><button className="button-secondary" disabled={inheritedLock} title={inheritedLock ? '请先解锁所属分组' : undefined} onClick={() => onLock(false)}>全部解锁</button></div>
      {locked && <p className="editor-help">选择中包含锁定对象。移动或删除前须全部解锁。</p>}
    </section>
    <section className="city-property-section city-form-actions"><button className="button-secondary" onClick={onCopy}>复制所选对象</button><button className="city-danger-action" disabled={locked} onClick={onDelete}>删除所选对象</button></section>
    <section className="city-property-section"><h3>共同属性</h3><CommonGraphicProperties nodes={nodes} /></section>
  </div>
}
function CommonGraphicProperties({ nodes }: { nodes: CityNode[] }) {
  if (!nodes.every(node => node.type === 'graphic')) return <p className="editor-help">资源属性和构件属性请单独选择查看。</p>
  const keys = [...new Set(nodes.flatMap(node => Object.keys(node.properties)))]
  return keys.length ? <dl className="city-attribute-list">{keys.map(key => {
    const values = nodes.map(node => Object.hasOwn(node.properties, key) ? JSON.stringify(node.properties[key]) : undefined)
    return <div key={key}><dt>{key}</dt><dd>{values.every(value => value === values[0]) ? values[0] ?? '字段缺失' : '混合值'}</dd></div>
  })}</dl> : <p className="editor-help">所选图形没有属性字段。</p>
}

interface GroupProps { city: CityScene; group: CityGroup; onPatch(patch: Partial<Pick<CityGroup, 'name'|'visible'|'locked'>>): void; onSelectMembers(): void; onDissolve(): void; onReorder(direction: -1 | 1): void }
export function CityGroupInspector({ city, group, onPatch, onSelectMembers, onDissolve, onReorder }: GroupProps) {
  const [name, setName] = useState(group.name)
  const nodes = city.nodes.filter(node => node.groupId === group.id), index = city.groups?.findIndex(item => item.id === group.id) ?? 0
  return <div className="city-properties">
    <form className="city-property-section" onSubmit={event => { event.preventDefault(); onPatch({ name: name.trim() }) }}><h3>场景分组</h3><label className="editor-field">分组名称<input value={name} required disabled={group.locked} onChange={event => setName(event.target.value)} /></label><button className="button-secondary" disabled={group.locked || !name.trim() || name.trim() === group.name}>应用名称</button><p className="editor-help">{nodes.length} 个对象 · 组内对象保留各自显隐和锁定设置。</p></form>
    <section className="city-property-section"><h3>组状态<CityInfo label="分组状态">锁定后禁止成员编辑、移动和删除。解锁分组不会解除成员自身的锁定。</CityInfo></h3><label className="city-check"><input type="checkbox" checked={group.visible} onChange={event => onPatch({ visible: event.target.checked })} />显示分组</label><label className="city-check"><input type="checkbox" checked={!!group.locked} onChange={event => onPatch({ locked: event.target.checked })} />锁定分组</label><button className="button-secondary" disabled={!nodes.length} onClick={onSelectMembers}>选择组内全部对象</button></section>
    <section className="city-property-section"><h3>顺序</h3><div className="city-form-actions"><button className="button-secondary" disabled={group.locked || index === 0} onClick={() => onReorder(-1)}>上移分组</button><button className="button-secondary" disabled={group.locked || index === (city.groups?.length ?? 0) - 1} onClick={() => onReorder(1)}>下移分组</button></div></section>
    <section className="city-property-section city-form-actions"><button className="city-danger-action" disabled={group.locked} onClick={onDissolve}>解散分组</button><CityInfo label="解散分组">保留全部对象与实际显隐状态，可撤销恢复分组。</CityInfo></section>
  </div>
}
