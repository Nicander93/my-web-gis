import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { createStyleAsset } from '@desktop-webgis/ol-style/style-assets'
import { exportSld } from './sld-export.js'
import { encodeSldPackage } from './sld-package.js'

describe('GeoServer portable SLD packages', () => {
  it('places actual image bytes alongside SLD for GeoServer to install relative resources', async () => {
    const asset = await createStyleAsset({ name: 'station', mimeType: 'image/svg+xml', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8" fill="#ff6600"/></svg>'), attribution: { source: 'Original', license: 'CC0-1.0' } })
    const result = exportSld([{ id: 'station', source: 'source', type: 'symbol', layout: { 'icon-image': asset.id } }], { targetLayerName: 'station', crs: 'EPSG:3857', assets: [asset], strict: true })
    const files = unzipSync(await encodeSldPackage(result))
    expect(Object.keys(files)).toEqual(['style.sld', `${asset.contentHash}.svg`, 'manifest.json'])
    expect(new TextDecoder().decode(files['style.sld'])).toContain(`xlink:href="${asset.contentHash}.svg"`)
    expect(new TextDecoder().decode(files[`${asset.contentHash}.svg`])).toContain('#ff6600')
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    expect(manifest.assets[0].attribution).toEqual(asset.attribution)
    expect(manifest.assets[0].dataUrl).toBeUndefined()
    await expect(encodeSldPackage({ ...result, assets: [{ ...result.assets[0], dataUrl: asset.dataUrl.replace(/base64,.*/, 'base64,YmFk') }] })).rejects.toThrow()
    await expect(encodeSldPackage({ ...result, assets: [{ ...result.assets[0], path: '../escape.svg' }] })).rejects.toThrow('路径')
  })
})
