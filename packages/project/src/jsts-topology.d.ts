declare module 'jsts/org/locationtech/jts/io/GeoJSONReader.js' {
  export default class GeoJSONReader {
    read(geometry: unknown): unknown
  }
}

declare module 'jsts/org/locationtech/jts/operation/relate/RelateOp.js' {
  interface IntersectionMatrix {
    isIntersects(): boolean
    isWithin(): boolean
  }
  export default class RelateOp {
    static relate(a: unknown, b: unknown): IntersectionMatrix
  }
}
