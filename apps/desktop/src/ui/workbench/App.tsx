import '@/stores/session-view-sync'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { requireMapContent } from '@desktop-webgis/project'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Header } from './Header'
import { StatusBar } from './StatusBar'
import { Workspace2D } from './Workspace2D'
import { AddDataDialog } from '@/ui/panels/add-data/AddDataDialog'
import { useWorkspaceFileDrop } from '@/ui/panels/add-data/use-workspace-file-drop'
import { ExportDialog } from '@/ui/panels/export/ExportDialog'
import {
  registerAddDataCallback,
  registerNewProjectDialog,
  registerProjectReplacementGuard,
  projectCommands,
  registerExportDataCallback,
  type ExportDialogMode
} from '@/commands/project.commands'
import { useProjectStore } from '@/project/project.store'
import { hasUnsavedProjectWork } from '@/project/unsaved-work'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { commitLocalImport } from '@/ui/panels/add-data/local-import-command'
import type { ImportResult } from '@/io/import'
import type { ServiceLayerAddRequest } from '@/ui/panels/add-data/ServiceConnectPanel'
import { startWfsBoundedLoad } from '@/commands/wfs.commands'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { emitCommandStatus } from '@/platform/command-status'
import '@/ui/components/styles/editor.css'
import '@/ui/components/styles/workbench.css'
import '@/ui/components/styles/core-ui.css'
import { ProcessingDialog } from '@/ui/panels/processing/ProcessingDialog'
import { registerProcessingDialog } from '@/commands/processing.commands'
import { NewProjectDialog } from '@/ui/panels/project/NewProjectDialog'
import { getProjectType } from '@/project/project-type'
import { ProjectStartScreen } from '@/ui/panels/project/ProjectStartScreen'
import { UnsavedProjectDialog } from '@/ui/panels/project/UnsavedProjectDialog'
import { HelpDialog } from '@/ui/panels/help/HelpDialog'
import { registerHelpDialog, type HelpDialogPage } from '@/commands/help.commands'
import { viewCommands } from '@/commands/view.commands'
import { RecoveryDraftHost } from '@/ui/panels/project/RecoveryDraftHost'
import { SoftwareSettings } from '@/ui/panels/settings/SoftwareSettings'

const Workspace3D = lazy(() =>
  import('@/ui/workbench/Workspace3D').then((module) => ({
    default: module.Workspace3D
  }))
)

/**
 * Desktop 顶层应用壳：
 * - 根据当前工程类型（2d / 3d）切换 Workspace2D 与 Workspace3D
 * - 统一挂载菜单栏、全局快捷键、导入导出对话框与崩溃恢复草稿宿主
 */
