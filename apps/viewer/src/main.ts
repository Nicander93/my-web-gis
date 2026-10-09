import { OlDocumentRuntime } from '@desktop-webgis/ol-scene-runtime'
import { bindSceneRuntime, SceneController } from '@desktop-webgis/scene-core'
import {
  type PopupField,
  type SceneColor,
  type SceneLayerStyle,
  type SceneDocument,
  type SceneSymbol,
  type SceneNode
} from '@desktop-webgis/scene-schema'
import Overlay from 'ol/Overlay'
import { defaults as defaultControls, FullScreen, MousePosition, ScaleLine } from 'ol/control.js'
import { loadViewerDocument } from './scene-document'
import { createViewerSelection } from './selection'
import 'ol/ol.css'
import './style.css'

interface RuntimeConfig {
  credentials?: Record<string, string>
}

const mapTarget = requireElement<HTMLElement>('map')
const titleElement = requireElement<HTMLElement>('scene-title')
const descriptionElement = requireElement<HTMLElement>('scene-description')
const layerPanel = requireElement<HTMLElement>('layer-panel')
const layerList = requireElement<HTMLElement>('layer-list')
const legendPanel = requireElement<HTMLElement>('legend-panel')
const legendList = requireElement<HTMLElement>('legend-list')
const popupElement = requireElement<HTMLElement>('popup')
const popupTitle = requireElement<HTMLElement>('popup-title')
const popupFields = requireElement<HTMLElement>('popup-fields')
const popupClose = requireElement<HTMLButtonElement>('popup-close')
const statusElement = requireElement<HTMLElement>('scene-status')

type MapNode = Extract<SceneNode, { type: 'tile' | 'vector' }>
type VectorNode = Extract<SceneNode, { type: 'vector' }>
let sceneController: SceneController

function mapNodes(document: SceneDocument): MapNode[] {
  return document.nodes.filter((node): node is MapNode => node.type === 'tile' || node.type === 'vector')
}

void start()

async function start(): Promise<void> {
  const startup = new AbortController()
  window.addEventListener('pagehide', () => startup.abort(), { once: true })
  try {
    const sceneUrl = new URL(new URLSearchParams(window.location.search).get('scene') ?? './scene.json', document.baseURI).href
    const scene = await loadViewerDocument(sceneUrl, fetch, startup.signal)
    const runtimeConfig = await loadRuntimeConfig()
    startup.signal.throwIfAborted()

    document.title = scene.title
    titleElement.textContent = scene.title
    descriptionElement.textContent = scene.description ?? ''
    descriptionElement.hidden = !scene.description

    applyTheme(scene)
    const active = scene.views[scene.activeView]
    const mapView = active.type === '2d' ? scene.activeView : Object.entries(scene.views).find(([, view]) => view.type === '2d')?.[0]
    const cityView = active.type === '3d' ? scene.activeView : Object.entries(scene.views).find(([, view]) => view.type === '3d')?.[0]
    const mode = new URLSearchParams(window.location.search).get('mode')
    if (cityView && mode !== '2d' && (mode === '3d' || active.type === '3d')) {
      const { renderCityViewer } = await import('./city-viewer')
      await renderCityViewer(scene, sceneUrl, cityView)
      return
    }
    if (!mapView) throw new Error('场景没有二维视图')
    sceneController = new SceneController(scene)
    const runtime = new OlDocumentRuntime({
      target: mapTarget,
      viewId: mapView,
      credentials: runtimeConfig.credentials
    })
    let selection: ReturnType<typeof createViewerSelection> | undefined
    const binding = bindSceneRuntime(sceneController, runtime)
    window.addEventListener('pagehide', () => { binding.dispose(); selection?.dispose(); runtime.destroy(); sceneController.dispose() }, { once: true })
    try {
      const synchronized = await binding.settled()
      startup.signal.throwIfAborted()
      if (synchronized.status === 'error') throw synchronized.error
    } catch (error) { binding.dispose(); runtime.destroy(); sceneController.dispose(); throw error }
    const map = runtime.getNativeMap()
    selection = createViewerSelection(runtime)
    const widgets = scene.widgets ?? {}
    defaultControls({ zoom: widgets.zoom ?? true, rotate: false, attribution: true }).forEach(control => map.addControl(control))
    if (widgets.scaleLine) map.addControl(new ScaleLine())
    if (widgets.fullscreen) map.addControl(new FullScreen())
    if (widgets.mousePosition) map.addControl(new MousePosition())
    const popupOverlay = new Overlay({
      element: popupElement,
      positioning: 'bottom-center',
      offset: [0, -14],
      stopEvent: true
    })
    map.addOverlay(popupOverlay)

    map.on('singleclick', event => map.forEachFeatureAtPixel(event.pixel, (feature, layer) => {
      const node = mapNodes(sceneController.getDocument()).find(node => runtime.getLayer(node.id) === layer)
      if (node?.type !== 'vector' || !node.interaction?.popup) return undefined
      showPopup({ layerId: node.id, properties: feature.getProperties(), coordinate: event.coordinate }, popupOverlay)
      return feature
    }))

    popupClose.addEventListener('click', () => {
      popupOverlay.setPosition(undefined)
      popupElement.hidden = true
    })

    renderLayerSwitcher(scene, (id, visible) => {
      try { sceneController.setNodeVisible(id, visible) }
      catch (error) { showError(String(error)); return }
      void binding.settled().then(state => {
        if (state.status === 'error') showError(String(state.error))
        if (state.status === 'ready') selection?.refresh()
      })
    })
    renderLegend(scene)
    const issues = runtime.getIssues()
    statusElement.textContent = issues.length ? issues.map(issue => `${issue.path}: ${issue.message}`).join('\n') : '场景已加载'
    if (!issues.length) window.setTimeout(() => statusElement.classList.add('scene-status--quiet'), 1800)
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error))
  }
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch('./runtime-config.json')
    if (!response.ok) return {}
    const value = (await response.json()) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const credentials = (value as Record<string, unknown>).credentials
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) return {}
    return {
      credentials: Object.fromEntries(
        Object.entries(credentials).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
    }
  } catch {
    return {}
  }
}

