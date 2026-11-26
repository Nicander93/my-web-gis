/** 各次操作读取系统当前设置，切换偏好后无需重启工作台。 */
export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function motionDuration(milliseconds: number): number {
  return prefersReducedMotion() ? 0 : milliseconds
}
