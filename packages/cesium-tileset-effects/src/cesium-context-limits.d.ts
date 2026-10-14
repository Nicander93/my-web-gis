import 'cesium'

declare module 'cesium' {
  /** Runtime export omitted from Cesium's public TypeScript declarations. */
  export const ContextLimits: {
    readonly maximumTextureSize: number
  }
}
