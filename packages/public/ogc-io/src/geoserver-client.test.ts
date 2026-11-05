import { describe, expect, it } from 'vitest'
import { createGeoServerClient, fingerprintSld, GeoServerPublishError, hashLayer, type GeoServerRequest, type GeoServerLayer } from './geoserver-client.js'
import { fingerprintMbStyle } from './mbstyle-export.js'

const sld = '<sld:StyledLayerDescriptor xmlns:sld="http://www.opengis.net/sld" version="1.0.0"><sld:NamedLayer><sld:Name>road</sld:Name></sld:NamedLayer></sld:StyledLayerDescriptor>'
const png = Uint8Array.from([137,80,78,71,13,10,26,10, ...Array(30).fill(0)])

function server(options: { fail?: 'upload' | 'associate' | 'wms'; existing?: string; mbstyle?: boolean; mbstyleVersion?: string; geoServerModuleFirst?: boolean } = {}) {
  const styles = new Map<string, string>(options.existing ? [['road', options.existing]] : [])
  let layer: GeoServerLayer = { name: 'roads', defaultStyle: { name: 'old' } }
  const calls: Array<{ url: string; request: GeoServerRequest }> = []
  const client = createGeoServerClient('https://maps.test/geoserver', async (url, request) => {
    calls.push({ url, request })
    const path = new URL(url).pathname
    if (path.endsWith('/about/version.json')) return Response.json({ about: { resource: [{ '@name': 'GeoServer', Version: '2.28.2' }] } })
    if (path.endsWith('/about/manifest.json')) {
      const modules = [
        { '@name': 'gt-mbstyle-34.2', 'Project-Version': '34.2' },
        { '@name': `gs-mbstyle-${options.mbstyleVersion ?? '2.28.2'}`, 'Project-Version': options.mbstyleVersion ?? '2.28.2' }
      ]
      if (options.geoServerModuleFirst) modules.reverse()
      return Response.json({ about: { resource: options.mbstyle ? modules : [] } })
    }
    if (path.includes('/layers/')) {
      if (request.method === 'PUT') {
        if (options.fail === 'associate') return new Response('', { status: 500 })
        layer = { ...layer, ...JSON.parse(new TextDecoder().decode(request.body)).layer }
      }
      return Response.json({ layer })
    }
    if (path.endsWith('/styles')) {
      if (options.fail === 'upload') throw new Error('network failure after send')
      styles.set(new URL(url).searchParams.get('name')!, new TextDecoder().decode(request.body))
      return new Response('', { status: 201 })
    }
    if (path.includes('/styles/')) {
      const name = path.split('/').at(-1)!.replace(/\.(?:sld|json)$/, '')
      if (request.method === 'DELETE') { styles.delete(name); return new Response('') }
      if (request.method === 'PUT') { styles.set(name, new TextDecoder().decode(request.body)); return new Response('') }
      const style = styles.get(name)
      return new Response(style ?? '', { status: style ? 200 : 404 })
    }
    if (path.endsWith('/wms')) return options.fail === 'wms' ? new Response('<ServiceException/>', { headers: { 'content-type': 'text/xml' } }) : new Response(png, { headers: { 'content-type': 'image/png' } })
    throw new Error('unexpected path')
  })
  return { client, calls, getLayer: () => layer }
}

