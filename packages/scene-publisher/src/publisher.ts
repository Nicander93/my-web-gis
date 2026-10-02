import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { serializeScene } from '@desktop-webgis/scene-core/scene'
import { parseScene, type SceneManifest, type SceneSource } from '@desktop-webgis/scene-schema'
import type {
  BuildStaticSceneOptions,
  BuildStaticSceneResult,
  PublishManifest,
  PublishedFile
} from './types.js'

const RESERVED_VIEWER_FILES = new Set(['scene.json', 'runtime-config.json', 'publish-manifest.json'])

interface ResourcePlan {
  sourcePath: string
  relativeTarget: string
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function safeRelativePath(value: string): string {
  if (value.includes('?') || value.includes('#')) {
    throw new Error(`本地资源 URL 不得包含 query 或 hash：${value}`)
  }
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '')
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error(`不安全的发布资源路径：${value}`)
  }
  return normalized
}

function sceneResourceUrls(scene: SceneManifest): string[] {
  const urls: string[] = []
  for (const source of Object.values(scene.sources)) {
    if (source.type === 'geojson' && source.url) urls.push(source.url)
  }
  if (scene.theme?.logo) urls.push(scene.theme.logo)
  if (scene.city) for (const asset of Object.values(scene.city.assets)) urls.push(asset.url)
  return [...new Set(urls)]
}

async function requireFile(filePath: string, label: string): Promise<string> {
  const resolved = path.resolve(filePath)
  const info = await stat(resolved).catch(() => null)
  if (!info?.isFile()) throw new Error(`${label}不存在或不是文件：${resolved}`)
  return resolved
}

async function requireDirectory(directoryPath: string, label: string): Promise<string> {
  const resolved = path.resolve(directoryPath)
  const info = await stat(resolved).catch(() => null)
  if (!info?.isDirectory()) throw new Error(`${label}不存在或不是目录：${resolved}`)
  return resolved
}

async function ensureEmptyOutput(directoryPath: string): Promise<string> {
  const resolved = path.resolve(directoryPath)
  const info = await stat(resolved).catch(() => null)
  if (info && !info.isDirectory()) throw new Error(`发布目标不是目录：${resolved}`)
  if (info && (await readdir(resolved)).length > 0) {
    throw new Error(`发布目标必须不存在或为空目录：${resolved}`)
  }
  return resolved
}

function assertInside(baseDirectory: string, targetPath: string): void {
  const relative = path.relative(baseDirectory, targetPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`发布目标越出输出目录：${targetPath}`)
  }
}

async function planResources(
  scene: SceneManifest,
  resources: Record<string, string>
): Promise<ResourcePlan[]> {
  const plan: ResourcePlan[] = []
  for (const environment of [scene.city?.basemap, scene.city?.terrain]) {
    if (environment && !isRemoteUrl(environment.url)) throw new Error('静态发布的三维底图和地形须使用 HTTP(S) 服务 URL')
  }
  for (const url of sceneResourceUrls(scene)) {
    if (isRemoteUrl(url)) continue
    const relativeTarget = safeRelativePath(url)
    const sourcePath = resources[url] ?? resources[relativeTarget]
    if (!sourcePath) throw new Error(`本地资源缺少文件映射：${url}`)
    const resolved = await requireFile(sourcePath, `资源 ${url}`)
    plan.push({ sourcePath: resolved, relativeTarget })
    if (Object.values(scene.city?.assets ?? {}).some(asset => asset.url === url && (asset.type === '3dtiles' || asset.type === 'glb'))) {
      await collectModelResources(resolved, relativeTarget, plan)
    }
  }
  return plan
}

/** Collect explicit tileset/glTF dependencies before writing any publication files. */
async function collectModelResources(sourcePath: string, relativeTarget: string, plan: ResourcePlan[]): Promise<void> {
  const root = await realpath(path.dirname(sourcePath))
  const visited = new Set<string>()
  async function visit(source: string, target: string): Promise<void> {
    const canonical = await realpath(source)
    assertInside(root, canonical)
    if (visited.has(canonical)) return
    visited.add(canonical)
    const content = await readFile(canonical)
    const extension = path.extname(source).toLowerCase()
    let document: unknown
    if (extension === '.json' || extension === '.gltf') document = JSON.parse(content.toString('utf8'))
    else if (extension === '.glb') document = parseGlbJson(content)
    else if (extension === '.b3dm') {
      if (content.length < 28) throw new Error(`无效 b3dm：${source}`)
      const offset = 28 + [12,16,20,24].reduce((sum,index) => sum + content.readUInt32LE(index),0)
      document = parseGlbJson(content.subarray(offset))
    } else if (extension === '.i3dm' || extension === '.cmpt' || extension === '.subtree') {
      throw new Error(`本地发布暂不支持 ${extension} 依赖收集，请使用在线 3D Tiles URL：${source}`)
    } else return
    const uris: string[] = []
    function walk(value: unknown): void {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(walk); return }
      const object = value as Record<string, unknown>
      if (object.implicitTiling) throw new Error('本地隐式 3D Tiles 请先展开，或使用在线 URL 发布')
      for (const [key, entry] of Object.entries(object)) {
        if ((key === 'uri' || key === 'url') && typeof entry === 'string') uris.push(entry)
        else walk(entry)
      }
    }
    walk(document)
    for (const uri of new Set(uris)) {
      if (isRemoteUrl(uri) || uri.startsWith('data:')) continue
      if (/[{}%?#\\]/.test(uri) || path.isAbsolute(uri) || /^[a-zA-Z]:/.test(uri)) throw new Error(`无法收集模型资源 URI：${uri}`)
      const nextSource = path.resolve(path.dirname(source), uri)
      assertInside(root,nextSource)
      const nextTarget = safeRelativePath(path.posix.normalize(path.posix.join(path.posix.dirname(target),uri)))
      await requireFile(nextSource,`模型依赖 ${uri}`)
      if (!plan.some(resource => resource.relativeTarget === nextTarget)) plan.push({ sourcePath:nextSource, relativeTarget:nextTarget })
      await visit(nextSource,nextTarget)
    }
  }
  await visit(sourcePath,relativeTarget)
}

function parseGlbJson(content: Buffer): unknown {
  if (content.length < 20 || content.readUInt32LE(0) !== 0x46546c67 || content.readUInt32LE(4) !== 2 || content.readUInt32LE(16) !== 0x4e4f534a) throw new Error('无效 GLB 文件')
  const length = content.readUInt32LE(12)
  if (20 + length > content.length) throw new Error('GLB JSON 数据不完整')
  return JSON.parse(content.subarray(20,20+length).toString('utf8'))
}

async function copyViewerDirectory(source: string, target: string, root = source): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const relative = path.relative(root, sourcePath).replaceAll('\\', '/')
    if (!relative.includes('/') && RESERVED_VIEWER_FILES.has(relative)) continue
    const targetPath = path.join(target, relative)
    assertInside(target, targetPath)
    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true })
      await copyViewerDirectory(sourcePath, target, root)
    } else if (entry.isFile()) {
      await mkdir(path.dirname(targetPath), { recursive: true })
      await copyFile(sourcePath, targetPath)
    }
  }
}

