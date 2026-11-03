import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const posix = value => value.replaceAll('\\', '/')

/** 已知违规；消失后必须从本列表删除。 */
const KNOWN_VIOLATIONS = []

const LAYER_RANK = {
  shell: 0,
  features: 1,
  commands: 2,
  runtime: 3,
  exchange: 4,
  'view-state': 5,
  session: 6,
  data: 7,
  platform: 8
}
const LAYERS = new Set([...Object.keys(LAYER_RANK), 'ui'])
const SKIP_DIR = new Set(['cartography-spike', 'cartography-visual-baseline', 'cartography-webgl', '__tests__'])

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else acc.push(full)
  }
  return acc
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function importsOf(text) {
  const specs = []
  const source = stripComments(text)
  const pattern = /(?:import|export)\s+(?:type\s+)?(?:[^'"\n]*?\sfrom\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of source.matchAll(pattern)) specs.push(match[1] ?? match[2])
  return specs
}

function layerOf(rel) {
  const first = posix(rel).split('/')[0]
  return LAYERS.has(first) ? first : null
}

function allowedDesktop(fromLayer, toLayer) {
  if (!fromLayer || !toLayer || fromLayer === toLayer) return true
  if (toLayer === 'ui') return fromLayer === 'shell' || fromLayer === 'features'
  if (fromLayer === 'ui') return toLayer === 'view-state' || toLayer === 'platform'
  if (!(fromLayer in LAYER_RANK) || !(toLayer in LAYER_RANK)) return true
  return LAYER_RANK[fromLayer] < LAYER_RANK[toLayer]
}

function resolveDesktopImport(fromFile, spec, srcRoot) {
  if (spec.startsWith('@/')) return path.join(srcRoot, spec.slice(2))
  if (!spec.startsWith('.')) return null
  return path.resolve(path.dirname(fromFile), spec)
}

function existingModule(base) {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx')
  ]
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null
}

function checkDesktop() {
  const srcRoot = path.join(root, 'apps/desktop/src')
  const found = new Set()
  for (const file of walk(srcRoot)) {
    const rel = posix(path.relative(srcRoot, file))
    if (!/\.(ts|tsx)$/.test(rel) || /\.test\.(ts|tsx)$/.test(rel) || SKIP_DIR.has(rel.split('/')[0])) continue
    const fromLayer = layerOf(rel)
    if (!fromLayer) continue
    for (const spec of importsOf(fs.readFileSync(file, 'utf8'))) {
      const resolved = resolveDesktopImport(file, spec, srcRoot)
      if (!resolved) continue
      const target = existingModule(resolved)
      if (!target) continue
      const toRel = posix(path.relative(srcRoot, target))
      if (toRel.startsWith('..')) continue
      const toLayer = layerOf(toRel)
      if (!toLayer || allowedDesktop(fromLayer, toLayer)) continue
      found.add(`${rel} -> ${toRel}`)
    }
  }
  return found
}

function checkProject() {
  const srcRoot = path.join(root, 'packages/project/src')
  const found = new Set()
  const banned = {
    data: ['config', 'history'],
    config: ['history']
  }
  for (const file of walk(srcRoot)) {
    const rel = posix(path.relative(srcRoot, file))
    if (!/\.ts$/.test(rel) || /\.test\.ts$/.test(rel)) continue
    const fromDir = rel.split('/')[0]
    const forbidden = banned[fromDir]
    if (!forbidden) continue
    for (const spec of importsOf(fs.readFileSync(file, 'utf8'))) {
      const resolved = spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : null
      if (!resolved) continue
      const target = existingModule(resolved)
      if (!target) continue
      const toRel = posix(path.relative(srcRoot, target))
      const toDir = toRel.split('/')[0]
      if (forbidden.includes(toDir)) found.add(`project/${rel} -> project/${toRel}`)
    }
  }
  return found
}

function workspacePackages() {
  const packagesRoot = path.join(root, 'packages')
  const result = new Map()
  for (const name of fs.readdirSync(packagesRoot)) {
    const manifestPath = path.join(packagesRoot, name, 'package.json')
    if (!fs.existsSync(manifestPath)) continue
    result.set(name, JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
  }
  return result
}

function checkPackages() {
  const found = new Set()
  const packages = workspacePackages()
  const byName = new Map([...packages.values()].map(manifest => [manifest.name, manifest]))
  for (const [dir, manifest] of packages) {
    const deps = { ...manifest.dependencies, ...manifest.peerDependencies }
    for (const dep of Object.keys(deps)) {
      if (dep.startsWith('apps/') || dep.includes('/apps/')) found.add(`${manifest.name} -> ${dep}`)
      if (!dep.startsWith('@desktop-webgis/')) continue
      const target = byName.get(dep)
      if (!target) continue
      if (manifest.private !== true && target.private === true) {
        found.add(`${manifest.name} -> ${dep}`)
      }
    }
    const dirName = posix(path.relative(root, path.join(root, 'packages', dir)))
    if (Object.values(deps).some(value => String(value).includes('apps/'))) {
      found.add(`${dirName} depends on apps/`)
    }
  }
  return found
}

const found = new Set([...checkDesktop(), ...checkProject(), ...checkPackages()])
const known = new Set(KNOWN_VIOLATIONS)
const unexpected = [...found].filter(item => !known.has(item)).sort()
const stale = [...known].filter(item => !found.has(item)).sort()

if (unexpected.length) {
  console.error('新的分层违规：')
  for (const item of unexpected) console.error(`  ${item}`)
}
if (stale.length) {
  console.error('已知违规已消失，请从 scripts/check-architecture.mjs 删除：')
  for (const item of stale) console.error(`  ${item}`)
}
if (!unexpected.length && !stale.length) {
  console.log(`分层检查通过（已知违规 ${known.size} 条）`)
}
process.exit(unexpected.length || stale.length ? 1 : 0)
