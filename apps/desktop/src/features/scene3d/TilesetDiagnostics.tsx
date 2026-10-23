import { useState } from 'react'
import { Button } from 'antd'
import { getLiveSceneDiagnostics } from './scene3d-runtime-host'
import { ScenePropertyGroup } from './ScenePropertyGroup'

/** Runtime-only readings and actions never enter a project command. */
export function TilesetDiagnostics({ id, onTrimCache }: { id: string; onTrimCache(): void }) {
  const [diagnostics, setDiagnostics] = useState(() => getLiveSceneDiagnostics(id))
  const value = diagnostics?.presentation?.tileset
  return <ScenePropertyGroup title="运行诊断" open={false} hint="数据来自当前 Cesium 实例。刷新和缓存卸载不改变工程或撤销历史。">
    <dl className="scene3d-attribute-list"><div><dt>totalMemoryUsageInBytes</dt><dd>{value?.totalMemoryUsageInBytes?.toLocaleString() ?? '未取得'}</dd></div><div><dt>tilesLoaded</dt><dd>{value ? String(value.tilesLoaded) : '未取得'}</dd></div></dl>
    <div className="scene3d-form-actions"><Button onClick={() => setDiagnostics(getLiveSceneDiagnostics(id))}>刷新诊断</Button><Button disabled={!value} onClick={onTrimCache}>卸载未使用瓦片</Button></div>
  </ScenePropertyGroup>
}
