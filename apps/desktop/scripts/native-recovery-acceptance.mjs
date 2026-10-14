import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tauri = join(desktop, 'src-tauri')
const runId = Date.now().toString()
const identifier = `com.desktop-webgis.recovery-acceptance-${runId}`
const output = join(desktop, 'test-results', `native-recovery-${runId}`)
const serverPort = 5197, debugPort = 9229
const url = `http://127.0.0.1:${serverPort}`
const report = { identifier, output, scenarios: [], nativeFileChooser: 'Not automated: fixture working paths are assigned; Save uses the real native bridge.', windowsScale125: 'Not verified' }
let server, application, browser, page

function start(args, cwd, env = process.env) {
  const child = spawn('rtk', args, { cwd, env, windowsHide: true, stdio: 'inherit' })
  child.on('error', (error) => console.error(error))
  return child
}
function finished(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
}
async function forceStop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  // Only the process tree created and still tracked by this harness is terminated.
  const killer = spawn('rtk', ['proxy', 'taskkill', '/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'pipe' })
  let detail = ''
  killer.stderr.on('data', (chunk) => { detail += chunk })
  const code = await finished(killer)
  if (code !== 0 && child.exitCode === null) throw new Error(`Cannot stop owned process ${child.pid}: ${detail}`)
  await finished(child)
}
async function available(port) {
  try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }); return true } catch { return false }
}
async function poll(check, message, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(message)
}
async function launch() {
  assert.equal(await available(debugPort), false, 'Owned WebView debugging port must be free before launch')
  application = spawn(join(output, 'desktop-webgis.exe'), [], { cwd: tauri, windowsHide: true, stdio: 'inherit', env: {
    ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    WEBVIEW2_USER_DATA_FOLDER: join(output, 'webview-profile')
  } })
  application.on('error', (error) => console.error(error))
  await poll(async () => {
    if (application.exitCode !== null) throw new Error(`Native application exited: ${application.exitCode}`)
    try { return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok } catch { return false }
  }, 'Native WebView debugging endpoint did not open')
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
  const context = browser.contexts()[0]
  assert.ok(context, 'Native WebView context is required')
  await poll(async () => {
    page = context.pages().find((item) => item.url().startsWith(url))
    return !!page
  }, 'Native application page did not load')
  page.setDefaultTimeout(30_000)
  await page.route('**/*tile.openstreetmap.org/**', (route) => route.abort())
  const identity = await page.evaluate(async () => {
    const core = await import('/node_modules/@tauri-apps/api/core.js')
    const app = await import('/node_modules/@tauri-apps/api/app.js')
    const paths = await import('/node_modules/@tauri-apps/api/path.js')
    return { native: core.isTauri(), identifier: await app.getIdentifier(), appData: await paths.appLocalDataDir() }
  })
  assert.equal(identity.native, true)
  assert.equal(identity.identifier, identifier)
  assert.ok(identity.appData.includes(identifier))
  report.appData = identity.appData
  report.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }))
  console.log(`[native-recovery] launched owned PID ${application.pid}, ${identity.identifier}`)
}
async function crash() {
  await forceStop(application)
  application = undefined
  await browser?.close().catch(() => undefined)
  browser = undefined; page = undefined
  await poll(async () => !await available(debugPort), 'Owned WebView did not release its port after process termination')
}
async function entries() {
  return page.evaluate(async () => (await import('/node_modules/@tauri-apps/api/core.js')).invoke('list_recovery_cache'))
}
async function draftWhere(predicate) {
  let selected
  await poll(async () => {
    for (const entry of await entries()) {
      if (entry.text) {
        const draft = JSON.parse(entry.text)
        if (predicate(draft)) { selected = { entry, draft }; return true }
      }
    }
    return false
  }, 'Latest applied changes did not reach the native recovery cache', 30_000)
  const file = join(report.appData, 'project-recovery', `${selected.entry.key}.json`)
  assert.equal(await readFile(file, 'utf8'), selected.entry.text)
  return selected.draft
}
async function waitForCityView() {
  if (await page.locator('.city-canvas__viewport canvas').count()) {
    let previous, stable = 0
    await poll(async () => {
      const camera = await page.evaluate(async () => (await import('/src/features/city/city-runtime-host.ts')).getLiveCityCamera())
      const values = camera && [...camera.position, camera.heading, camera.pitch, camera.roll]
      if (values && previous && values.every((value, index) => Math.abs(value - previous[index]) < (index === 2 ? 1e-5 : 1e-8))) stable++
      else stable = 0
      previous = values
      return stable >= 4
    }, 'Cesium view did not settle before native save')
  }
}
async function saveTo(path) {
  await waitForCityView()
  await page.evaluate(async (file) => (await import('/src/services/project-io.ts')).setCurrentProjectPath(file), path)
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await expect(page.locator('.project-dirty')).toHaveCount(0)
  await poll(async () => (await entries()).length === 0, 'Native save did not clear the acknowledged recovery draft')
  return JSON.parse(await readFile(path, 'utf8'))
}
async function modelPixels() {
  const png = await page.locator('.city-canvas__viewport canvas').screenshot()
  return page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close()
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 20 && pixels[index + 1] > pixels[index] + 5 && pixels[index + 2] > pixels[index] + 10) count++
    }
    return count
  }, [...png])
}
async function restore() {
  const dialog = page.getByRole('dialog', { name: '发现恢复草稿', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '恢复草稿', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.project-dirty')).toContainText('未保存')
}

async function verifyLocalProtocol() {
  const directory = join(output, 'local-protocol')
  await mkdir(join(directory, 'nested'), { recursive: true })
  await mkdir(join(directory, 'bin'), { recursive: true })
  await mkdir(join(directory, '纹理'), { recursive: true })
  const glb = await readFile(resolve(desktop, '../../examples/city-3d/city-sample/tower.glb'))
  const jsonLength = glb.readUInt32LE(12)
  const document = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'))
  const binaryOffset = 20 + jsonLength, binaryLength = glb.readUInt32LE(binaryOffset)
  const binary = glb.subarray(binaryOffset + 8, binaryOffset + 8 + binaryLength)
  document.buffers[0].uri = '../bin/mesh.bin'
  document.images = [{ uri: '../纹理/像素.png' }]; document.textures = [{ source: 0 }]
  document.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 }
  const expectedUv = []
  for (const mesh of document.meshes) for (const primitive of mesh.primitives) {
    const count = document.accessors[primitive.attributes.POSITION].count
    const uv = Buffer.alloc(count * 2 * 4), name = `uv-${expectedUv.length}.bin`
    const buffer = document.buffers.length, bufferView = document.bufferViews.length, accessor = document.accessors.length
    document.buffers.push({ uri: `../bin/${name}`, byteLength: uv.length })
    document.bufferViews.push({ buffer, byteOffset: 0, byteLength: uv.length, target: 34962 })
    document.accessors.push({ bufferView, componentType: 5126, count, type: 'VEC2' })
    primitive.attributes.TEXCOORD_0 = accessor
    await writeFile(join(directory, 'bin', name), uv)
    expectedUv.push([...uv])
  }
  const pngBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, 1, 1)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const png = Buffer.from(pngBase64, 'base64')
  await writeFile(join(directory, 'nested', '模型.gltf'), JSON.stringify(document))
  await writeFile(join(directory, 'bin', 'mesh.bin'), binary)
  await writeFile(join(directory, '纹理', '像素.png'), png)
  const result = await page.evaluate(async ({ directory, expectedBinary, expectedImage, expectedUv }) => {
    const { invoke } = await import('/node_modules/@tauri-apps/api/core.js')
    const grant = await invoke('grant_local_resource_directory', { directory })
    try {
      const root = new URL('nested/模型.gltf', grant.url).href
      const model = await fetch(root), gltf = await model.json()
      const meshUrl = new URL(gltf.buffers[0].uri, root).href
      const imageUrl = new URL(gltf.images[0].uri, root).href
      const mesh = await fetch(meshUrl), image = await fetch(imageUrl)
      const meshBytes = [...new Uint8Array(await mesh.arrayBuffer())]
      const imageBytes = [...new Uint8Array(await image.arrayBuffer())]
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(imageBytes)], { type: 'image/png' }))
      const imageSize = [bitmap.width, bitmap.height]; bitmap.close()
      const uvBuffers = []
      for (const buffer of gltf.buffers.slice(1)) {
        const response = await fetch(new URL(buffer.uri, root).href)
        uvBuffers.push([...new Uint8Array(await response.arrayBuffer())])
      }
      const part = await fetch(meshUrl, { headers: { Range: 'bytes=2-7' } })
      const suffix = await fetch(meshUrl, { headers: { Range: 'bytes=-4' } })
      const head = await fetch(meshUrl, { method: 'HEAD', headers: { Range: 'bytes=2-7' } })
      const missing = await fetch(new URL('missing.glb', grant.url).href)
      const traversal = await fetch(new URL('../../secret.txt', root).href)
      const partBytes = [...new Uint8Array(await part.arrayBuffer())]
      const suffixBytes = [...new Uint8Array(await suffix.arrayBuffer())]
      const matched = JSON.stringify(meshBytes) === JSON.stringify(expectedBinary) && JSON.stringify(imageBytes) === JSON.stringify(expectedImage) && JSON.stringify(uvBuffers) === JSON.stringify(expectedUv)
      const statuses = { model: model.status, mesh: mesh.status, image: image.status, part: part.status, suffix: suffix.status,
        head: head.status, missing: missing.status, traversal: traversal.status }
      await invoke('revoke_local_resource_directory', { key: grant.key })
      const revoked = await fetch(meshUrl)
      return { matched, imageSize, externalBuffers: uvBuffers.length + 1, statuses, revoked: revoked.status, partBytes, suffixBytes, modelType: model.headers.get('Content-Type'),
        imageType: image.headers.get('Content-Type'), partRange: part.headers.get('Content-Range'), headLength: head.headers.get('Content-Length') }
    } finally { await invoke('revoke_local_resource_directory', { key: grant.key }) }
  }, { directory, expectedBinary: [...binary], expectedImage: [...png], expectedUv })
  assert.equal(result.matched, true)
  assert.deepEqual(result.imageSize, [1, 1])
  assert.deepEqual(result.statuses, { model: 200, mesh: 200, image: 200, part: 206, suffix: 206, head: 200, missing: 404, traversal: 403 })
  assert.equal(result.revoked, 403)
  assert.deepEqual(result.partBytes, [...binary.subarray(2, 8)])
  assert.deepEqual(result.suffixBytes, [...binary.subarray(binary.length - 4)])
  assert.equal(result.modelType, 'model/gltf+json'); assert.equal(result.imageType, 'image/png')
  assert.equal(result.partRange, `bytes 2-7/${binary.length}`); assert.equal(result.headLength, String(binary.length))
  report.localProtocol = result
  report.scenarios.push({ name: 'Native directory protocol, external GLTF mesh/texture, ranges and revocation', passed: true })
  console.log('[native-recovery] controlled local resource protocol passed')
}