export default function App() {
  const project = useProjectStore((state) => state.project)
  const projectEpoch = useProjectStore((state) => state.projectEpoch)
  const projectType = getProjectType(project)
  const hasProject = Boolean(
    projectEpoch > 0 ||
    project.content.scene ||
    (project.content.kind === 'map2d' && project.content.layers.length) ||
    project.metadata.name !== 'Untitled Project'
  )
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [helpPage, setHelpPage] = useState<HelpDialogPage | null>(null)
  const [replacementOpen, setReplacementOpen] = useState(false)
  const replacementResolve = useRef<((allow: boolean) => void) | null>(null)
  const [status, setStatus] = useState('就绪')
  const [addDataOpen, setAddDataOpen] = useState(false)
  const [droppedFile, setDroppedFile] = useState<File | string | null>(null)
  const draggingFile = useWorkspaceFileDrop(hasProject && projectType === '2d' && !addDataOpen, file => {
    setDroppedFile(file)
    setAddDataOpen(true)
  })
  const [exportOpen, setExportOpen] = useState(false)
  const closeProcessing = () =>
    useWorkbenchStore.getState().setRightTask('inspector')
  const [exportLayerId, setExportLayerId] = useState<string | null>(null)
  const [exportMode, setExportMode] = useState<ExportDialogMode>('export')
  const addServiceLayer = layerContentCommands.addServiceLayer

  useEffect(() => {
    registerHelpDialog(setHelpPage)
    return () => registerHelpDialog(null)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme ||= 'light'

    function handleCommandStatus(event: Event): void {
      setStatus((event as CustomEvent<string>).detail)
    }

    window.addEventListener(
      'desktop-webgis:command-status',
      handleCommandStatus
    )
    registerProcessingDialog(() => {
      useWorkbenchStore.getState().setRightTask('processing')
      useWorkspaceStore.getState().setRightOpen(true)
    })
    registerNewProjectDialog(() => setNewProjectOpen(true))
    registerProjectReplacementGuard(
      () =>
        new Promise<boolean>((resolve) => {
          replacementResolve.current = resolve
          setReplacementOpen(true)
        })
    )

    registerAddDataCallback({
      openDialog: () => setAddDataOpen(true)
    })

    registerExportDataCallback({
      openDialog: (layerId, mode = 'export') => {
        setExportLayerId(layerId ?? null)
        setExportMode(mode)
        setExportOpen(true)
      }
    })

    return () => {
      window.removeEventListener(
        'desktop-webgis:command-status',
        handleCommandStatus
      )
      registerProcessingDialog(null)
      registerNewProjectDialog(null)
      registerProjectReplacementGuard(null)
      replacementResolve.current?.(false)
    }
  }, [])

  useEffect(() => {
    function shortcut(event: KeyboardEvent): void {
      if (
        event.defaultPrevented || event.isComposing ||
        !(event.ctrlKey || event.metaKey) ||
        (event.target instanceof HTMLElement &&
          event.target.closest('[role="dialog"]'))
      )
        return
      if (event.shiftKey && getProjectType(useProjectStore.getState().project) === '3d' &&
        !(event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"],[role="menu"]'))) {
        const shortcuts: Partial<Record<string, () => void>> = { l: viewCommands.toggleLayers, i: viewCommands.toggleInspector, '0': viewCommands.resetLayout, f: viewCommands.toggleFocusMode }
        const action = shortcuts[event.key.toLowerCase()]
        if (action) { event.preventDefault(); action(); return }
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setNewProjectOpen(true)
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void (event.shiftKey
          ? projectCommands.saveProjectAs()
          : projectCommands.saveProject())
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void projectCommands.openProject()
      }
    }
    function guard(event: BeforeUnloadEvent): void {
      if (hasUnsavedProjectWork()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('keydown', shortcut)
    window.addEventListener('beforeunload', guard)
    return () => {
      window.removeEventListener('keydown', shortcut)
      window.removeEventListener('beforeunload', guard)
    }
  }, [])

  function handleImport(result: ImportResult): void {
    commitLocalImport(result)
    const total = result.layers.reduce((sum, layer) => sum + layer.features.length, 0)
    const warnings = result.layers.reduce((sum, layer) => sum + layer.warnings.length, 0)
    emitCommandStatus(`已导入 ${result.layers.length} 个图层，共 ${total} 个要素${warnings ? `，有 ${warnings} 个警告` : ''}；可一步撤销`)
  }

  function handleAddServiceLayers(layers: ServiceLayerAddRequest[]): void {
    let added = 0
    for (const layer of layers) {
      const result = addServiceLayer(layer)
      if (!result) continue
      added += 1
      if (layer.kind === 'wfs' && layer.wfsLoad) {
        const viewExtent = useLayerViewStore.getState().mapViewExtentWgs84
        void startWfsBoundedLoad({
          layerId: result.layerId,
          datasetId: result.datasetId,
          description: layer.wfsLoad.description,
          selection: {
            typeName: layer.source.type === 'wfs' ? layer.source.typeName : '',
            outputFormat:
              layer.source.type === 'wfs'
                ? layer.source.outputFormat
                : undefined,
            srsName:
              layer.source.type === 'wfs' ? layer.source.srsName : undefined,
            maxFeatures: layer.wfsLoad.maxFeatures,
            extentMode: layer.wfsLoad.extentMode,
            viewExtentWgs84:
              layer.wfsLoad.extentMode === 'view' ? viewExtent : undefined
          },
          authMode: layer.wfsLoad.authMode,
          tokenParam: layer.wfsLoad.tokenParam,
          credentialRefKey: layer.wfsLoad.credentialRefKey,
          isRefresh: false
        })
      }
    }
    emitCommandStatus(
      added > 0 ? `已添加 ${added} 个服务图层` : '未添加服务图层'
    )
  }

  return (
    <div
      className={`desktop-app${projectType === '3d' ? ' desktop-app--scene3d' : ''}`}
    >
      <Header showToolbar={hasProject} />
      {draggingFile && <div className="workspace-file-drop" role="status">松开以添加数据 · 一次一个文件</div>}
      {!hasProject ? (
        <ProjectStartScreen />
      ) : projectType === '2d' ? (
        <Workspace2D
          key={project.metadata.id}
          processing={
            (
              <ProcessingDialog
                key={project.metadata.id}
                docked
                onClose={closeProcessing}
              />
            )
          }
          onCloseProcessing={closeProcessing}
        />
      ) : (
        <Suspense fallback={<p role="status">正在加载三维组件…</p>}>
          <Workspace3D key={`${project.metadata.id}:${projectEpoch}`} />
        </Suspense>
      )}
      {hasProject && projectType === '2d' && <StatusBar message={status} />}
      {newProjectOpen && (
        <NewProjectDialog onClose={() => setNewProjectOpen(false)} />
      )}
      {replacementOpen && (
        <UnsavedProjectDialog
          onResolve={(allow) => {
            setReplacementOpen(false)
            replacementResolve.current?.(allow)
            replacementResolve.current = null
          }}
        />
      )}
      <RecoveryDraftHost />
      <SoftwareSettings />
      {helpPage && <HelpDialog page={helpPage} onClose={() => setHelpPage(null)} />}
      <AddDataDialog
        open={addDataOpen}
        droppedFile={droppedFile}
        onClose={() => { setAddDataOpen(false); setDroppedFile(null) }}
        onImport={handleImport}
        onAddServiceLayers={handleAddServiceLayers}
      />
      <ExportDialog
        open={exportOpen}
        layerId={exportLayerId}
        mode={exportMode}
        onClose={() => {
          setExportOpen(false)
          setExportLayerId(null)
          setExportMode('export')
        }}
      />
    </div>
  )
}
