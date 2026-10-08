import { EditorDialog } from '@/components/ui/EditorDialog'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useSessionStore } from '@/stores/session.store'
import { useProjectStore } from '@/stores/project.store'
import { layerCommands } from '@/app/commands/layer.commands'
import { useWorkspaceStore } from '@/stores/workspace.store'

/** 切换配置对象前显式处理草稿，取消时保留原对象与输入。 */
export function StyleDraftDialog() {
  const request = useWorkbenchStore((state) => state.pendingInspector)
  const previousId = useWorkbenchStore((state) => state.inspectorLayerId)
  const layers = useProjectStore((state) => state.project.layers)
  if (!request || !previousId) return null
  const previous = layers.find((layer) => layer.id === previousId)
  const next = layers.find((layer) => layer.id === request.layerId)
  const close = () => useWorkbenchStore.getState().setPendingInspector(null)
  function resolve(apply: boolean) {
    const draft = useSessionStore
      .getState()
      .getLayerSession(previousId!).styleDraft
    if (apply && draft && !layerCommands.applyStyle(previousId!, draft.style))
      return
    if (!apply) layerCommands.resetStyleDraft(previousId!)
    close()
    if (!next) return
    useWorkbenchStore.getState().bindInspector(request!.layerId)
    useSessionStore.getState().setInspectorTab(request!.layerId, request!.tab)
    useWorkspaceStore.getState().setRightOpen(true)
  }
  return (
    <EditorDialog title="样式尚未应用" onClose={close}>
      <div className="dialog-body">
        <p>
          「{previous?.name}」有未应用的样式或标注修改。切换到「
          {next?.name ?? '已移除图层'}」前，如何处理这些修改？
        </p>
      </div>
      <footer className="dialog-footer">
        <button className="button-secondary" onClick={close}>
          取消切换
        </button>
        <button className="button-secondary" onClick={() => resolve(false)}>
          丢弃草稿并切换
        </button>
        <button className="button-primary" onClick={() => resolve(true)}>
          应用并切换
        </button>
      </footer>
    </EditorDialog>
  )
}
