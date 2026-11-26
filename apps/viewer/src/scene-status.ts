type SceneStatusKind = 'ready' | 'warning' | 'error'

/** 成功提示自行淡出。需要处理的信息保留在当前视图。 */
export function createSceneStatus(element: HTMLElement) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let previousKind: SceneStatusKind | undefined

  return (message: string, kind: SceneStatusKind) => {
    if (element.textContent === message && previousKind === kind) return
    previousKind = kind
    clearTimeout(timeout)
    element.textContent = message
    element.classList.remove('scene-status--quiet')
    element.classList.toggle('scene-status--error', kind === 'error')
    if (kind === 'ready') timeout = setTimeout(() => element.classList.add('scene-status--quiet'), 1800)
  }
}
