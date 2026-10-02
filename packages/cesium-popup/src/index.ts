import { Cartesian3, SceneTransforms } from 'cesium'
import type { Viewer } from 'cesium'

export interface PopupContext {
  position: Cartesian3
  properties: Record<string, unknown>
  title?: string
}
export interface PopupFields {
  title?: string
  titleField?: string
  fields: Array<{ field: string; label?: string }>
}
export type PopupValue = string | HTMLElement | PopupFields
export type PopupContent = PopupValue | ((context: PopupContext) => PopupValue | Promise<PopupValue>)

/** A world-anchored popup. String/property content is always rendered as text. */
export class Popup {
  private readonly element: HTMLElement
  private readonly body: HTMLElement
  private readonly removePostRender: () => void
  private context?: PopupContext
  private revision = 0
  private destroyed = false

  constructor(private readonly viewer: Viewer) {
    this.element = document.createElement('aside')
    this.element.setAttribute('role', 'dialog')
    this.element.setAttribute('aria-label', '对象属性')
    Object.assign(this.element.style, { position: 'absolute', zIndex: '20', width: '260px', maxHeight: '320px', overflow: 'auto', padding: '14px', borderRadius: '6px', background: '#fff', color: '#17212e', boxShadow: '0 4px 24px #0004', transform: 'translate(-50%, calc(-100% - 14px))', font: '13px/1.6 system-ui', display: 'none' })
    this.body = document.createElement('div')
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = '×'
    close.setAttribute('aria-label', '关闭属性弹窗')
    Object.assign(close.style, { float: 'right', border: '0', background: 'transparent', cursor: 'pointer', fontSize: '18px' })
    close.addEventListener('click', () => this.close())
    this.element.append(close, this.body)
    viewer.container.append(this.element)
    this.removePostRender = viewer.scene.postRender.addEventListener(() => this.updatePosition())
  }

  async open(context: PopupContext, content: PopupContent): Promise<void> {
    if (this.destroyed) throw new Error('Popup 已销毁')
    const revision = ++this.revision
    this.context = undefined
    this.element.style.display = 'none'
    const value = typeof content === 'function' ? await content(context) : content
    if (this.destroyed || revision !== this.revision) return
    this.context = context
    this.body.replaceChildren()
    if (typeof value === 'string') this.body.textContent = value
    else if (value instanceof HTMLElement) this.body.append(value)
    else {
      const title = document.createElement('strong')
      title.textContent = value.title ?? (value.titleField ? formatPopupValue(context.properties[value.titleField]) : context.title ?? '')
      const fields = document.createElement('dl')
      for (const field of value.fields) {
        const term = document.createElement('dt'), description = document.createElement('dd')
        term.textContent = field.label ?? field.field
        description.textContent = formatPopupValue(context.properties[field.field])
        description.style.margin = '0 0 8px'
        fields.append(term, description)
      }
      this.body.append(title, fields)
    }
    this.updatePosition()
    this.viewer.scene.requestRender()
  }

  close(): void {
    this.revision++
    this.context = undefined
    this.element.style.display = 'none'
  }

  destroy(): void {
    if (this.destroyed) return
    this.close()
    this.destroyed = true
    this.removePostRender()
    this.element.remove()
  }

  private updatePosition(): void {
    if (!this.context || this.destroyed) return
    const camera = this.viewer.camera
    const offset = Cartesian3.subtract(this.context.position, camera.positionWC, new Cartesian3())
    const pixel = SceneTransforms.worldToWindowCoordinates(this.viewer.scene, this.context.position)
    const visible = pixel && Cartesian3.dot(offset, camera.directionWC) > 0 && pixel.x >= 0 && pixel.y >= 0 && pixel.x <= this.viewer.canvas.clientWidth && pixel.y <= this.viewer.canvas.clientHeight
    this.element.style.display = visible ? 'block' : 'none'
    if (pixel) { this.element.style.left = `${pixel.x}px`; this.element.style.top = `${pixel.y}px` }
  }
}

export function formatPopupValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
