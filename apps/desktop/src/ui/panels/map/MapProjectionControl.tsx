import { requireMapContent } from '@desktop-webgis/project'
import { CRS_PRESETS, findCrsPreset } from '@desktop-webgis/vector-io'
import { useProjectStore } from '@/project/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { viewCommands } from '@/commands/view.commands'

/** 这是一个紧凑的视图设置，不会改变已存储的要素坐标。 */
export function MapProjectionControl() {
  const code = useProjectStore(state => requireMapContent(state.project).crs)
  const editing = useWorkbenchStore(state => Boolean(state.editLayerId))
  return <select className="map-projection-control" aria-label="地图视图投影" value={code} disabled={editing}
    title={editing ? '先结束图层编辑再切换投影' : `${findCrsPreset(code)?.name ?? code}；CGCS2000 转换为椭球近似，无格网改正`}
    onChange={event => viewCommands.setMapProjection(event.target.value)}>
    {!findCrsPreset(code) && <option value={code}>{code}</option>}
    {CRS_PRESETS.map(preset => <option key={preset.code} value={preset.code}>{preset.code} · {preset.name}</option>)}
  </select>
}
