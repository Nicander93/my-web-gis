import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Header } from './Header'
import { StatusBar } from './StatusBar'
import { Workspace } from './Workspace'
import { AddDataDialog } from '@/features/add-data/AddDataDialog'
import { ExportDialog } from '@/features/export/ExportDialog'
import {
  registerAddDataCallback,
  registerNewProjectDialog,
  registerProjectReplacementGuard,
  projectCommands,
  registerExportDataCallback,
  type ExportDialogMode
} from './commands/project.commands'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { createId } from '@desktop-webgis/gis-core'
import type { ImportResult } from '@/services/import'
import type { ServiceLayerAddRequest } from '@/features/add-data/ServiceConnectPanel'
import { startWfsBoundedLoad } from '@/services/wfs-commands'
import { useSessionStore } from '@/stores/session.store'
import { emitCommandStatus } from './commands/status'
import '@/styles/editor.css'
import '@/styles/workbench.css'
import { ProcessingDialog } from '@/features/processing/ProcessingDialog'
import { registerProcessingDialog } from './commands/processing.commands'
import { NewProjectDialog } from '@/features/project/NewProjectDialog'
import { getProjectType } from '@/services/project-type'
import { ProjectStartScreen } from '@/features/project/ProjectStartScreen'
import { UnsavedProjectDialog } from '@/features/project/UnsavedProjectDialog'
import { StyleDraftDialog } from '@/features/inspector/StyleDraftDialog'

const CityWorkspace = lazy(() =>
  import('@/features/city/CityWorkspace').then((module) => ({
    default: module.CityWorkspace
  }))
)

export default function App() {
  const project = useProjectStore((state) => state.project)
  const sceneMode = getProjectType(project)
  const hasProject = Boolean(
    project.settings?.workspaceType ||
    project.city ||
    project.layers.length ||
    project.name !== 'Untitled Project'
  )
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [replacementOpen, setReplacementOpen] = useState(false)
  const replacementResolve = useRef<((allow: boolean) => void) | null>(null)
  const [status, setStatus] = useState('就绪')
  const [addDataOpen, setAddDataOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const processingOpen = useWorkbenchStore(
    (state) => state.rightTask === 'processing'
  )
  const closeProcessing = () =>
    useWorkbenchStore.getState().setRightTask('inspector')
  const [exportLayerId, setExportLayerId] = useState<string | null>(null)
  const [exportMode, setExportMode] = useState<ExportDialogMode>('export')
  const addLayer = useProjectStore((state) => state.addLayer)
  const addServiceLayer = useProjectStore((state) => state.addServiceLayer)

  useEffect(() => {
    document.documentElement.dataset.theme = 'light'

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
        !(event.ctrlKey || event.metaKey) ||
        (event.target instanceof HTMLElement &&
          event.target.closest('[role="dialog"]'))
      )
        return
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
      if (useProjectStore.getState().dirty) {
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
    for (const layer of result.layers) {
      const datasetId = createId('dataset')
      addLayer(datasetId, layer.name, layer.features, layer.styleKind)

      if (layer.warnings.length > 0) {
        emitCommandStatus(
          `已导入 ${layer.name}，有 ${layer.warnings.length} 个警告`
        )
      } else {
        emitCommandStatus(
          `已成功导入 ${layer.name}，共 ${layer.features.length} 个要素`
        )
      }
    }
  }

  function handleAddServiceLayers(layers: ServiceLayerAddRequest[]): void {
    let added = 0
    for (const layer of layers) {
      const result = addServiceLayer(layer)
      if (!result) continue
      added += 1
      if (layer.kind === 'wfs' && layer.wfsLoad) {
        const viewExtent = useSessionStore.getState().mapViewExtentWgs84
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
      className={`desktop-app${sceneMode === '3d' ? ' desktop-app--city' : ''}`}
    >
      {(!hasProject || sceneMode === '2d') && <Header showToolbar={hasProject} />}
      {!hasProject ? (
        <ProjectStartScreen />
      ) : sceneMode === '2d' ? (
        <Workspace
          key={project.id}
          processing={
            processingOpen ? (
              <ProcessingDialog
                key={project.id}
                docked
                onClose={closeProcessing}
              />
            ) : undefined
          }
          onCloseProcessing={closeProcessing}
        />
      ) : (
        <Suspense fallback={<p role="status">正在加载三维组件…</p>}>
          <CityWorkspace key={project.id} />
        </Suspense>
      )}
      {hasProject && sceneMode === '2d' && <StatusBar message={status} />}
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
      <StyleDraftDialog />
      <AddDataDialog
        open={addDataOpen}
        onClose={() => setAddDataOpen(false)}
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
