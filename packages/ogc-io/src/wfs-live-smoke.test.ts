import { describe, expect, it } from 'vitest'
import {
  fetchCapabilitiesXml,
  fetchGetFeaturePage,
  parseCapabilitiesXml,
  planBoundedGetFeaturePages,
  resolveWfsLoadOptions
} from './index.js'

/**
 * Opt-in public live WFS GetFeature smoke (scenario H live path only).
 * Default `vitest run` skips this suite unless DESKTOP_WEBGIS_LIVE_WFS=1.
 * Does not claim P21 complete or full scenario H PASS.
 */
const LIVE = process.env.DESKTOP_WEBGIS_LIVE_WFS === '1'

const PRIMARY = {
  label: 'ahocevar.com topp:states',
  url: 'https://ahocevar.com/geoserver/wfs',
  typeName: 'topp:states'
} as const

const ALTERNATE = {
  label: 'demo.mapserver.org ms:cities',
  url: 'https://demo.mapserver.org/cgi-bin/wfs',
  typeName: 'ms:cities'
} as const

const MAX_FEATURES = 10
const TIMEOUT_MS = 45_000

function parseFeatureCount(body: string): number {
  const trimmed = body.trimStart()
  if (trimmed.startsWith('{')) {
    const json = JSON.parse(body) as { type?: string; features?: unknown[] }
    if (json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
      throw new Error('GeoJSON body is not a FeatureCollection with features[]')
    }
    return json.features.length
  }
  const members = body.match(/<(?:\w+:)?(?:member|featureMember)\b/gi)
  return members?.length ?? 0
}

function looksSecret(url: string): boolean {
  return /(?:^|[?&])(?:token|access_token|api[_-]?key|auth|password|secret)=/i.test(url)
}

async function tryEndpoint(endpoint: typeof PRIMARY | typeof ALTERNATE): Promise<{
  label: string
  typeName: string
  featureCount: number
  status: number
  shareableUrl: string
  version: string
  outputFormat: string
}> {
  const cap = await fetchCapabilitiesXml({
    url: endpoint.url,
    service: 'WFS',
    version: '2.0.0',
    timeoutMs: TIMEOUT_MS
  })
  expect(cap.status).toBe(200)

  const desc = parseCapabilitiesXml(cap.xml, {
    shareableUrl: cap.shareableUrl,
    hint: 'WFS'
  })
  expect(desc.service).toBe('WFS')

  const resolved = resolveWfsLoadOptions(desc, {
    typeName: endpoint.typeName,
    extentMode: 'full',
    maxFeatures: MAX_FEATURES
  })
  if (!resolved.ok) {
    throw new Error(`resolveWfsLoadOptions failed: ${resolved.reason}`)
  }

  const pages = planBoundedGetFeaturePages({
    maxFeatures: resolved.options.maxFeatures,
    usePaging: false
  })
  const pagePlan = pages[0]!

  const page = await fetchGetFeaturePage({
    load: resolved.options,
    startIndex: pagePlan.startIndex,
    pageSize: pagePlan.pageSize,
    timeoutMs: TIMEOUT_MS
  })

  expect(page.status).toBe(200)
  expect(page.body).not.toMatch(/ExceptionReport|ServiceExceptionReport/i)
  expect(looksSecret(page.requestUrlShareable)).toBe(false)

  const featureCount = parseFeatureCount(page.body)
  expect(featureCount).toBeGreaterThanOrEqual(1)

  return {
    label: endpoint.label,
    typeName: resolved.options.typeName,
    featureCount,
    status: page.status,
    shareableUrl: page.requestUrlShareable,
    version: resolved.options.version,
    outputFormat: resolved.options.outputFormat.value
  }
}

describe.skipIf(!LIVE)('live WFS GetFeature smoke (opt-in DESKTOP_WEBGIS_LIVE_WFS=1)', () => {
  it(
    'capabilities -> resolve -> bounded GetFeature >=1 feature (public anonymous)',
    async () => {
      let lastError: unknown
      for (const endpoint of [PRIMARY, ALTERNATE] as const) {
        try {
          const result = await tryEndpoint(endpoint)
          console.log(
            `[live-wfs] OK endpoint=${result.label} typeName=${result.typeName} ` +
              `version=${result.version} outputFormat=${result.outputFormat} ` +
              `features=${result.featureCount} status=${result.status}`
          )
          console.log(`[live-wfs] shareableUrl=${result.shareableUrl}`)
          expect(result.featureCount).toBeGreaterThanOrEqual(1)
          return
        } catch (err) {
          lastError = err
          console.warn(
            `[live-wfs] endpoint failed: ${endpoint.label} — ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        }
      }
      throw new Error(
        `All public live WFS endpoints unreachable or failed. Last error: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`
      )
    },
    60_000
  )
})