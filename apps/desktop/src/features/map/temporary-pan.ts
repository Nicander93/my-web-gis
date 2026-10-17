import type Map from 'ol/Map'

/** Capture navigation gestures before editing interactions, preserving unfinished sketches. */
export function installTemporaryPan(map: Map): () => void {
  const viewport = map.getViewport(), doc = viewport.ownerDocument, win = doc.defaultView!
  let space = false
  let suppressClick = false
  let gesture: { id: number; pixel: number[] } | null = null
  const modalOpen = () => Array.from(doc.querySelectorAll('[role="dialog"]')).some(element => element.getClientRects().length > 0)
  const editingText = () => Boolean(doc.activeElement?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"],[role="menu"]'))
  const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation() }
  const finish = () => {
    if (!gesture) return
    const id = gesture.id
    gesture = null
    if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id)
    map.getView().endInteraction(0)
    viewport.classList.remove('is-panning')
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.code !== 'Space' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || modalOpen() || editingText()) return
    space = true
    if (viewport.matches(':hover') || viewport.contains(doc.activeElement)) event.preventDefault()
  }
  const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') space = false }
  const down = (event: PointerEvent) => {
    if (gesture) { stop(event); return }
    suppressClick = false
    if (event.pointerType !== 'mouse' || modalOpen() || event.target instanceof Element && event.target.closest('button,a,input,select')) return
    if (event.button !== 1 && !(space && !editingText() && event.button === 0)) return
    stop(event)
    map.getView().cancelAnimations()
    map.getView().beginInteraction()
    gesture = { id: event.pointerId, pixel: map.getEventPixel(event) }
    suppressClick = true
    viewport.setPointerCapture(event.pointerId)
    viewport.classList.add('is-panning')
  }
  const move = (event: PointerEvent) => {
    if (!gesture || gesture.id !== event.pointerId) return
    stop(event)
    if (!event.buttons) { finish(); return }
    const pixel = map.getEventPixel(event)
    const before = map.getCoordinateFromPixelInternal(gesture.pixel), after = map.getCoordinateFromPixelInternal(pixel)
    if (before && after) map.getView().adjustCenterInternal([before[0] - after[0], before[1] - after[1]])
    gesture.pixel = pixel
  }
  const up = (event: PointerEvent) => { if (gesture?.id === event.pointerId) { stop(event); finish() } }
  const blur = () => { space = false; finish() }
  const aux = (event: MouseEvent) => { if (event.button === 1) stop(event) }
  const click = (event: MouseEvent) => { if (suppressClick) stop(event) }
  doc.addEventListener('keydown', keydown)
  doc.addEventListener('keyup', keyup)
  viewport.addEventListener('pointerdown', down, true)
  viewport.addEventListener('auxclick', aux, true)
  viewport.addEventListener('click', click, true)
  viewport.addEventListener('dblclick', click, true)
  viewport.addEventListener('lostpointercapture', finish)
  win.addEventListener('pointermove', move, true)
  win.addEventListener('pointerup', up, true)
  win.addEventListener('pointercancel', up, true)
  win.addEventListener('blur', blur)
  return () => {
    blur()
    doc.removeEventListener('keydown', keydown)
    doc.removeEventListener('keyup', keyup)
    viewport.removeEventListener('pointerdown', down, true)
    viewport.removeEventListener('auxclick', aux, true)
    viewport.removeEventListener('click', click, true)
    viewport.removeEventListener('dblclick', click, true)
    viewport.removeEventListener('lostpointercapture', finish)
    win.removeEventListener('pointermove', move, true)
    win.removeEventListener('pointerup', up, true)
    win.removeEventListener('pointercancel', up, true)
    win.removeEventListener('blur', blur)
  }
}
