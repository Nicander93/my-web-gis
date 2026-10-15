import { useState } from 'react'
import { Alert, Button, Input, Switch } from 'antd'
import { ApplyProjectSnapshotEditCommand, createId, getLayerGroupState } from '@desktop-webgis/gis-core'
import type { LayerGroup } from '@desktop-webgis/gis-core'
import { getCesiumSceneGroupState } from '@desktop-webgis/cesium-scene-schema'
import type { CesiumSceneGroup } from '@desktop-webgis/cesium-scene-schema'
import { PropertyWindow } from '@/components/ui/PropertyWindow'
import { useProjectStore } from '@/stores/project.store'
import { updateScene } from '@/features/scene3d/scene3d-commands'

/** Folder settings never replace membership/order with a stale captured tree. */
export function FolderPropertyWindow({ id, scene3d = false, onClose }: { id: string; scene3d?: boolean; onClose(): void }) {
  const project = useProjectStore(state => state.project)
  const epoch = useState(() => useProjectStore.getState().projectEpoch)[0]
  const current = scene3d ? project.city?.groups?.find(group => group.id === id) : project.groups?.find(group => group.id === id)
  const [base, setBase] = useState(() => structuredClone(current)), [draft, setDraft] = useState(() => structuredClone(current))
  const title = useState(() => current?.name ?? id)[0]
  const [query, setQuery] = useState(''), [error, setError] = useState('')
  if (!base || !draft) return null
  const dirty = JSON.stringify(base) !== JSON.stringify(draft)
  function apply(close = false): void {
    try {
      const store = useProjectStore.getState(), snapshot = store.getSnapshot()
      if (store.projectEpoch !== epoch) throw new Error('项目已切换。')
      const live = scene3d ? snapshot.project.city?.groups?.find(group => group.id === id) : snapshot.project.groups?.find(group => group.id === id)
      if (!live) throw new Error('文件夹已删除。')
      if (JSON.stringify(live) !== JSON.stringify(base)) throw new Error('文件夹已被其他操作修改，请重新载入。')
      const locked = scene3d && snapshot.project.city ? getCesiumSceneGroupState(snapshot.project.city, live.parentId).locked : getLayerGroupState(snapshot.project, live.parentId).locked
      if (locked || live.locked && draft?.locked) throw new Error('文件夹或父级已锁定，请先解锁。')
      if (!draft?.name.trim()) throw new Error('请输入文件夹名称。')
      if (dirty) {
        if (scene3d) updateScene('应用文件夹属性', scene => ({ ...scene, groups: scene.groups?.map(group => group.id === id ? { ...group, name: draft.name, visible: draft.visible, locked: !!draft.locked } : group) }))
        else {
          const after = structuredClone(snapshot)
          after.project.groups = after.project.groups?.map(group => group.id === id ? { ...group, name: draft.name, visible: draft.visible, locked: draft.locked } : group)
          store.executeEditCommand(new ApplyProjectSnapshotEditCommand(createId('cmd'), '应用文件夹属性', snapshot, after))
        }
      }
      const applied = scene3d ? useProjectStore.getState().project.city?.groups?.find(group => group.id === id) : useProjectStore.getState().project.groups?.find(group => group.id === id)
      setBase(structuredClone(applied)); setDraft(structuredClone(applied)); setError(''); if (close) onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '属性无效') }
  }
  const matches = (text: string) => !query || text.toLowerCase().includes(query.toLowerCase())
  const patch = (value: Partial<LayerGroup & CesiumSceneGroup>) => setDraft({ ...draft, ...value })
  return <PropertyWindow title={`完整属性：${title}`} subtitle={`文件夹 · ${id}`} dirty={dirty} categories={[{ key: 'general', label: '文件夹' }]} section="general" onSection={() => {}} query={query} onQuery={setQuery} onClose={onClose} footer={<><Button disabled={!current} onClick={() => { setBase(structuredClone(current)); setDraft(structuredClone(current)); setError('') }}>重新载入</Button><span /><Button onClick={onClose}>取消</Button><Button disabled={!current || !dirty} onClick={() => apply()}>应用</Button><Button type="primary" disabled={!current} onClick={() => dirty ? apply(true) : onClose()}>确定</Button></>}>
    {(error || !current) && <Alert type="error" title={error || '文件夹已删除。'} />}
    {matches('名称 name') && <label className="scene-property-window__field"><span>文件夹名称<small>name</small></span><Input aria-label="文件夹名称" value={draft.name} onChange={event => patch({ name: event.target.value })} /></label>}
    {matches('显示 visible') && <label className="scene-property-window__field"><span>显示文件夹<small>visible</small></span><Switch aria-label="显示文件夹" checked={draft.visible} onChange={visible => patch({ visible })} /></label>}
    {matches('锁定 locked') && <label className="scene-property-window__field"><span>锁定文件夹<small>locked</small></span><Switch aria-label="锁定文件夹" checked={!!draft.locked} onChange={locked => patch({ locked })} /></label>}
    <p>子对象的自身显隐、内容和顺序保持独立；文件夹显隐和锁定会沿层级生效。</p>
  </PropertyWindow>
}
