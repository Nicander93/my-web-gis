import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

type SpikeCase = 'classification' | 'casing' | 'icon' | 'labels' | 'pattern'
interface SpikeHarness {
  maps: unknown[]
  layers: Record<string, { getVisible(): boolean; getOpacity(): number; getSource(): unknown; getStyleFunction(): ((feature: unknown, resolution: number) => unknown[] | undefined) | undefined }>
  referenceLayers: Record<string, { getVisible(): boolean; getSource(): unknown }>
  sources: Record<string, { getFeatures(): { getId(): string | number | undefined }[]; getFeatureById(id: string): { getGeometry(): { getExtent(): number[] } | undefined } | null }>
  featureIdentity: object
  selection: { getFeatures(): { push(feature: object): void; item(index: number): { getGeometry(): { getExtent(): number[] } | undefined } | null } }
  style: { layers: { id: string; source?: string; layout?: Record<string, unknown> }[] }
  showCase(name: SpikeCase): Promise<void>
  updateRoadStyle(style?: unknown): Promise<boolean>
  renderFixedFeatureCount(count: number): Promise<{ count: number; visibleFeatureCount: number; renderPixels: number; compileMs: number; renderMs: number }>
  translateSelectedFeature(delta: [number, number]): void
  zoomSamples(): { olZoom: number; mapLibreZoom: number; resolution: number }[]
}
interface SpikeWindow extends Window { cartographySpike: SpikeHarness }

const artifactDirectory = path.resolve('test-results/cartography-spike')

async function canvasEvidence(page: Page, mapId: string) {
  return page.locator(`#${mapId}`).evaluate((element) => {
    const counts = { drawn: 0, orangeRoad: 0, clinicMagenta: 0, hatchGreen: 0, darkText: 0 }
    for (const canvas of element.querySelectorAll('canvas')) {
      const context = canvas.getContext('2d')
      if (!context || !canvas.width || !canvas.height) continue
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      for (let index = 0; index < pixels.length; index += 4) {
        const [red, green, blue, alpha] = pixels.slice(index, index + 4)
        if (alpha > 0) counts.drawn += 1
        if (alpha > 180 && red > 170 && red < 225 && green > 75 && green < 130 && blue < 110) counts.orangeRoad += 1
        if (alpha > 180 && red > 140 && red < 210 && green > 35 && green < 95 && blue > 65 && blue < 145) counts.clinicMagenta += 1
        if (alpha > 180 && green > red + 3 && green > blue + 3) counts.hatchGreen += 1
        if (alpha > 180 && red < 85 && green < 85 && blue < 85) counts.darkText += 1
      }
    }
    return counts
  })
}

