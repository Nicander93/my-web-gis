import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tauri = join(desktop, 'src-tauri')
const runId = Date.now().toString()
const identifier = `com.desktop-webgis.resource-acceptance-${runId}`
// Playwright clears test-results before each run; native fixtures must live elsewhere.
const output = resolve(desktop, '../../.artifacts', `native-resources-${runId}`)
const serverPort = 5197, debugPort = 9229
const url = `http://127.0.0.1:${serverPort}`
const report = { identifier, output, scenarios: [], screenshots: false,
  nativeFileChooser: 'Not verified: fixture working paths assigned; native filesystem and resource protocol used',
  windowsScale125: 'Not verified', resourceResponses: [] }
let server, application, browser, page
let oldResourceUrl

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
  page.on('response', response => {
    const resource = new URL(response.url())
    if (resource.hostname !== 'webgis-resource.localhost') return
    oldResourceUrl ??= response.url()
    // The ephemeral directory key is deliberately excluded from persisted evidence.
    report.resourceResponses.push({ path: decodeURIComponent(resource.pathname.split('/').slice(2).join('/')), status: response.status() })
  })
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
  console.log(`[native-resources] launched owned PID ${application.pid}, ${identity.identifier}`)
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
async function waitForSceneView() {
  if (await page.locator('.scene3d-canvas__viewport canvas').count()) {
    let previous, stable = 0
    await poll(async () => {
      const camera = await page.evaluate(async () => (await import('/src/features/scene3d/scene3d-runtime-host.ts')).getLiveSceneCamera())
      const values = camera && [...camera.position, camera.heading, camera.pitch, camera.roll]
      if (values && previous && values.every((value, index) => Math.abs(value - previous[index]) < (index === 2 ? 1e-5 : 1e-8))) stable++
      else stable = 0
      previous = values
      return stable >= 4
    }, 'Cesium view did not settle before native save')
  }
}
async function saveTo(path) {
  await waitForSceneView()
  await page.evaluate(async (file) => (await import('/src/services/project-io.ts')).setCurrentProjectPath(file), path)
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await expect(page.locator('.project-dirty')).toHaveCount(0)
  await poll(async () => (await entries()).length === 0, 'Native save did not clear the acknowledged recovery draft')
  return JSON.parse(await readFile(path, 'utf8'))
}

async function ready(name, label = '模型') {
  const row = page.locator('.scene3d-layer-row').filter({ hasText: name })
  await expect(row.locator('small')).toHaveText(label, { timeout: 60_000 })
  const diagnostics = await page.evaluate(async (name) => {
    const state = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    const node = state.project.city.nodes.find(node => node.name === name)
    return (await import('/src/features/scene3d/scene3d-runtime-host.ts')).getLiveSceneDiagnostics(node.id)
  }, name)
  assert.ok(diagnostics.presentation, 'Native resource must have a loaded layer')
  if (label === '模型') assert.ok(diagnostics.presentation.position, 'Native model must have a loaded model matrix')
  return diagnostics
}

async function readyResources() {
  await ready('Native external GLTF')
  await ready('Native nested Tileset', '3D Tiles')
  const diagnostics = await ready('Native GeoJSON', '矢量数据')
  assert.equal(diagnostics.managedLayers, 3)
  assert.equal(diagnostics.dataSources, 1, 'GeoJSON must own a real Cesium datasource')
}

async function dependencies(directory, since = 0) {
  for (const file of ['模型.gltf', '几何.bin', '纹理.png', 'tileset.json', '子瓦片/tileset.json', '子瓦片/内容/街区.glb', '要素.geojson']) {
    const path = directory ? `${directory}/${file}` : file
    await poll(async () => report.resourceResponses.slice(since).some(item => item.path === path && item.status === 200), `Native dependency did not load: ${path}`)
  }
}

