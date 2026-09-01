import { createSceneRuntime, type RuntimeFeatureClickEvent } from '@desktop-webgis/ol-scene-runtime'
import { parseScene, type PopupField, type SceneManifest, type VectorLayer } from '@desktop-webgis/scene-schema'
import Map from 'ol/Map'
import Overlay from 'ol/Overlay'
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

let scene: SceneManifest

void start()

async function start(): Promise<void> {
  try {
    const sceneUrl = new URLSearchParams(window.location.search).get('scene') ?? './scene.json'
    const response = await fetch(sceneUrl)
    if (!response.ok) throw new Error(`场景加载失败：HTTP ${response.status}`)
    scene = parseScene(await response.json())
    const runtimeConfig = await loadRuntimeConfig()

    document.title = scene.title
    titleElement.textContent = scene.title
    descriptionElement.textContent = scene.description ?? ''
    descriptionElement.hidden = !scene.description

    applyTheme(scene)
    const runtime = await createSceneRuntime({
      target: mapTarget,
      scene,
      credentials: runtimeConfig.credentials
    })
    const map = runtime.getNativeMap() as Map
    const popupOverlay = new Overlay({
      element: popupElement,
      positioning: 'bottom-center',
      offset: [0, -14],
      stopEvent: true
    })
    map.addOverlay(popupOverlay)

    runtime.on('feature:click', (event) => showPopup(event, popupOverlay))
    runtime.on('scene:error', ({ error }) => showError(error.message))
    runtime.on('layer:error', ({ layerId, error }) => showError(`${layerId}: ${error.message}`))

    popupClose.addEventListener('click', () => {
      popupOverlay.setPosition(undefined)
      popupElement.hidden = true
    })

    renderLayerSwitcher(scene, runtime.setLayerVisible.bind(runtime))
    renderLegend(scene)
    statusElement.textContent = '场景已加载'
    window.setTimeout(() => statusElement.classList.add('scene-status--quiet'), 1800)
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

function applyTheme(manifest: SceneManifest): void {
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

function renderLayerSwitcher(manifest: SceneManifest, setVisible: (layerId: string, visible: boolean) => void): void {
  if (!manifest.widgets?.layerSwitcher) return
  layerPanel.hidden = false
  layerList.replaceChildren(
    ...[...manifest.layers].reverse().map((layer) => {
      const label = document.createElement('label')
      label.className = 'layer-row'
      const checkbox = document.createElement('input')
      checkbox.type = layer.role === 'basemap' ? 'radio' : 'checkbox'
      if (layer.role === 'basemap') checkbox.name = 'scene-basemap'
      checkbox.checked = layer.visible ?? true
      checkbox.addEventListener('change', () => {
        if (layer.role === 'basemap' && checkbox.checked) {
          for (const candidate of manifest.layers) {
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

function renderLegend(manifest: SceneManifest): void {
  if (!manifest.widgets?.legend) return
  const vectorLayers = manifest.layers.filter((layer): layer is VectorLayer => layer.type === 'vector')
  if (vectorLayers.length === 0) return
  legendPanel.hidden = false
  legendList.replaceChildren(
    ...vectorLayers.map((layer) => {
      const row = document.createElement('div')
      row.className = 'legend-row'
      const symbol = document.createElement('span')
      symbol.className = `legend-symbol legend-symbol--${layer.style.type}`
      if (layer.style.type === 'point') {
        symbol.style.background = layer.style.fill
        symbol.style.borderColor = layer.style.stroke ?? 'transparent'
      } else if (layer.style.type === 'line') {
        symbol.style.background = layer.style.color
        symbol.style.height = `${Math.max(2, layer.style.width)}px`
      } else {
        symbol.style.background = layer.style.fill
        symbol.style.borderColor = layer.style.stroke
      }
      const name = document.createElement('span')
      name.textContent = layer.name
      row.append(symbol, name)
      return row
    })
  )
}

function showPopup(event: RuntimeFeatureClickEvent, overlay: Overlay): void {
  const layer = scene.layers.find(
    (candidate): candidate is VectorLayer => candidate.id === event.layerId && candidate.type === 'vector'
  )
  const popup = layer?.interaction?.popup
  if (!popup) return

  const properties = event.feature.properties ?? {}
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