describe('GeoServer REST publication lifecycle', () => {
  it('fingerprints equivalent XML independently of prefixes and indentation', async () => {
    const equivalent = sld.replaceAll('sld:', 'x:').replace('xmlns:sld', 'xmlns:x').replace('><', '>\n <')
    expect(await fingerprintSld(equivalent)).toBe(await fingerprintSld(sld))
    await expect(fingerprintSld('<!DOCTYPE x>' + sld)).rejects.toThrow()
    const labelled = sld.replace('</sld:NamedLayer>', '<sld:UserStyle><sld:FeatureTypeStyle><sld:Rule><sld:TextSymbolizer><sld:Label>Road</sld:Label></sld:TextSymbolizer></sld:Rule></sld:FeatureTypeStyle></sld:UserStyle></sld:NamedLayer>')
    expect(await fingerprintSld(labelled.replace('>Road<', '> Road <'))).not.toBe(await fingerprintSld(labelled))
  })
  it('uploads once, verifies readback, associates and verifies WMS and legend', async () => {
    const { client, calls, getLayer } = server()
    const result = await client.publish({ workspace: 'demo', layerName: 'roads', styleName: 'road', sld, expectedLayerHash: await hashLayer(getLayer()), bbox: [-1,-1,1,1] })
    expect(result.remoteHash).toBe(await fingerprintSld(sld))
    expect(getLayer().defaultStyle).toEqual({ name: 'road', workspace: 'demo' })
    expect(calls.filter(call => call.request.method === 'POST')).toHaveLength(1)
    expect(result.steps.filter(step => step.status === 'passed').map(step => step.step)).toEqual(['preflight','upload','readback','associate','wms'])
  })
  it('blocks name conflicts and layer changes before mutations', async () => {
    const { client, calls, getLayer } = server({ existing: sld })
    await expect(client.publish({ workspace: 'demo', layerName: 'roads', styleName: 'road', sld, expectedLayerHash: await hashLayer(getLayer()), bbox: [-1,-1,1,1] })).rejects.toThrow('同名')
    await expect(client.publish({ workspace: 'demo', layerName: 'roads', styleName: 'road', sld, expectedLayerHash: 'stale', expectedRemoteHash: await fingerprintSld(sld), bbox: [-1,-1,1,1] })).rejects.toThrow('远端修改')
    expect(calls.every(call => call.request.method === 'GET')).toBe(true)
  })
  it('preserves an existing style without ETag and associates a new immutable revision', async () => {
    const { client, calls, getLayer } = server({ existing: sld })
    const updated = sld.replace('>road<', '>updated<')
    const result = await client.publish({ workspace: 'demo', layerName: 'roads', styleName: 'road', sld: updated, expectedLayerHash: await hashLayer(getLayer()), expectedRemoteHash: await fingerprintSld(sld), bbox: [-1,-1,1,1] })
    expect(result.styleName).toMatch(/^road-rev-[a-f0-9]{16}$/)
    expect((await client.readStyle('demo', 'road'))?.content).toBe(sld)
    expect(getLayer().defaultStyle?.name).toBe(result.styleName)
    expect(calls.filter(call => call.request.method === 'PUT' && call.url.includes('/styles/'))).toHaveLength(0)
    expect(calls.filter(call => call.request.method === 'POST')).toHaveLength(1)
  })
  it('never retries an ambiguous mutation and retains the journal', async () => {
    const { client, calls, getLayer } = server({ fail: 'upload' })
    try { await client.publish({ workspace: 'demo', layerName: 'roads', styleName: 'road', sld, expectedLayerHash: await hashLayer(getLayer()), bbox: [-1,-1,1,1] }); throw new Error('expected failure') }
    catch (error) { expect(error).toBeInstanceOf(GeoServerPublishError); expect((error as GeoServerPublishError).steps.at(-1)).toMatchObject({ step: 'upload', status: 'failed' }) }
    expect(calls.filter(call => call.request.method === 'POST')).toHaveLength(1)
  })
  it('does not revert an existing or associated configuration after WMS failure', async () => {
    const { client, calls, getLayer } = server({ fail: 'wms' })
    await expect(client.publish({ workspace: 'demo', layerName: 'roads', styleName: 'road', sld, expectedLayerHash: await hashLayer(getLayer()), bbox: [-1,-1,1,1] })).rejects.toThrow('PNG')
    expect(getLayer().defaultStyle?.name).toBe('road')
    expect(calls.some(call => call.request.method === 'DELETE')).toBe(false)
  })

  it('probes MBStyle support through the read-only module manifest', async () => {
    const supported = server({ mbstyle: true })
    expect(await supported.client.probeMbStyleSupport()).toEqual({ supported: true, reason: 'GeoServer 2.28.2 已加载匹配版本的 MBStyle 扩展', moduleName: 'gs-mbstyle-2.28.2', serverVersion: '2.28.2' })
    expect(supported.calls).toHaveLength(2)
    expect(supported.calls.every(call => call.request.method === 'GET')).toBe(true)
    expect(supported.calls.some(call => call.url.includes('/rest/about/manifest.json?manifest=.*mbstyle.*'))).toBe(true)

    const absent = server()
    expect(await absent.client.probeMbStyleSupport()).toMatchObject({ supported: false })
    expect(absent.calls.every(call => call.request.method === 'GET')).toBe(true)

    const mismatch = server({ mbstyle: true, mbstyleVersion: '2.28.1' })
    expect(await mismatch.client.probeMbStyleSupport()).toMatchObject({ supported: false, reason: expect.stringContaining('版本未能确认匹配') })

    const geoServerModuleFirst = server({ mbstyle: true, geoServerModuleFirst: true })
    expect(await geoServerModuleFirst.client.probeMbStyleSupport()).toMatchObject({ supported: true, moduleName: 'gs-mbstyle-2.28.2' })
  })

  it('uploads, reads back and verifies an MBStyle JSON with the official REST media type', async () => {
    const { client, calls, getLayer } = server({ mbstyle: true })
    const mbstyle = JSON.stringify({ version: 8, name: 'road', layers: [{ id: 'road', type: 'line', paint: { 'line-color': '#123456', 'line-width': 2 } }] })
    const result = await client.publishMbStyle({ workspace: 'demo', layerName: 'roads', styleName: 'road', mbstyle, expectedLayerHash: await hashLayer(getLayer()), bbox: [-1,-1,1,1] })
    expect(result.remoteHash).toBe(await fingerprintMbStyle(mbstyle))
    expect(getLayer().defaultStyle).toEqual({ name: 'road', workspace: 'demo' })
    const upload = calls.find(call => call.request.method === 'POST')!
    expect(upload.request.headers['Content-Type']).toBe('application/vnd.geoserver.mbstyle+json')
    expect(new URL(upload.url).searchParams.get('name')).toBe('road')
    const readback = calls.find(call => call.request.method === 'GET' && new URL(call.url).pathname.endsWith('/road'))
    expect(readback?.request.headers.Accept).toBe('application/vnd.geoserver.mbstyle+json')
    expect(result.steps.filter(step => step.status === 'passed').map(step => step.step)).toEqual(['preflight','upload','readback','associate','wms'])
  })

  it('does not attempt an MBStyle mutation when extension support is not confirmed', async () => {
    const { client, calls, getLayer } = server()
    const mbstyle = JSON.stringify({ version: 8, name: 'road', layers: [] })
    await expect(client.publishMbStyle({ workspace: 'demo', layerName: 'roads', styleName: 'road', mbstyle, expectedLayerHash: await hashLayer(getLayer()), bbox: [-1,-1,1,1] })).rejects.toThrow('未确认')
    expect(calls.every(call => call.request.method === 'GET')).toBe(true)
  })
})