function applyTheme(manifest: SceneDocument): void {
  const theme = manifest.theme
  if (!theme) return
  document.documentElement.dataset.colorScheme = theme.colorScheme ?? 'light'
  if (theme.accent) document.documentElement.style.setProperty('--scene-accent', theme.accent)
  if (theme.fontFamily) document.documentElement.style.setProperty('--scene-font-family', theme.fontFamily)
  if (theme.surface) document.documentElement.dataset.surface = theme.surface
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Viewer 缺少 #${id} 元素`)
  return element as T
}

function renderLayerSwitcher(manifest: SceneDocument, setVisible: (layerId: string, visible: boolean) => void): void {
  if (!manifest.widgets?.layerSwitcher) return
  layerPanel.hidden = false
  layerList.replaceChildren(
    ...manifest.nodes.filter(node => node.type === 'tile' || node.type === 'vector' || node.type === 'group' && node.scope !== '3d').reverse().map((layer) => {
      const label = document.createElement('label')
      label.className = 'layer-row'
      const checkbox = document.createElement('input')
      const basemap = 'role' in layer && layer.role === 'basemap'
      checkbox.type = basemap ? 'radio' : 'checkbox'
      if (basemap) checkbox.name = 'scene-basemap'
      checkbox.checked = layer.visible ?? true
      checkbox.addEventListener('change', () => {
        if (basemap && checkbox.checked) {
          for (const candidate of mapNodes(manifest)) {
            if (candidate.role === 'basemap') setVisible(candidate.id, candidate.id === layer.id)
          }
        } else {
          setVisible(layer.id, checkbox.checked)
        }
      })
      const name = document.createElement('span')
      name.textContent = layer.name
      label.append(checkbox, name)
      return label
    })
  )
}

