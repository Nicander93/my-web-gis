import { useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { detectFileType } from '@/services/import'
import { emitCommandStatus } from '@/app/commands/status'

/** Browser files and native OS paths share the single-file import workflow. */
export function useWorkspaceFileDrop(enabled: boolean, onDrop: (file: File | string) => void) {
  const current = useRef({ enabled, onDrop })
  current.current = { enabled, onDrop }
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    const modalOpen = () => Array.from(document.querySelectorAll('[role="dialog"],[role="menu"]')).some(element => element.getClientRects().length > 0)
    const accept = (files: Array<File | string>) => {
      setDragging(false)
      if (!current.current.enabled || modalOpen()) {
        emitCommandStatus('请先关闭当前窗口，再拖入文件。')
        return
      }
      if (files.length !== 1) { emitCommandStatus('一次请拖入一个文件；SHP 请使用 ZIP。'); return }
      const file = files[0], name = typeof file === 'string' ? file : file.name
      if (detectFileType(name) === 'unknown') {
        emitCommandStatus('支持拖入 GeoJSON、SHP ZIP、DXF 或 CSV 文件。')
        return
      }
      current.current.onDrop(file)
    }
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = current.current.enabled ? 'copy' : 'none'
      setDragging(current.current.enabled && !modalOpen())
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
      else setDragging(current.current.enabled && !modalOpen())
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
