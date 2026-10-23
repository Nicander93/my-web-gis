import { useMemo, useState } from 'react'
import { Alert, Button, Input } from 'antd'
import { findSecretLeaks } from '@desktop-webgis/gis-core'
import { generateCesiumModule, inspectCesiumCodegenCapabilities } from '@desktop-webgis/scene-codegen'
import { ModelessWindow } from '@/components/ui/ModelessWindow'
import { useProjectStore } from '@/stores/project.store'
import { createProjectSceneDocument } from '../scene/project-scene-document'
import { saveCesiumModule } from '@/services/cesium-code-export'

/** A reviewed standalone export, separate from project and scene JSON persistence. */
export function CesiumCodeExportWindow({ onClose }: { onClose(): void }) {
  const project = useProjectStore(state => state.project)
  const features = useProjectStore(state => state.featuresByDataset)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const result = useMemo(() => {
    try {
      const document = createProjectSceneDocument(useProjectStore.getState().getSnapshot())
      const leaks = findSecretLeaks(document)
      if (leaks.length) throw new Error(`场景含疑似密钥字段：${leaks.slice(0, 5).join(', ')}`)
      const diagnostics = inspectCesiumCodegenCapabilities(document)
      const blocked = diagnostics.some(item => item.severity === 'error')
      return { diagnostics, code: blocked ? '' : generateCesiumModule(document), error: '' }
    } catch (reason) { return { diagnostics: [], code: '', error: reason instanceof Error ? reason.message : '生成代码失败' } }
  }, [project, features])
  async function save(): Promise<void> {
    if (!result.code || saving) return
    setSaving(true); setStatus('')
    try {
      const saved = await saveCesiumModule(result.code, project.name)
      setStatus(saved === 'cancelled' ? '已取消导出' : saved === 'saved' ? 'CesiumJS 模块已保存' : 'CesiumJS 模块下载已发起')
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : '导出失败') }
    finally { setSaving(false) }
  }
  return <ModelessWindow title="导出 CesiumJS 代码" width={820} height={580} onClose={onClose}>
    <div className="cesium-code-export">
      <p>目标 Cesium 1.145.0。代码仅依赖原生 CesiumJS；在独立项目中创建 Viewer 后调用 <code>createScene(viewer, hooks)</code>。项目保存与场景 JSON 导出仍使用文件菜单。</p>
      <Alert type="info" showIcon title="外部资源继续使用引用。独立运行时需确保资源可达，并通过 hooks.resolveResource 注入本地资源映射或凭据；设备 DPI/MSAA 偏好不导出。" />
      {result.error && <Alert type="error" showIcon title={result.error} />}
      {result.diagnostics.map((item, index) => <Alert key={index} type={item.severity === 'error' ? 'error' : 'warning'} showIcon title={item.message} description={item.path} />)}
      {result.code && <Input.TextArea aria-label="CesiumJS 代码预览" readOnly value={result.code} autoSize={{ minRows: 10, maxRows: 20 }} spellCheck={false} />}
      {status && <p role="status">{status}</p>}
      <footer><Button onClick={onClose}>关闭</Button><Button type="primary" loading={saving} disabled={!result.code} onClick={() => void save()}>保存 JavaScript 模块</Button></footer>
    </div>
  </ModelessWindow>
}