try {
  assert.equal(process.platform, 'win32')
  await mkdir(output, { recursive: true })
  assert.equal(await available(serverPort), false, 'Owned server port is occupied')
  assert.equal(await available(debugPort), false, 'Owned debugging port is occupied')
  const config = { identifier, build: { devUrl: url }, app: { windows: [{ label: 'main', title: 'Desktop WebGIS · Resource acceptance', width: 1440, height: 900, minWidth: 1024, minHeight: 680 }] } }
  await writeFile(join(output, 'tauri-config.json'), JSON.stringify(config, null, 2))
  const build = start(['cargo', 'build', '--bin', 'desktop-webgis', '--locked'], tauri, { ...process.env, TAURI_CONFIG: JSON.stringify(config) })
  assert.equal(await finished(build), 0)
  await copyFile(join(tauri, 'target', 'debug', 'desktop-webgis.exe'), join(output, 'desktop-webgis.exe'))
  const source = join(output, '原始资源 #%', '模型.gltf')
  const relocated = join(output, '迁移资源 #%', '模型.gltf')
  const binary = await readFile(resolve(desktop, '../../examples/city-3d/city-sample/tower.glb'))
  const jsonLength = binary.readUInt32LE(12)
  const document = JSON.parse(binary.subarray(20, 20 + jsonLength).toString('utf8'))
  document.buffers[0].uri = '几何.bin'
  const uvBuffers = []
  for (const model of document.meshes) for (const primitive of model.primitives) {
    const count = document.accessors[primitive.attributes.POSITION].count
    const uv = Buffer.alloc(count * 2 * 4)
    const name = `坐标-${uvBuffers.length}.bin`
    const buffer = document.buffers.push({ uri: name, byteLength: uv.length }) - 1
    const bufferView = document.bufferViews.push({ buffer, byteLength: uv.length, target: 34962 }) - 1
    primitive.attributes.TEXCOORD_0 = document.accessors.push({ bufferView, componentType: 5126, count, type: 'VEC2' }) - 1
    uvBuffers.push({ name, uv })
  }
  document.images = [{ uri: '纹理.png' }]
  document.textures = [{ source: 0 }]
  for (const material of document.materials) {
    material.pbrMetallicRoughness ??= {}
    material.pbrMetallicRoughness.baseColorTexture = { index: 0 }
  }
  const mesh = binary.subarray(28 + jsonLength, 28 + jsonLength + binary.readUInt32LE(20 + jsonLength))
  for (const file of [source, relocated]) {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(document))
    await writeFile(join(dirname(file), '几何.bin'), mesh)
    for (const { name, uv } of uvBuffers) await writeFile(join(dirname(file), name), uv)
    await writeFile(join(dirname(file), '纹理.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64'))
    const root = JSON.parse(await readFile(resolve(desktop, '../../examples/city-3d/city-sample/tileset.json'), 'utf8'))
    const nested = structuredClone(root)
    delete nested.root.transform
    nested.root.content.uri = '内容/街区.glb'
    root.root.content.uri = '子瓦片/tileset.json'
    root.root.geometricError = 1000
    await mkdir(join(dirname(file), '子瓦片', '内容'), { recursive: true })
    await writeFile(join(dirname(file), 'tileset.json'), JSON.stringify(root))
    await writeFile(join(dirname(file), '子瓦片', 'tileset.json'), JSON.stringify(nested))
    await copyFile(resolve(desktop, '../../examples/city-3d/city-sample/city.glb'), join(dirname(file), '子瓦片', '内容', '街区.glb'))
    await writeFile(join(dirname(file), '要素.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: '原生要素', value: 42 }, geometry: { type: 'Point', coordinates: [116.391, 39.907] } }] }))
  }
  server = start(['pnpm', 'dev', '--port', String(serverPort), '--strictPort'], desktop)
  await poll(() => available(serverPort), 'Owned Vite server did not start')
  await launch()
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 60_000 })
  await page.getByRole('button', { name: '添加数据', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加三维资源', exact: true })
  await dialog.getByRole('radio', { name: 'GLB 模型', exact: true }).check()
  await dialog.getByRole('radio', { name: '本地文件', exact: true }).check()
  await dialog.getByLabel('对象名称', { exact: true }).fill('Native external GLTF')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  // Assigned fixture paths exercise native IPC and the production runtime, not the OS picker.
  await page.evaluate(async ({ source, projectPath }) => {
    (await import('/src/services/project-io.ts')).setCurrentProjectPath(projectPath)
    const commands = await import('/src/features/scene3d/scene3d-commands.ts')
    commands.addSceneAsset('model', { kind: 'absolute', path: source }, 'Native external GLTF')
    const directory = source.slice(0, source.lastIndexOf('/'))
    commands.addSceneAsset('3dtiles', { kind: 'absolute', path: `${directory}/tileset.json` }, 'Native nested Tileset')
    commands.addSceneAsset('geojson', { kind: 'absolute', path: `${directory}/要素.geojson` }, 'Native GeoJSON')
    commands.updateScene('设置验收视图', scene => {
      scene.camera = { position: [116.391, 39.902, 850], heading: 0, pitch: -48, roll: 0 }
      return scene
    })
  }, { source: source.replaceAll('\\', '/'), projectPath: join(output, '原生项目.webgis.json') })
  report.initial = await ready('Native external GLTF')
  await readyResources()
  await dependencies('原始资源 #%')
  report.scenarios.push({ name: 'Native nested Tileset JSON/GLB dependencies and GeoJSON datasource load together', passed: true })
  await poll(async () => report.resourceResponses.some(item => item.path.includes('原始资源 #%/几何.bin') && item.status === 200), 'External geometry must be requested by Cesium')
  await poll(async () => report.resourceResponses.some(item => item.path.includes('原始资源 #%/纹理.png') && item.status === 200), 'External texture must be requested by Cesium')
  report.scenarios.push({ name: 'Native GLTF external binary loading with Unicode and reserved path characters', passed: true })
  const projectPath = join(output, '原生项目.webgis.json')
  await saveTo(projectPath)
  await expect(page.locator('.project-dirty')).toHaveCount(0)
  const saved = JSON.parse(await readFile(projectPath, 'utf8'))
  const asset = Object.values(saved.project.city.assets).find(asset => asset.reference)
  assert.equal(asset.reference.kind, 'relative')
  assert.equal(asset.url, undefined)
  assert.equal(Object.values(saved.project.city.assets).filter(asset => asset.reference?.kind === 'relative' && !asset.url).length, 3)
  const reopenedResponses = report.resourceResponses.length
  await crash(); await launch()
  assert.ok(oldResourceUrl)
  assert.equal(await page.evaluate(async url => (await fetch(url)).status, oldResourceUrl), 403, 'A previous process directory lease must not survive restart')
  await page.evaluate(async path => {
    const text = await (await import('/src/services/files.ts')).readTextFile(path)
    const snapshot = JSON.parse(text)
    const resolved = (await import('/src/services/project-resource-references.ts')).resolveProjectResourceReferences(snapshot, path)
    ;(await import('/src/stores/project.store.ts')).useProjectStore.getState().loadSnapshot(resolved)
    ;(await import('/src/services/project-io.ts')).setCurrentProjectPath(path)
  }, projectPath)
  await readyResources()
  await dependencies('原始资源 #%', reopenedResponses)
  report.scenarios.push({ name: 'Native save, relative reference persistence and reopen after process restart', passed: true })
  const row = page.locator('.scene3d-layer-row').filter({ hasText: 'Native external GLTF' })
  await row.locator('.scene3d-layer-row__select').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '数据源', exact: true }).click()
  await page.getByRole('button', { name: '重新定位本地资源', exact: true }).click()
  const relocation = page.getByRole('dialog', { name: '重新定位本地资源', exact: true })
  await relocation.getByRole('radio', { name: '替换当前资源文件', exact: true }).check()
  await relocation.getByLabel('资源新位置').fill(relocated)
  await relocation.getByRole('button', { name: '应用重定位', exact: true }).click()
  await ready('Native external GLTF')
  await poll(async () => report.resourceResponses.some(item => item.path.includes('迁移资源 #%/几何.bin') && item.status === 200), 'Relocated external geometry must load from the new directory')
  await poll(async () => report.resourceResponses.some(item => item.path.includes('迁移资源 #%/纹理.png') && item.status === 200), 'Relocated texture must load from the new directory')
  const changed = await saveTo(projectPath)
  const changedAsset = Object.values(changed.project.city.assets).find(asset => asset.reference)
  assert.ok(changedAsset.reference.path.includes('迁移资源 #%'))
  assert.deepEqual(changed.project.city.nodes, saved.project.city.nodes)
  report.scenarios.push({ name: 'Native relocation loads external binary from new directory and persists the new relative path', passed: true })
  const tileRow = page.locator('.scene3d-layer-row').filter({ hasText: 'Native nested Tileset' })
  await tileRow.locator('.scene3d-layer-row__select').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '数据源', exact: true }).click()
  await page.getByRole('button', { name: '重新定位本地资源', exact: true }).click()
  await relocation.getByRole('radio', { name: '替换所在目录', exact: true }).check()
  await relocation.getByLabel('资源新位置').fill(dirname(relocated))
  await expect(relocation.getByRole('status')).toHaveText('将更新 2 个资源引用')
  const relocatedResponses = report.resourceResponses.length
  await relocation.getByRole('button', { name: '应用重定位', exact: true }).click()
  await readyResources()
  for (const file of ['tileset.json', '子瓦片/tileset.json', '子瓦片/内容/街区.glb', '要素.geojson']) {
    await poll(async () => report.resourceResponses.slice(relocatedResponses).some(item => item.path === `迁移资源 #%/${file}` && item.status === 200), `Relocated resource dependency missing: ${file}`)
  }
  const relocatedSnapshot = await saveTo(projectPath)
  assert.deepEqual(relocatedSnapshot.project.city.nodes, saved.project.city.nodes)
  assert.ok(Object.values(relocatedSnapshot.project.city.assets).every(asset => asset.reference?.path.startsWith('迁移资源 #%/')))
  report.scenarios.push({ name: 'Parent directory relocation updates exactly Tileset and GeoJSON; nested content actually reloads without duplicating datasource', passed: true })
  const anotherPath = join(output, '另存目录', '副本.webgis.json')
  await mkdir(dirname(anotherPath), { recursive: true })
  const previousBytes = await readFile(projectPath)
  const copy = await page.evaluate(async path => {
    const state = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    const io = await import('/src/services/project-io.ts')
    const before = structuredClone(state.getSnapshot())
    await io.saveSnapshotToPath(path, io.createSnapshotFromState(state.project, state.featuresByDataset))
    return { before, after: state.getSnapshot(), currentPath: io.getCurrentProjectPath() }
  }, anotherPath)
  assert.deepEqual(copy.after, copy.before)
  assert.equal(copy.currentPath, projectPath)
  assert.deepEqual(await readFile(projectPath), previousBytes)
  const copySnapshot = JSON.parse(await readFile(anotherPath, 'utf8'))
  const copyAsset = Object.values(copySnapshot.project.city.assets).find(asset => asset.reference)
  assert.equal(copyAsset.reference.kind, 'absolute', 'Files outside the new project directory remain explicit absolute references')
  assert.equal(copyAsset.reference.path, relocated.replaceAll('\\', '/'))
  assert.equal(Object.values(copySnapshot.project.city.assets).filter(asset => asset.reference?.kind === 'absolute').length, 3)
  report.scenarios.push({ name: 'Cross-directory native snapshot save preserves working state, current file and original bytes; external reference rebased correctly', passed: true })
  // Opening a copied project must not silently authorize paths outside its directory.
  await page.evaluate(async ({ snapshot, path }) => {
    (await import('/src/stores/project.store.ts')).useProjectStore.getState().loadSnapshot(snapshot)
    ;(await import('/src/services/project-io.ts')).setCurrentProjectPath(path)
  }, { snapshot: copySnapshot, path: anotherPath })
  await expect(page.locator('.scene3d-footer__state')).toHaveClass(/scene3d-footer__state--error/)
  const beforeAuthorization = await page.evaluate(async () => {
    const state = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    return { snapshot: state.getSnapshot(), dirty: state.dirty, canUndo: state.canUndoEdit(), canRedo: state.canRedoEdit() }
  })
  await page.locator('.scene3d-layer-row').filter({ hasText: 'Native nested Tileset' }).locator('.scene3d-layer-row__select').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '数据源', exact: true }).click()
  await page.getByRole('button', { name: '重新定位本地资源', exact: true }).click()
  await relocation.getByRole('radio', { name: '替换所在目录', exact: true }).check()
  await relocation.getByLabel('资源新位置').fill(dirname(relocated))
  await expect(relocation.getByRole('status')).toHaveText('将更新 0 个资源引用')
  const authorizationResponses = report.resourceResponses.length
  await relocation.getByRole('button', { name: '授权目录并重新加载', exact: true }).click()
  await readyResources()
  await dependencies('', authorizationResponses)
  const afterAuthorization = await page.evaluate(async () => {
    const state = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    return { snapshot: state.getSnapshot(), dirty: state.dirty, canUndo: state.canUndoEdit(), canRedo: state.canRedoEdit() }
  })
  assert.deepEqual(afterAuthorization, beforeAuthorization)
  report.scenarios.push({ name: 'Copied project rejects unauthorized external roots; explicit same-directory authorization reloads all resources without project/history changes', passed: true })
} catch (error) {
  report.error = error.stack ?? String(error)
  console.error(error); process.exitCode = 1
} finally {
  await forceStop(application).catch(error => { report.stopError = String(error); process.exitCode = 1 })
  await browser?.close().catch(() => undefined)
  await forceStop(server).catch(error => { report.serverStopError = String(error); process.exitCode = 1 })
  const normalEnvironment = { ...process.env }; delete normalEnvironment.TAURI_CONFIG
  const build = start(['cargo', 'build', '--bin', 'desktop-webgis', '--locked'], tauri, normalEnvironment)
  if (await finished(build) !== 0) { report.normalBuildError = 'Normal debug configuration restore failed'; process.exitCode = 1 }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`[native-resources] evidence: ${output}`)
}
