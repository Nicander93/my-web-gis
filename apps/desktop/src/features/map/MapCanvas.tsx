import { useEffect, useRef, useState } from 'react'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useProjectStore } from '@/stores/project.store'
import { useSnappingStore } from '@/stores/snapping.store'
import { MapPopup } from './MapPopup'
import { MapIdentify } from './MapIdentify'
import { installTemporaryPan } from './temporary-pan'
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
    case 'select': {
      const { project, selectedLayerId } = useProjectStore.getState()
      if (project.layers.find(layer => layer.id === selectedLayerId)?.interaction?.selectable === false) {
        return '此图层未启用地图选择；属性表仍可选择和定位'
      }
      return '单击或拖框选择 · Shift 追加 · Alt 移除 · Esc 取消'
    }
    case 'draw-point':
      return '绘制点 · 单击地图添加'
    case 'draw-line':
      return '绘制线 · 单击添加节点，双击完成 · Esc 取消草稿'
    case 'draw-polygon':
      return '绘制面 · 单击添加节点，双击完成 · Esc 取消草稿'
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
  const snapped = useSnappingStore((s) => s.snapped)
  const snappingEnabled = useSnappingStore((s) => s.options.enabled)
  const [runtimeMounted, setRuntimeMounted] = useState(false)
  const [selectionMounted, setSelectionMounted] = useState(false)
  const [toolMounted, setToolMounted] = useState(false)
  const [hint, setHint] = useState(toolHint('select'))

  useEffect(() => {
    const target = viewportRef.current
    if (!target) return

    const mapState = useProjectStore.getState().project.mapState
    const runtime = mountMapRuntime(target, mapState)
    const disposePan = installTemporaryPan(runtime.getMap())
    runtime.onPointerMove((info) => {
      const [x, y] = info.coordinate
      useWorkbenchStore
        .getState()
        .setMapReadout(`${x.toFixed(2)}, ${y.toFixed(2)}  ·  ${info.scaleText}`)
    })
    syncMapFromProject()
    setRuntimeMounted(true)
    setSelectionMounted(isSelectionRuntimeMounted())
    setToolMounted(isToolRuntimeMounted())
    setHint(toolHint(getActiveEditTool()))

    return () => {
      disposePan()
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
        state.project !== previous.project ||
        state.featuresByDataset !== previous.featuresByDataset

      if (projectChanged) syncMapFromProject()
      if (state.project.crs !== previous.project.crs) useWorkbenchStore.getState().setMapReadout('')
      if (projectChanged || state.selectedLayerId !== previous.selectedLayerId) setHint(toolHint(getActiveEditTool()))
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
      tabIndex={0}
      title="中键拖动或空格 + 左键拖动可随时平移地图"
      data-map-runtime={runtimeMounted ? 'mounted' : 'pending'}
      data-selection-runtime={selectionMounted ? 'mounted' : 'pending'}
      data-tool-runtime={toolMounted ? 'mounted' : 'pending'}
    >
      <div
        ref={viewportRef}
        className="map-canvas__viewport"
        data-testid="map-runtime-viewport"
      />
      {runtimeMounted && <><MapIdentify /><MapPopup /></>}
      {!hint.startsWith('选择工具') &&
        !hint.startsWith('平移工具') &&
        hint !== '地图工具' && (
          <button type="button" className="map-tool-hint"
            aria-label={`当前工具说明：${hint}`}
            title={`${hint}${hint.startsWith('绘制') || hint.startsWith('修改') ? ` · ${snapped ? '已捕捉' : snappingEnabled ? '捕捉开启' : '捕捉关闭'}` : ''}`}>
            {snapped && (hint.startsWith('绘制') || hint.startsWith('修改')) ? '已捕捉' : 'i'}
          </button>
        )}
    </section>
  )
}
