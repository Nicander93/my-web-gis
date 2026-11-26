const statusEvent = 'desktop-webgis:command-status'
let status = ''

/** 发布命令结果，供当前工作区的状态栏显示。 */
export function emitCommandStatus(message: string): void {
  status = message
  window.dispatchEvent(new CustomEvent(statusEvent, { detail: message }))
}

export function getCommandStatus(): string { return status }

export function subscribeCommandStatus(listener: () => void): () => void {
  window.addEventListener(statusEvent, listener)
  return () => window.removeEventListener(statusEvent, listener)
}
