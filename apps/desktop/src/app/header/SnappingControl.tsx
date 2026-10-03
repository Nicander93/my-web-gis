import { ChevronDown, Magnet } from 'lucide-react'
import { useSnappingStore } from '@/stores/snapping.store'
import { ToolbarButton } from './ToolbarButton'

/** Compact toggle with secondary settings kept out of the map workspace. */
export function SnappingControl() {
  const options = useSnappingStore(s => s.options)
  const update = useSnappingStore(s => s.update)
  return <div className="snapping-control">
    <ToolbarButton icon={Magnet} active={options.enabled} label={options.enabled ? '关闭捕捉' : '开启捕捉'} onClick={() => update({ enabled: !options.enabled, ...(!options.vertex && !options.edge ? { vertex: true, edge: true } : {}) })} />
    <details className="snapping-settings" onKeyDown={event => {
      if (event.key === 'Escape') {
        event.currentTarget.open = false
        event.currentTarget.querySelector('summary')?.focus()
      }
    }}>
      <summary aria-label="捕捉设置" title="捕捉设置"><ChevronDown size={14} /></summary>
      <div className="snapping-settings__panel">
        <strong>捕捉设置</strong>
        <label><input type="checkbox" checked={options.vertex} onChange={event => update({ vertex: event.target.checked })} />顶点</label>
        <label><input type="checkbox" checked={options.edge} onChange={event => update({ edge: event.target.checked })} />边线</label>
        <label>参照范围<select value={options.scope} onChange={event => update({ scope: event.target.value as typeof options.scope })}>
          <option value="active">当前图层</option><option value="visible">全部可见矢量图层</option>
        </select></label>
        <label>容差（屏幕像素）<input type="number" min="1" max="30" step="1" value={options.pixelTolerance} onChange={event => update({ pixelTolerance: Number(event.target.value) })} /></label>
        <p>绘制和修改时生效。隐藏、筛选掉的要素不参与可见图层捕捉。关闭顶点和边线会关闭捕捉。</p>
      </div>
    </details>
  </div>
}
