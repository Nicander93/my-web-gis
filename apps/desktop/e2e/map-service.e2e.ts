import { test, expect } from '@playwright/test'

for (const mode of ['bearer', 'query-token'] as const) {
  test(`installed ${mode} WMS fetches authenticated tiles without persisting the credential`, async ({ page }) => {
    const requests: Array<{ url: string; authorization?: string }> = []
    await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
    await page.route('**/auth-wms**', async route => {
      requests.push({ url: route.request().url(), authorization: route.request().headers().authorization })
      await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
    })
    await page.goto('/')
    await page.getByRole('button', { name: /^二维地图/ }).click()
    const saved = await page.evaluate(async mode => {
      const { putSessionCredential } = await import('/src/services/credentials.ts')
      const { useProjectStore } = await import('/src/stores/project.store.ts')
      const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
      const key = putSessionCredential({ kind: mode, value: 'fixture-secret', key: 'tile-fixture', param: 'access' })
      const map = getMapRuntime()!.getMap()
      const loaded = new Promise<void>(resolve => {
        const observe = (event: { element: { getSource?(): { getParams?(): { LAYERS?: string }; once(event: string, callback: () => void): void } } }) => {
          const source = event.element.getSource?.()
          if (source?.getParams?.().LAYERS !== 'roads') return
          map.getLayers().un('add', observe)
          source.once('tileloadend', resolve)
        }
        map.getLayers().on('add', observe)
      })
      useProjectStore.getState().addServiceLayer({ name: 'Authenticated WMS', kind: 'wms', source: {
        type: 'wms', url: `${location.origin}/auth-wms`, version: '1.3.0', layerNames: ['roads'], crs: 'EPSG:3857',
        authMode: mode, tokenParam: 'access', credentialRef: { key }
      } })
      await loaded
      return JSON.stringify(useProjectStore.getState().getSnapshot())
    }, mode)
    expect(requests.length).toBeGreaterThan(0)
    expect(saved).not.toContain('fixture-secret')
    for (const request of requests) {
      if (mode === 'bearer') { expect(request.authorization).toBe('Bearer fixture-secret'); expect(request.url).not.toContain('fixture-secret') }
      else expect(new URL(request.url).searchParams.get('access')).toBe('fixture-secret')
    }
  })
}
