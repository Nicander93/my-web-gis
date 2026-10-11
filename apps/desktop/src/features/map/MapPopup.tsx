import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Feature from 'ol/Feature'
import Overlay from 'ol/Overlay'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { getActiveEditTool, getMapRuntime } from './map-runtime-host'

interface PopupTarget { layerId: string; featureId: string; coordinate: number[] }

function displayValue(value: unknown, format?: string): string {
  if (value === null || value === undefined) return '—'
  if (format === 'number' && typeof value === 'number') return value.toLocaleString('zh-CN')
  if (format === 'date' && typeof value === 'string') {
    const date = new Date(value)
    if (Number.isFinite(date.getTime())) return date.toLocaleString('zh-CN')
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** A modeless, text-only popup independent of editing and map selection permissions. */
export function MapPopup() {
  const [element] = useState(() => document.createElement('div'))
  const overlay = useRef<Overlay | null>(null)
  const current = useRef<PopupTarget | null>(null)
  const [target, setTarget] = useState<PopupTarget | null>(null)
  const project = useProjectStore(state => state.project)
  const features = useProjectStore(state => state.featuresByDataset)
  const activeTool = useWorkbenchStore(state => state.activeTool)
  const layer = project.layers.find(item => item.id === target?.layerId)
  const feature = layer && features[layer.datasetId]?.find(item => item.id === target?.featureId)
  const definition = layer?.interaction?.popup
  const close = useCallback(() => { current.current = null; setTarget(null) }, [])

  useEffect(() => {
    const runtime = getMapRuntime()
    if (!runtime) return
    const map = runtime.getMap()
    const mounted = new Overlay({ element, positioning: 'bottom-left', offset: [10, -10], stopEvent: true,
      autoPan: { margin: 12, animation: { duration: 100 } } })
    overlay.current = mounted
    map.addOverlay(mounted)
    const click = (event: { pixel: number[]; coordinate: number[] }) => {
      if (!['select', 'pan'].includes(getActiveEditTool())) return
      const hit = map.forEachFeatureAtPixel(event.pixel, (native, nativeLayer) => {
        if (!(native instanceof Feature)) return undefined
        const entry = runtime.registry.entries().find(([, candidate]) => candidate === nativeLayer)
        if (!entry || !runtime.isLayerVisible(entry[0]) || !runtime.isFeatureIncluded(entry[0], native)) return undefined
        const state = useProjectStore.getState()
        const candidate = state.project.layers.find(item => item.id === entry[0])
        const id = native.get('domainFeatureId') ?? native.getId()
        if (!candidate?.interaction?.popup?.fields.length || id === undefined) return undefined
        if (!state.featuresByDataset[candidate.datasetId]?.some(item => item.id === String(id))) return undefined
        return { layerId: candidate.id, featureId: String(id), coordinate: event.coordinate }
      }, { hitTolerance: 6 })
      current.current = hit ?? null
      setTarget(hit ?? null)
    }
    const verify = () => {
      const value = current.current
      if (!value) return
      const native = runtime.registry.getVector(value.layerId)?.getSource()?.getFeatureById(value.featureId)
      if (!(native instanceof Feature) || !runtime.isLayerVisible(value.layerId) || !runtime.isFeatureIncluded(value.layerId, native)) close()
    }
    map.on('singleclick', click)
    map.on('postrender', verify)
    return () => {
      map.un('singleclick', click); map.un('postrender', verify)
      map.removeOverlay(mounted); mounted.setElement(undefined)
      overlay.current = null; current.current = null
    }
  }, [close, element])

  useEffect(() => { overlay.current?.setPosition(target?.coordinate) }, [target])
  useEffect(() => {
    if (!feature || !definition?.fields.length || !['select', 'pan'].includes(activeTool)) close()
  }, [feature, definition, activeTool, close])

  return createPortal(<div className="map-popup" role="dialog" aria-label="要素属性弹窗" hidden={!target || !feature || !definition}
    onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
        event.preventDefault(); event.stopPropagation(); close()
      }
    }}>
    <header><strong>{definition?.titleField && feature ? displayValue(feature.properties[definition.titleField]) : layer?.name}</strong>
      <button type="button" aria-label="关闭属性弹窗" onClick={close}>×</button></header>
    <dl>{definition?.fields.map(field => <div key={field.field}>
      <dt>{field.label ?? field.field}</dt><dd>{displayValue(feature?.properties[field.field], field.format)}</dd>
    </div>)}</dl>
  </div>, element)
}