try {
  assert.equal(process.platform, 'win32', 'This acceptance harness requires Windows Tauri/WebView2')
  await mkdir(output, { recursive: true })
  assert.equal(await available(serverPort), false, 'Acceptance server port is already occupied; no existing server is reused')
  assert.equal(await available(debugPort), false, 'Acceptance debugging port is already occupied')
  const config = { identifier, build: { devUrl: url }, app: { windows: [{ label: 'main', title: 'Desktop WebGIS · Recovery acceptance',
    width: 1440, height: 900, minWidth: 1024, minHeight: 680 }] } }
  await writeFile(join(output, 'tauri-config.json'), JSON.stringify(config, null, 2))
  console.log('[native-recovery] compiling an isolated application identifier')
  const build = start(['cargo', 'build', '--bin', 'desktop-webgis', '--locked'], tauri, { ...process.env, TAURI_CONFIG: JSON.stringify(config) })
  assert.equal(await finished(build), 0, 'Native acceptance executable must build')
  await copyFile(join(tauri, 'target', 'debug', 'desktop-webgis.exe'), join(output, 'desktop-webgis.exe'))
  server = start(['pnpm', 'dev', '--port', String(serverPort), '--strictPort'], desktop)
  await poll(async () => await available(serverPort), 'Owned Vite server did not start')

  await launch()
  await verifyLocalProtocol()
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'native-recovery.geojson', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'native-point',
      properties: { code: '001', value: 2 }, geometry: { type: 'Point', coordinates: [116.391, 39.907] } }] })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  const formal2d = join(output, 'formal-2d.webgis.json')
  const baseline2d = await saveTo(formal2d)
  const oldBytes = await readFile(formal2d)
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  const panel = page.locator('.attribute-table-tab-panel:visible')
  await panel.getByRole('button', { name: '字段计算', exact: true }).click()
  await panel.getByLabel('计算字段名').fill('value')
  await panel.getByLabel('字段计算表达式').fill('field("value") + 40')
  await panel.getByRole('button', { name: '应用计算', exact: true }).click()
  const draft2d = await draftWhere((draft) => Object.values(draft.snapshot.featuresByDataset).flat()[0]?.properties.value === 42)
  await page.screenshot({ path: join(output, 'native-2d-before-crash.png') })
  await crash()
  assert.deepEqual(await readFile(formal2d), oldBytes, 'Force exit must not modify the saved formal project')
  await launch()
  await page.screenshot({ path: join(output, 'native-recovery-startup.png') })
  await restore()
  await page.locator('.layer-name-button').filter({ hasText: 'native-recovery' }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  await expect(page.locator('.attribute-table-tab-panel:visible tbody')).toContainText('42')
  const restored2d = await saveTo(join(output, 'restored-2d.webgis.json'))
  assert.equal(restored2d.project.id, baseline2d.project.id)
  assert.deepEqual(restored2d.project.layers, draft2d.snapshot.project.layers)
  assert.deepEqual(restored2d.project.datasets, draft2d.snapshot.project.datasets)
  assert.deepEqual(restored2d.featuresByDataset, draft2d.snapshot.featuresByDataset)
  assert.deepEqual(await readFile(formal2d), oldBytes)
  report.scenarios.push({ name: '2D native process termination, startup restore and native save', passed: true })
  console.log('[native-recovery] 2D native recovery passed')

  await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.getByRole('menuitem', { name: /^新建/ }).click()
  const creating = page.getByRole('dialog', { name: '新建项目', exact: true })
  await creating.getByRole('radio', { name: /三维场景/ }).check()
  await creating.getByPlaceholder('例如：中心城区场景').fill('Native city recovery')
  await creating.getByRole('button', { name: '创建项目', exact: true }).click()
  await expect(page.locator('.city-footer__state')).toHaveText('就绪', { timeout: 60_000 })
  await page.getByRole('button', { name: '添加数据', exact: true }).click()
  const resource = page.getByRole('dialog', { name: '添加三维资源', exact: true })
  await resource.getByRole('radio', { name: 'GLB 模型', exact: true }).check()
  await resource.getByLabel('资源地址', { exact: true }).fill(`${url}/city-sample/tower.glb`)
  await resource.getByLabel('对象名称', { exact: true }).fill('Native Tower')
  await resource.getByRole('button', { name: '添加到场景', exact: true }).click()
  const row = page.locator('.city-layer-row').filter({ hasText: 'Native Tower' })
  await expect(row.locator('small')).toHaveText('模型', { timeout: 60_000 })
  await poll(async () => await modelPixels() > 100, 'Real GLB model pixels were not rendered')
  const formal3d = join(output, 'formal-3d.webgis.json')
  const localModel = join(output, '本地模型', '塔楼 #%.glb')
  await mkdir(dirname(localModel), { recursive: true })
  await copyFile(resolve(desktop, '../../examples/city-3d/city-sample/tower.glb'), localModel)
  await page.evaluate(async ({ formal3d, localModel }) => {
    const io = await import('/src/services/project-io.ts')
    io.setCurrentProjectPath(formal3d)
    const commands = await import('/src/features/city/city-commands.ts')
    commands.updateCity('切换本地模型引用', scene => {
      const node = scene.nodes.find(node => node.name === 'Native Tower')
      const asset = scene.assets[node.asset]
      delete asset.url
      asset.reference = { kind: 'absolute', path: localModel.replace(/\\/g, '/') }
      return scene
    })
  }, { formal3d, localModel })
  await expect(row.locator('small')).toHaveText('模型', { timeout: 60_000 })
  await poll(async () => await modelPixels() > 100, 'Local referenced GLB pixels were not rendered')
  const baseline3d = await saveTo(formal3d)
  const baselineAsset = Object.values(baseline3d.project.city.assets).find(asset => asset.reference)
  assert.equal(baselineAsset.reference.kind, 'relative')
  assert.equal(baselineAsset.url, undefined)
  report.localModelReference = baselineAsset.reference
  const cityBytes = await readFile(formal3d)
  await row.locator('.city-layer-row__select').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '对象属性', exact: true }).click()
  await page.getByRole('spinbutton', { name: '等比缩放', exact: true }).fill('2')
  await page.getByRole('spinbutton', { name: '等比缩放', exact: true }).press('Tab')
  const draft3d = await draftWhere((draft) => draft.snapshot.project.city?.nodes.some((node) => node.name === 'Native Tower' && node.transform.scale === 2))
  await crash(); assert.deepEqual(await readFile(formal3d), cityBytes)
  await launch(); await restore()
  await expect(page.locator('.city-footer__state')).toHaveText('就绪', { timeout: 60_000 })
  const recoveredRow = page.locator('.city-layer-row').filter({ hasText: 'Native Tower' })
  await expect(recoveredRow.locator('small')).toHaveText('模型', { timeout: 60_000 })
  await recoveredRow.locator('.city-layer-row__select').dblclick()
  await poll(async () => await modelPixels() > 100, 'Recovered GLB model pixels were not rendered')
  await waitForCityView()
  const visiblePixels = await modelPixels()
  const visibility = page.getByRole('checkbox', { name: '显示Native Tower', exact: true })
  await visibility.uncheck()
  await poll(async () => await modelPixels() < visiblePixels / 2, 'Hiding the recovered model did not remove its pixel signature')
  const hiddenPixels = await modelPixels()
  await visibility.check()
  await poll(async () => await modelPixels() > visiblePixels / 2, 'Showing the recovered model did not restore its pixel signature')
  report.modelVisibilityPixels = { visible: visiblePixels, hidden: hiddenPixels, restored: await modelPixels() }
  await recoveredRow.locator('.city-layer-row__select').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '对象属性', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '等比缩放', exact: true })).toHaveValue('2')
  const restored3d = await saveTo(join(output, 'restored-3d.webgis.json'))
  assert.equal(restored3d.project.id, baseline3d.project.id)
  assert.deepEqual(restored3d.project.city.nodes, draft3d.snapshot.project.city.nodes)
  const resolvedRestored = await page.evaluate(async ({ snapshot, path }) => {
    const io = await import('/src/services/project-resource-references.ts')
    return io.resolveProjectResourceReferences(snapshot, path)
  }, { snapshot: restored3d, path: join(output, 'restored-3d.webgis.json') })
  assert.deepEqual(resolvedRestored.project.city.assets, draft3d.snapshot.project.city.assets)
  assert.deepEqual(await readFile(formal3d), cityBytes)
  await page.screenshot({ path: join(output, 'native-city-restored.png') })
  report.scenarios.push({ name: '3D real GLB transform, native process termination and restore', passed: true })
  report.recoveredModelPixels = await modelPixels()
  console.log('[native-recovery] 3D native recovery passed')
} catch (error) {
  report.error = error.stack ?? String(error)
  await page?.screenshot({ path: join(output, 'native-failure.png') }).catch(() => undefined)
  if (page) report.liveState = await page.evaluate(async () => {
    const store = await import('/src/stores/project.store.ts')
    const io = await import('/src/services/project-io.ts')
    const state = store.useProjectStore.getState()
    return { dirty: state.dirty, version: store.getProjectContentVersion(), epoch: state.projectEpoch,
      snapshot: io.createSnapshotFromState(state.project, state.featuresByDataset) }
  }).catch(() => null)
  console.error(error); process.exitCode = 1
} finally {
  await forceStop(application).catch((error) => { report.stopError = String(error); process.exitCode = 1 })
  await browser?.close().catch(() => undefined)
  await forceStop(server).catch((error) => { report.serverStopError = String(error); process.exitCode = 1 })
  const normalEnvironment = { ...process.env }; delete normalEnvironment.TAURI_CONFIG
  console.log('[native-recovery] restoring the normal debug application configuration')
  const restoreBuild = start(['cargo', 'build', '--bin', 'desktop-webgis', '--locked'], tauri, normalEnvironment)
  if (await finished(restoreBuild) !== 0) { report.normalBuildError = 'Failed to restore normal debug configuration'; process.exitCode = 1 }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`[native-recovery] evidence: ${output}`)
}