async function listPublishedFiles(root: string, current = root): Promise<PublishedFile[]> {
  const files: PublishedFile[] = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listPublishedFiles(root, fullPath)))
    } else if (entry.isFile() && entry.name !== 'publish-manifest.json') {
      const content = await readFile(fullPath)
      files.push({
        path: path.relative(root, fullPath).replaceAll('\\', '/'),
        bytes: content.byteLength,
        sha256: createHash('sha256').update(content).digest('hex')
      })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function providerWarnings(scene: SceneManifest, credentials: Record<string, string>): string[] {
  const warnings: string[] = []
  for (const [sourceId, source] of Object.entries(scene.sources)) {
    if (source.type !== 'provider') continue
    if (!credentials[source.credential]) {
      warnings.push(`Provider Source “${sourceId}” 需要在部署环境提供 Credential “${source.credential}”`)
    }
    if (source.provider === 'google-map-tiles') {
      warnings.push('Google Map Tiles 保持在线加载；发布物不得预取、复制或离线缓存其瓦片')
    }
  }
  return [...new Set(warnings)]
}

function normalizePublicUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`publicBaseUrl 必须是有效的 HTTP(S) URL：${value}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`publicBaseUrl 只允许 HTTP(S)：${value}`)
  }
  url.hash = ''
  url.search = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.toString()
}

/** Builds a static scene without deleting or overwriting an existing artifact. */
export async function buildStaticScene(options: BuildStaticSceneOptions): Promise<BuildStaticSceneResult> {
  const scene = parseScene(options.scene)
  const viewerDirectory = await requireDirectory(options.viewerDirectory, 'Viewer 目录')
  const outputDirectory = await ensureEmptyOutput(options.outputDirectory)
  const resourcePlan = await planResources(scene, options.resources ?? {})
  const targets = new Map<string, string>()
  for (const resource of resourcePlan) {
    const target = resource.relativeTarget.toLowerCase()
    const viewerFile = path.join(viewerDirectory, resource.relativeTarget)
    const viewerContent = await readFile(viewerFile).catch(() => undefined)
    if (RESERVED_VIEWER_FILES.has(target) || (viewerContent && !viewerContent.equals(await readFile(resource.sourcePath)))) {
      throw new Error(`资源路径与 Viewer 文件冲突：${resource.relativeTarget}`)
    }
    const previous = targets.get(target)
    if (previous && path.resolve(previous) !== path.resolve(resource.sourcePath)) throw new Error(`资源输出路径重复：${resource.relativeTarget}`)
    targets.set(target, resource.sourcePath)
  }
  const indexPath = await requireFile(path.join(viewerDirectory, 'index.html'), 'Viewer index.html')
  void indexPath

  await mkdir(outputDirectory, { recursive: true })
  await copyViewerDirectory(viewerDirectory, outputDirectory)
  for (const resource of resourcePlan) {
    const targetPath = path.resolve(outputDirectory, resource.relativeTarget)
    assertInside(outputDirectory, targetPath)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(resource.sourcePath, targetPath)
  }

  await writeFile(path.join(outputDirectory, 'scene.json'), serializeScene(scene), 'utf8')
  if (options.runtimeCredentials && Object.keys(options.runtimeCredentials).length > 0) {
    await writeFile(
      path.join(outputDirectory, 'runtime-config.json'),
      `${JSON.stringify({ credentials: options.runtimeCredentials }, null, 2)}\n`,
      'utf8'
    )
  }

  const publicUrl = normalizePublicUrl(options.publicBaseUrl)
  const manifest: PublishManifest = {
    artifactVersion: 1,
    sceneId: scene.id,
    sceneVersion: scene.version,
    runtimeVersion: options.runtimeVersion ?? '0.1.0',
    builtAt: new Date().toISOString(),
    ...(publicUrl ? { publicUrl } : {}),
    files: await listPublishedFiles(outputDirectory)
  }
  await writeFile(
    path.join(outputDirectory, 'publish-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )

  return {
    outputDirectory,
    manifest,
    warnings: providerWarnings(scene, options.runtimeCredentials ?? {})
  }
}

export function sourceRequiresPublishedFile(source: SceneSource): boolean {
  return source.type === 'geojson' && Boolean(source.url && !isRemoteUrl(source.url))
}
