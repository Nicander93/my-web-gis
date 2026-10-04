declare module 'jsts/org/locationtech/jts/io/GeoJSONReader.js' {
  interface TopologyGeometry { getEnvelopeInternal(): unknown }
  export default class GeoJSONReader { read(geometry: unknown): TopologyGeometry }
}
declare module 'jsts/org/locationtech/jts/operation/relate/RelateOp.js' {
  export default class RelateOp {
    static relate(a: unknown, b: unknown): { isIntersects(): boolean; isWithin(): boolean }
  }
}
declare module 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js' {
  export default class IsValidOp { constructor(geometry: unknown); isValid(): boolean }
}
declare module 'jsts/org/locationtech/jts/index/strtree/STRtree.js' {
  export default class STRtree<T> {
    insert(envelope: unknown, item: T): void
    query(envelope: unknown): { toArray(): T[] }
  }
}
