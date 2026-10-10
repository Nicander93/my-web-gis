import proj4 from 'proj4'

export type CrsPresetKind = 'geographic' | 'projected'

export interface CrsPreset {
  code: string
  name: string
  kind: CrsPresetKind
  /** Proj4 definition registered for this preset. */
  proj4: string
}

/** GRS80 / CGCS2000 ellipsoid (EPSG ellipsoid 1024). No grid-shift datum transform. */
const GRS80_ELLPS = '+ellps=GRS80'

function gaussKruger3Cm(lon0: number): string {
  return `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=1 +x_0=500000 +y_0=0 ${GRS80_ELLPS} +units=m +no_defs`
}

/**
 * Built-in CRS presets for import / export pickers.
 * China coverage: CGCS2000 geographic (4490) and 3° Gauss-Kruger CM 75°E–135°E (EPSG:4534–4554).
 * Datum grids are not loaded; 4490↔4326 is ellipsoid-only, matching the existing Proj4js stack.
 */
export const CRS_PRESETS: readonly CrsPreset[] = [
  {
    code: 'EPSG:4326',
    name: 'WGS84 (经纬度)',
    kind: 'geographic',
    proj4: '+proj=longlat +datum=WGS84 +no_defs'
  },
  {
    code: 'EPSG:3857',
    name: 'Web Mercator',
    kind: 'projected',
    proj4:
      '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs'
  },
  {
    code: 'EPSG:4490',
    name: 'CGCS2000 (经纬度)',
    kind: 'geographic',
    proj4: `+proj=longlat ${GRS80_ELLPS} +no_defs`
  },
  ...buildCgcs2000ThreeDegreeCmPresets()
]

function buildCgcs2000ThreeDegreeCmPresets(): CrsPreset[] {
  const presets: CrsPreset[] = []
  // EPSG:4534 = CM 75E … EPSG:4554 = CM 135E (mainland 3° belt, false easting 500000)
  for (let i = 0; i <= 20; i += 1) {
    const lon0 = 75 + i * 3
    const code = `EPSG:${4534 + i}`
    presets.push({
      code,
      name: `CGCS2000 3°带 CM ${lon0}°E`,
      kind: 'projected',
      proj4: gaussKruger3Cm(lon0)
    })
  }
  return presets
}

let registered = false

/** Register preset proj4 definitions. Safe to call more than once. */
export function registerCrsPresets(): void {
  if (registered) return
  for (const preset of CRS_PRESETS) {
    proj4.defs(preset.code, preset.proj4)
  }
  registered = true
}

registerCrsPresets()

export type CrsPresetCode = (typeof CRS_PRESETS)[number]['code']

export function findCrsPreset(code: string): CrsPreset | undefined {
  const normalized = code.trim().toUpperCase()
  return CRS_PRESETS.find((preset) => preset.code === normalized)
}

export function isGeographicCrsCode(code: string): boolean {
  return findCrsPreset(code)?.kind === 'geographic'
}
