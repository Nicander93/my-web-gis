import { useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { detectFileType } from '@/io/import'
import { emitCommandStatus } from '@/platform/command-status'

type WorkspaceFileKind = 'project' | 'scene' | 'data'

/** 浏览器和桌面拖入文件时，根据后缀直接进入相应的打开或导入流程。 */
export function useWorkspaceFileDrop(acceptsData: boolean, onDrop: (file: File | string, kind: WorkspaceFileKind) => void) {
  const current = useRef({ acceptsData, onDrop })
  current.current = { acceptsData, onDrop }
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    const modalOpen = () => Array.from(document.querySelectorAll('[role="dialog"]:not([aria-modal="false"]),[role="menu"]')).some(element => element.getClientRects().length > 0)
    const accept = (files: Array<File | string>) => {
      setDragging(false)
      if (modalOpen()) {
        emitCommandStatus('请先关闭当前窗口，再拖入文件。')
        return
      }
      if (files.length !== 1) { emitCommandStatus('一次请拖入一个文件；SHP 请使用 ZIP。'); return }
      const file = files[0], name = typeof file === 'string' ? file : file.name
      if (/\.webgis\.json$/i.test(name)) { current.current.onDrop(file, 'project'); return }
      if (/\.scene\.(json|zip)$/i.test(name)) { current.current.onDrop(file, 'scene'); return }
      if (!current.current.acceptsData) {
        emitCommandStatus('可在这里拖入项目或完整场景文件。请在二维地图中添加矢量数据。')
        return
      }
      if (detectFileType(name) === 'unknown') {
        emitCommandStatus('支持拖入 GeoJSON、SHP ZIP、DXF 或 CSV 文件。')
        return
      }
      current.current.onDrop(file, 'data')
    }
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      const allowed = !modalOpen()
      event.dataTransfer.dropEffect = allowed ? 'copy' : 'none'
      setDragging(allowed)
    }
    const leave = (event: DragEvent) => { if (!event.relatedTarget) setDragging(false) }
    const drop = (event: DragEvent) => {
      setDragging(false)
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      if ((event.target as Element)?.closest('.file-drop-zone')) return
      event.stopImmediatePropagation()
      accept(Array.from(event.dataTransfer.files))
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop, true)
    if (isTauri()) void getCurrentWebview().onDragDropEvent(event => {
      if (disposed) return
      const payload = event.payload
      if (payload.type === 'drop') accept(payload.paths)
      else if (payload.type === 'leave') setDragging(false)
      else setDragging(!modalOpen())
    }).then(stop => { if (disposed) stop(); else unlisten = stop }).catch(() => emitCommandStatus('系统文件拖放监听失败，请使用添加数据。'))
    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop, true)
    }
  }, [])
  return dragging
}
