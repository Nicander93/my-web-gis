import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '@/stores/project.store'
import { useSnappingStore } from '@/stores/snapping.store'
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
export function MapCanvas({ leftOffset = 0, rightOffset = 0, bottomOffset = 0 }: {
  leftOffset?: number
  rightOffset?: number
  bottomOffset?: number
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const snapped = useSnappingStore(s => s.snapped)
  const snappingEnabled = useSnappingStore(s => s.options.enabled)
  const [readout, setReadout] = useState('')
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
      setReadout(`${x.toFixed(2)}, ${y.toFixed(2)}  ·  ${info.scaleText}`)
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
      style={{ left: leftOffset, right: rightOffset, bottom: bottomOffset }}
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
      {readout && <div className="map-readout">{readout}</div>}
      {!hint.startsWith('选择工具') && !hint.startsWith('平移工具') && hint !== '地图工具' && (
        <div className="map-tool-hint">{hint}{(hint.startsWith('绘制') || hint.startsWith('修改')) && <span> · {snapped ? '已捕捉' : snappingEnabled ? '捕捉开启' : '捕捉关闭'}</span>}</div>
      )}
    </section>
  )
}
