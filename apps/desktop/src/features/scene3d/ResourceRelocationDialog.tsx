import { useState } from 'react'
import { Button, Input, Radio, Alert } from 'antd'
import type { CesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { pickDirectory, pickFile } from '@/services/files'
import { isTauri } from '@tauri-apps/api/core'
import { planResourceRelocation, type ResourceRelocation } from '@/services/resource-relocation'
import { localProjectDirectory, normalizeLocalResourcePath, resolveResourceReference } from '@/services/resource-paths'

interface Props {
  scene: CesiumScene
  assetId: string
  projectPath: string | null
  onClose(): void
  onApply(changes: ResourceRelocation[], target: string, directory: boolean): void
  onAuthorize(directory: string): void
}

export function ResourceRelocationDialog({ scene, assetId, projectPath, onClose, onApply, onAuthorize }: Props) {
  const [directory, setDirectory] = useState(false)
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  let changes: ResourceRelocation[] = []
  let validation = ''
  let authorizationDirectory: string | null = null
  if (target.trim()) {
    try {
      changes = planResourceRelocation(scene, assetId, target.trim(), directory, projectPath)
      const reference = scene.assets[assetId]?.reference
      const source = reference && resolveResourceReference(reference, projectPath)
      if (isTauri() && directory && !changes.length && source?.kind === 'absolute' && normalizeLocalResourcePath(target.trim()) === localProjectDirectory(source.path)) {
        authorizationDirectory = localProjectDirectory(source.path)
      }
    }
    catch (reason) { validation = reason instanceof Error ? reason.message : String(reason) }
  }
  return <EditorDialog title="重新定位本地资源" onClose={onClose} busy={busy}>
    <div className="dialog-body">
      <Radio.Group value={directory} onChange={event => { setDirectory(event.target.value); setTarget(''); setError('') }} options={[{ label: '替换当前资源文件', value: false }, { label: '替换所在目录', value: true }]} />
      <p>替换目录时，会保留目录下的相对路径并更新同目录的其他资源。模型位置、样式和对象属性保持不变。</p>
      <label className="editor-field">新位置<Input aria-label="资源新位置" value={target} disabled={busy} onChange={event => { setTarget(event.target.value); setError('') }} /></label>
      {isTauri() && <Button loading={busy} onClick={async () => {
        setBusy(true)
        try { const path = directory ? await pickDirectory() : await pickFile(); if (path) setTarget(path) }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
        finally { setBusy(false) }
      }}>选择{directory ? '目录' : '文件'}</Button>}
      {!isTauri() && <p>浏览器可编辑引用；实际读取本地文件需要 Windows 桌面应用。</p>}
      <p role="status">将更新 {changes.length} 个资源引用</p>
      {authorizationDirectory && <p>资源位置未变化。可授权当前目录并重新加载，项目内容保持不变；授权仅在当前项目会话有效。</p>}
      <ul>{changes.map(change => <li key={change.assetId}>
        <strong>{scene.nodes.filter(node => 'asset' in node && node.asset === change.assetId).map(node => node.name).join('、') || change.assetId}</strong>
        <div>{change.before.kind === 'url' ? change.before.url : change.before.path} → {change.after.kind === 'url' ? change.after.url : change.after.path}</div>
      </li>)}</ul>
      {(error || validation) && <Alert type="error" title={error || validation} />}
    </div>
    <div className="dialog-footer"><Button onClick={onClose}>取消</Button><Button type="primary" disabled={busy || !!validation || (!changes.length && !authorizationDirectory)} onClick={() => {
      try {
        if (authorizationDirectory) onAuthorize(authorizationDirectory)
        else onApply(changes, target.trim(), directory)
        onClose()
      }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    }}>{authorizationDirectory ? '授权目录并重新加载' : '应用重定位'}</Button></div>
  </EditorDialog>
}