function colorToCss(color: SceneColor | undefined, fallback = 'transparent'): string {
  if (!color) return fallback
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`
}

function primarySymbol(style: SceneLayerStyle): SceneSymbol {
  if (style.mode === 'single') return style.symbol
  if (style.mode === 'categorized') return style.categories[0]?.symbol ?? style.fallback
  return style.breaks[0]?.symbol ?? style.fallback
}

function symbolKind(symbol: SceneSymbol): 'point' | 'line' | 'polygon' {
  if (symbol.type === 'circle') return 'point'
  if (symbol.type === 'solid' && 'width' in symbol && !('fill' in symbol)) return 'line'
  if (symbol.type === 'mixed') return symbol.point ? 'point' : symbol.line ? 'line' : 'polygon'
  return 'polygon'
}

function applyLegendSymbol(element: HTMLSpanElement, symbol: SceneSymbol): void {
  const kind = symbolKind(symbol)
  element.className = `legend-symbol legend-symbol--${kind}`
  if (symbol.type === 'circle') {
    element.style.background = colorToCss(symbol.fill, '#94a3b8')
    element.style.borderColor = colorToCss(symbol.stroke, 'transparent')
    return
  }
  if (symbol.type === 'solid' && 'width' in symbol && !('fill' in symbol)) {
    element.style.background = colorToCss(symbol.color, '#64748b')
    element.style.height = `${Math.max(2, symbol.width)}px`
    return
  }
  if (symbol.type === 'solid') {
    if ('width' in symbol) {
      element.style.background = colorToCss(symbol.color, '#64748b')
      element.style.height = `${Math.max(2, symbol.width)}px`
    } else {
      element.style.background = colorToCss(symbol.fill, '#94a3b8')
      element.style.borderColor = colorToCss(symbol.stroke, 'transparent')
    }
    return
  }
  const nested = symbol.point ?? symbol.polygon ?? symbol.line
  if (nested) applyLegendSymbol(element, nested)
}

function renderLegend(manifest: SceneDocument): void {
  if (!manifest.widgets?.legend) return
  const vectorLayers = mapNodes(manifest).filter((layer): layer is VectorNode => layer.type === 'vector')
  if (vectorLayers.length === 0) return
  legendPanel.hidden = false
  legendList.replaceChildren(
    ...vectorLayers.map((layer) => {
      const row = document.createElement('div')
      row.className = 'legend-row'
      const symbol = document.createElement('span')
      applyLegendSymbol(symbol, primarySymbol(layer.style))
      const name = document.createElement('span')
      name.textContent = layer.name
      row.append(symbol, name)
      return row
    })
  )
}

function showPopup(event: { layerId: string; properties: Record<string, unknown>; coordinate: number[] }, overlay: Overlay): void {
  const layer = sceneController.getDocument().nodes.find(
    (candidate): candidate is VectorNode => candidate.id === event.layerId && candidate.type === 'vector'
  )
  const popup = layer?.interaction?.popup
  if (!popup) return

  const properties = event.properties
  popupTitle.textContent = popup.titleField ? formatText(properties[popup.titleField]) : layer.name
  popupFields.replaceChildren(
    ...popup.fields.map((field) => createPopupField(field, properties[field.field]))
  )
  popupElement.hidden = false
  overlay.setPosition(event.coordinate)
}

function createPopupField(field: PopupField, value: unknown): HTMLElement {
  const group = document.createElement('div')
  group.className = 'popup-field'
  const term = document.createElement('dt')
  term.textContent = field.label ?? field.field
  const description = document.createElement('dd')

  if (field.format === 'url' && typeof value === 'string' && isSafeHttpUrl(value)) {
    const link = document.createElement('a')
    link.href = value
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = value
    description.append(link)
  } else if (field.format === 'number' && typeof value === 'number') {
    description.textContent = new Intl.NumberFormat().format(value)
  } else if (field.format === 'date' && (typeof value === 'string' || typeof value === 'number')) {
    const date = new Date(value)
    description.textContent = Number.isNaN(date.getTime()) ? formatText(value) : date.toLocaleString()
  } else {
    description.textContent = formatText(value)
  }

  group.append(term, description)
  return group
}

function formatText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function showError(message: string): void {
  statusElement.classList.remove('scene-status--quiet')
  statusElement.classList.add('scene-status--error')
  statusElement.textContent = message
}