test('P0 five local Canvas cases, style semantics, identity, and bounded timing', async ({ page, browser }) => {
  const offsiteRequests: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  const localAssetResponses: { url: string; status: number }[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1') offsiteRequests.push(url.href)
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? 'unknown'}`))
  page.on('response', (response) => {
    if (response.url().includes('/cartography-assets/')) localAssetResponses.push({ url: response.url(), status: response.status() })
  })
  await page.goto('/cartography-spike.html')
  await expect(page.locator('#status')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('#spike-map canvas').first()).toBeVisible()
  await mkdir(artifactDirectory, { recursive: true })

  const scenes: SpikeCase[] = ['classification', 'casing', 'icon', 'labels', 'pattern']
  const pixelResults: Record<string, Awaited<ReturnType<typeof canvasEvidence>>> = {}
  const referencePixelResults: Record<string, Awaited<ReturnType<typeof canvasEvidence>>> = {}
  const referenceSources: Record<string, { sourceId: string; sameSource: boolean; visible: boolean }> = {}
  const styleResults: Record<string, unknown> = {}
  for (const scene of scenes) {
    await page.evaluate(async (name) => (window as SpikeWindow).cartographySpike.showCase(name), scene)
    pixelResults[scene] = await canvasEvidence(page, 'spike-map')
    referencePixelResults[scene] = await canvasEvidence(page, 'reference-map')
    referenceSources[scene] = await page.evaluate((name) => {
      const spike = (window as SpikeWindow).cartographySpike
      const sourceId = name === 'pattern' ? 'parcels' : name === 'icon' ? 'places' : 'roads'
      const layer = spike.referenceLayers[sourceId]
      return { sourceId, sameSource: layer.getSource() === spike.sources[sourceId], visible: layer.getVisible() }
    }, scene)
    styleResults[scene] = await page.evaluate((name) => {
      const spike = (window as SpikeWindow).cartographySpike
      const feature = name === 'pattern' ? spike.sources.parcels.getFeatureById('parcel-park')
        : name === 'icon' ? spike.sources.places.getFeatureById('poi-clinic')
          : spike.sources.roads.getFeatureById('road-main-west-east')
      if (!feature) return null
      const key = name === 'pattern' ? 'parcels' : name === 'icon' ? 'places' : 'roads'
      const styles = spike.layers[key]?.getStyleFunction()?.(feature, 156543.03392804097 / 2 ** 15) ?? []
      return styles.map((style) => {
        const value = style as { getText?: () => { getText(): unknown; getPlacement?(): unknown; getFont?(): unknown; getRepeat?(): unknown; getOverflow?(): unknown; getFill?(): { getColor(): unknown } | null } | undefined; getFill?: () => { getColor(): unknown } | null; getImage?: () => { getImage(): unknown } | undefined }
        return {
          text: value.getText?.()?.getText(),
          placement: value.getText?.()?.getPlacement?.(),
          font: value.getText?.()?.getFont?.(),
          repeat: value.getText?.()?.getRepeat?.(),
          overflow: value.getText?.()?.getOverflow?.(),
          textFill: value.getText?.()?.getFill?.()?.getColor(),
          fill: value.getFill?.()?.getColor(),
          image: Boolean(value.getImage?.()?.getImage()),
        }
      })
    }, scene)
    await page.screenshot({ path: path.join(artifactDirectory, `${scene}.png`), fullPage: true })
  }
  await writeFile(path.join(artifactDirectory, 'canvas-evidence.json'), `${JSON.stringify({ pixels: pixelResults, references: referencePixelResults, referenceSources, styles: styleResults }, null, 2)}\n`, 'utf8')

  const behavior = await page.evaluate(async () => {
    const spike = (window as SpikeWindow).cartographySpike
    await spike.showCase('classification')
    const zoomSamples = spike.zoomSamples().map((sample) => {
      const major = spike.sources.roads.getFeatureById('road-main-west-east')
      const styles = major ? spike.layers.roads.getStyleFunction()?.(major, sample.resolution) ?? [] : []
      const lineWidths = styles.flatMap((style) => {
        const width = (style as { getStroke?: () => { getWidth(): number } }).getStroke?.().getWidth()
        return width === undefined ? [] : [width]
      })
      return { ...sample, lineWidths }
    })
    const order = spike.maps[0] as { getLayers(): { getArray(): { get(key: string): unknown }[] } }
    return {
      sourceIdentity: spike.layers.roads.getSource() === spike.sources.roads,
      featureIdentity: spike.layers.roads.getSource()?.getFeatureById('road-main-west-east') === spike.featureIdentity,
      roadFeatureIds: spike.sources.roads.getFeatures().map((feature) => feature.getId()),
      styleLayerIds: spike.style.layers.map((layer) => layer.id),
      layerOrder: order.getLayers().getArray().map((layer) => layer.get('spike-id')),
      zoomSamples,
      browser: navigator.userAgent,
    }
  })
  expect(behavior.sourceIdentity).toBe(true)
  expect(behavior.featureIdentity).toBe(true)
  expect(behavior.roadFeatureIds).toEqual(['road-main-west-east', 'road-main-north-south', 'road-local'])
  expect(behavior.styleLayerIds).toHaveLength(7)
  expect(behavior.layerOrder).toEqual(['parcels', 'rivers', 'roads', 'places'])
  expect(behavior.zoomSamples.map(({ mapLibreZoom }) => mapLibreZoom)).toEqual([8, 12, 16])
  expect(behavior.zoomSamples.map(({ olZoom }) => olZoom)).toEqual([9, 13, 17])
  expect(behavior.zoomSamples[0].lineWidths).toContain(5)
  expect(behavior.zoomSamples[2].lineWidths).toContain(11)

  const identityAndEdit = await page.evaluate(async () => {
    const spike = (window as SpikeWindow).cartographySpike
    await spike.showCase('classification')
    const feature = spike.featureIdentity
    const extentBefore = feature.getGeometry()?.getExtent()
    if (!extentBefore) throw new Error('Selected fixture geometry missing')
    const before = [...extentBefore]
    spike.selection.getFeatures().push(spike.featureIdentity)
    spike.translateSelectedFeature([12, 0])
    const after = feature.getGeometry()?.getExtent()
    return {
      sameFeature: spike.sources.roads.getFeatureById('road-main-west-east') === feature,
      before,
      after,
      deltaX: after ? after[0] - before[0] : Number.NaN,
      deltaY: after ? after[1] - before[1] : Number.NaN,
    }
  })
  expect(identityAndEdit.sameFeature).toBe(true)
  expect(identityAndEdit.after).toBeTruthy()
  expect(identityAndEdit.deltaX).toBeCloseTo(12, 6)
  expect(identityAndEdit.deltaY).toBeCloseTo(0, 6)

  await page.locator('#filter-local').click()
  await expect(page.locator('body')).toHaveAttribute('data-road-filter', 'primary')
  const localRoadStyleCount = await page.evaluate(() => {
    const spike = (window as SpikeWindow).cartographySpike
    const localRoad = spike.sources.roads.getFeatureById('road-local')
    return localRoad ? spike.layers.roads.getStyleFunction()?.(localRoad, 9.554628535647032)?.length ?? 0 : 0
  })
  expect(localRoadStyleCount).toBe(0)
  await page.locator('#reset-filter').click()
  await expect(page.locator('body')).toHaveAttribute('data-road-filter', 'all')

  const layerButton = page.locator('[data-layer="rivers"]')
  const initiallyVisible = await layerButton.getAttribute('aria-pressed')
  if (initiallyVisible === 'false') await layerButton.click()
  await layerButton.click()
  expect(await layerButton.getAttribute('aria-pressed')).toBe('false')
  expect(await layerButton.getAttribute('data-opacity')).toBe('0.35')

  await page.route('**/cartography-assets/sprite.json', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.continue()
  })
  const updateOrdering = await page.evaluate(async () => {
    const spike = (window as SpikeWindow).cartographySpike
    const oldStyle = structuredClone(spike.style)
    const latestStyle = structuredClone(spike.style)
    delete (latestStyle as { sprite?: string }).sprite
    const latestInner = latestStyle.layers.find((layer) => layer.id === 'road-inner') as { paint: Record<string, unknown> }
    latestInner.paint['line-color'] = '#087c54'
    const oldRequest = spike.updateRoadStyle(oldStyle)
    const latestRequest = spike.updateRoadStyle(latestStyle)
    return { oldResult: await oldRequest, latestResult: await latestRequest }
  })
  await page.unroute('**/cartography-assets/sprite.json')
  expect(updateOrdering).toEqual({ oldResult: false, latestResult: true })
  const latestColor = await page.evaluate(() => {
    const spike = (window as SpikeWindow).cartographySpike
    const feature = spike.sources.roads.getFeatureById('road-main-west-east')
    const styles = feature ? spike.layers.roads.getStyleFunction()?.(feature, 9.554628535647032) ?? [] : []
    return styles.map((style) => (style as { getStroke?: () => { getColor(): unknown } | null }).getStroke?.()?.getColor())
  })
  expect(latestColor).toContain('rgba(8,124,84,1)')

  const compileTimings: number[] = []
  for (let index = 0; index < 6; index += 1) {
    const duration = await page.evaluate(async () => {
      const start = performance.now()
      await (window as SpikeWindow).cartographySpike.updateRoadStyle()
      return performance.now() - start
    })
    compileTimings.push(duration)
  }
  const fixedFeatureRender = await page.evaluate(() => (window as SpikeWindow).cartographySpike.renderFixedFeatureCount(1000))
  const sortedCompile = [...compileTimings].sort((a, b) => a - b)
  const performanceReport = {
    scope: 'browser Canvas timing; local fixtures; includes style apply Promise, excludes startup and native/GPU claims',
    browserVersion: browser.version(),
    userAgent: behavior.browser,
    compileUpdatesMs: compileTimings,
    compileMedianMs: sortedCompile[Math.floor(sortedCompile.length / 2)],
    fixedFeatureRender,
    zoomConvention: 'OL default 256 px view resolution: zOL = zMapLibre + 1; resolution = 156543.03392804097 / 2^(zMapLibre+1)',
    pixelResults,
    referencePixelResults,
    referenceSources,
    offsiteRequests,
    pageErrors,
    failedRequests,
    localAssetResponses,
    screenshots: scenes.map((scene) => `${scene}.png`),
  }
  await writeFile(path.join(artifactDirectory, 'performance.json'), `${JSON.stringify(performanceReport, null, 2)}\n`, 'utf8')
  expect(fixedFeatureRender.count).toBe(1000)
  expect(fixedFeatureRender.visibleFeatureCount).toBe(1000)
  expect(fixedFeatureRender.renderPixels).toBeGreaterThan(1000)
  expect(fixedFeatureRender.compileMs).toBeGreaterThan(0)
  expect(fixedFeatureRender.renderMs).toBeGreaterThan(0)
  expect(offsiteRequests).toEqual([])
  expect(pageErrors).toEqual([])
  expect(failedRequests).toEqual([])
  expect(pixelResults.classification.drawn).toBeGreaterThan(250)
  expect(pixelResults.classification.orangeRoad).toBeGreaterThan(50)
  expect(pixelResults.casing.orangeRoad).toBeGreaterThan(50)
  expect(pixelResults.icon.clinicMagenta).toBeGreaterThan(8)
  expect(pixelResults.labels.darkText).toBeGreaterThan(20)
  expect(pixelResults.pattern.drawn).toBeGreaterThan(300)
  const patternStyles = styleResults.pattern as { fill?: { src?: string } }[]
  expect(patternStyles[0]?.fill?.src).toContain('park-hatch')
  expect(localAssetResponses.some(({ url, status }) => url.endsWith('/sprite.png') && status === 200)).toBe(true)
  expect(referencePixelResults.classification.orangeRoad).toBeGreaterThan(50)
  expect(referencePixelResults.casing.orangeRoad).toBeGreaterThan(50)
  expect(referencePixelResults.icon.clinicMagenta).toBeGreaterThan(8)
  expect(referencePixelResults.labels.darkText).toBeGreaterThan(20)
  expect(referencePixelResults.pattern.drawn).toBeGreaterThan(300)
  expect(Object.values(referenceSources).every(({ sameSource, visible }) => sameSource && visible)).toBe(true)
})
