/** 把命令执行结果交给应用壳层显示，避免命令依赖 React。 */
export function emitCommandStatus(message: string): void {
  window.dispatchEvent(new CustomEvent('desktop-webgis:command-status', { detail: message }))
}
