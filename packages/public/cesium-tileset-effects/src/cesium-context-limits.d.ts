import 'cesium'

declare module 'cesium' {
  /** 这个运行时导出没有出现在 Cesium 的公开 TypeScript 声明里。 */
  export const ContextLimits: {
    readonly maximumTextureSize: number
  }
}
