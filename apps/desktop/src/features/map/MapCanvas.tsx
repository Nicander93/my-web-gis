import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { mapCommands } from '@/app/commands/map.commands'
import { useProjectStore } from '@/stores/project.store'
import {
  getActiveEditTool,
  isSelectionRuntimeMounted,
  isToolRuntimeMounted,
  mountMapRuntime,
  syncMapFromProject,
  unmountMapRuntime,
  isMapRuntimeMounted
} from './map-runtime-host'

function toolHint(tool: string): string {
  switch (tool) {
    case 'select':
      return '选择工具 · 单击选择要素'
    case 'draw-point':
      return '绘制点 · 单击地图添加'
    case 'draw-line':
      return '绘制线 · 单击添加节点，双击结束'
    case 'draw-polygon':
      return '绘制面 · 单击添加节点，双击结束'
    case 'modify':
      return '修改工具 · 选中后拖动节点'
    case 'delete':
      return '删除工具 · 单击要素删除'
    case 'pan':
      return '平移工具 · 拖动地图'
    default:
      return '地图工具'
  }
}

/** Workspace map surface: mounts OlMapRuntime + selection/tool runtimes and keeps project layers in sync. */
export function MapCanvas() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [readout, setReadout] = useState('0.0000, 0.0000  ·  1:0')
  const [runtimeMounted, setRuntimeMounted] = useState(false)
  const [selectionMounted, setSelectionMounted] = useState(false)
  const [toolMounted, setToolMounted] = useState(false)
  const [hint, setHint] = useState(toolHint('select'))

  useEffect(() => {
    const target = viewportRef.current
    if (!target) return

    const mapState = useProjectStore.getState().project.mapState
    const runtime = mountMapRuntime(target, mapState)
    runtime.onPointerMove((info) => {
      const [x, y] = info.coordinate
      setReadout(`${x.toFixed(4)}, ${y.toFixed(4)}  ·  ${info.scaleText}`)
    })
    syncMapFromProject()
    setRuntimeMounted(true)
    setSelectionMounted(isSelectionRuntimeMounted())
    setToolMounted(isToolRuntimeMounted())
    setHint(toolHint(getActiveEditTool()))

    return () => {
      unmountMapRuntime()
      setRuntimeMounted(false)
      setSelectionMounted(false)
      setToolMounted(false)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (!isMapRuntimeMounted()) return

      const projectChanged =
        state.project.id !== previous.project.id ||
        state.project.layers !== previous.project.layers ||
        state.project.datasets !== previous.project.datasets ||
        state.project.groups !== previous.project.groups ||
        state.project.rootOrder !== previous.project.rootOrder ||
        state.project.basemap !== previous.project.basemap ||
        state.featuresByDataset !== previous.featuresByDataset

      if (projectChanged) syncMapFromProject()
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const node = viewportRef.current?.parentElement
    if (!node) return
    const refresh = () => setHint(toolHint(getActiveEditTool()))
    node.addEventListener('pointerenter', refresh)
    window.addEventListener('desktop-webgis:command-status', refresh)
    return () => {
      node.removeEventListener('pointerenter', refresh)
      window.removeEventListener('desktop-webgis:command-status', refresh)
    }
  }, [runtimeMounted])

  return (
    <section
      className="map-canvas"
      aria-label="地图工作区"
      data-map-runtime={runtimeMounted ? 'mounted' : 'pending'}
      data-selection-runtime={selectionMounted ? 'mounted' : 'pending'}
      data-tool-runtime={toolMounted ? 'mounted' : 'pending'}
    >
      <div
        ref={viewportRef}
        className="map-canvas__viewport"
        data-testid="map-runtime-viewport"
      />
      <div className="map-controls" aria-label="地图导航">
        <Button variant="icon" title="放大" aria-label="放大" onClick={mapCommands.zoomIn}>
          <Plus size={15} />
        </Button>
        <Button variant="icon" title="缩小" aria-label="缩小" onClick={mapCommands.zoomOut}>
          <Minus size={15} />
        </Button>
      </div>
      <div className="map-readout">{readout}</div>
      <div className="map-tool-hint">{hint}</div>
    </section>
  )
}
