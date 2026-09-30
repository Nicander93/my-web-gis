import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { mapCommands } from '@/app/commands/map.commands'
import { useProjectStore } from '@/stores/project.store'
import {
  mountMapRuntime,
  syncMapFromProject,
  unmountMapRuntime,
  isMapRuntimeMounted
} from './map-runtime-host'

/** Workspace map surface: mounts the shared OlMapRuntime and keeps project layers in sync. */
export function MapCanvas() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [readout, setReadout] = useState('0.0000, 0.0000\u00a0\u00a0·\u00a0\u00a01:0')
  const [runtimeMounted, setRuntimeMounted] = useState(false)

  useEffect(() => {
    const target = viewportRef.current
    if (!target) return

    const mapState = useProjectStore.getState().project.mapState
    const runtime = mountMapRuntime(target, mapState)
    runtime.onPointerMove((info) => {
      const [x, y] = info.coordinate
      setReadout(`${x.toFixed(4)}, ${y.toFixed(4)}\u00a0\u00a0·\u00a0\u00a0${info.scaleText}`)
    })
    syncMapFromProject()
    setRuntimeMounted(true)

    return () => {
      unmountMapRuntime()
      setRuntimeMounted(false)
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

  return (
    <section
      className="map-canvas"
      aria-label="地图工作区"
      data-map-runtime={runtimeMounted ? 'mounted' : 'pending'}
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
      <div className="map-tool-hint">选择工具 · 单击选择要素</div>
    </section>
  )
}
