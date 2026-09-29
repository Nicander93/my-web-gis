import { useEffect, useState } from 'react'
import { Header } from './Header'
import { StatusBar } from './StatusBar'
import { Workspace } from './Workspace'
import { AddDataDialog } from '@/features/add-data/AddDataDialog'
import { ExportDialog } from '@/features/export/ExportDialog'
import {
  registerAddDataCallback,
  registerExportDataCallback,
  type ExportDialogMode
} from './commands/project.commands'
import { useProjectStore } from '@/stores/project.store'
import { createId } from '@desktop-webgis/gis-core'
import type { ImportResult } from '@/services/import'
import { emitCommandStatus } from './commands/status'

export default function App() {
  const [status, setStatus] = useState('就绪')
  const [addDataOpen, setAddDataOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportLayerId, setExportLayerId] = useState<string | null>(null)
  const [exportMode, setExportMode] = useState<ExportDialogMode>('export')
  const addLayer = useProjectStore((state) => state.addLayer)

  useEffect(() => {
    document.documentElement.dataset.theme = 'light'

    function handleCommandStatus(event: Event): void {
      setStatus((event as CustomEvent<string>).detail)
    }

    window.addEventListener('desktop-webgis:command-status', handleCommandStatus)

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

    return () => window.removeEventListener('desktop-webgis:command-status', handleCommandStatus)
  }, [])

  function handleImport(result: ImportResult): void {
    for (const layer of result.layers) {
      const datasetId = createId('dataset')
      addLayer(datasetId, layer.name, layer.features, layer.styleKind)

      if (layer.warnings.length > 0) {
        emitCommandStatus(`已导入 ${layer.name}，有 ${layer.warnings.length} 个警告`)
      } else {
        emitCommandStatus(`已成功导入 ${layer.name}，共 ${layer.features.length} 个要素`)
      }
    }
  }

  return (
    <div className="desktop-app">
      <Header />
      <Workspace />
      <StatusBar message={status} />
      <AddDataDialog
        open={addDataOpen}
        onClose={() => setAddDataOpen(false)}
        onImport={handleImport}
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
