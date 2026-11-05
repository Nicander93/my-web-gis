import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const posix = value => value.replaceAll('\\', '/')

/** 已知违规；消失后必须从本列表删除。 */
const KNOWN_VIOLATIONS = []

/**
 * Desktop 真实 DAG 分层规则（而非假线性排名）：
 * - 第 1 层（界面层）：ui/workbench -> ui/panels -> ui/components
 * - 第 2 层（命令层）：commands
 * - 第 3 层（桥接层，平级并列）：engine-host、io
 * - 第 4 层（状态与工程数据层）：stores -> project -> project/datasets
 * - 第 5 层（系统底座层）：platform
 */
const ALLOWED_IMPORTS = {
  'ui/workbench': new Set(['ui/panels', 'ui/components', 'commands', 'engine-host', 'io', 'stores', 'project', 'project/datasets', 'platform']),
  'ui/panels': new Set(['ui/components', 'commands', 'engine-host', 'io', 'stores', 'project', 'project/datasets', 'platform']),
  'ui/components': new Set(['stores', 'platform']),
  commands: new Set(['engine-host', 'io', 'stores', 'project', 'project/datasets', 'platform']),
  'engine-host': new Set(['io', 'stores', 'project', 'project/datasets', 'platform']),
  io: new Set(['stores', 'project', 'project/datasets', 'platform']),
  stores: new Set(['project', 'project/datasets', 'platform']),
  project: new Set(['project/datasets', 'platform']),
  'project/datasets': new Set(['platform']),
  platform: new Set([])
}

const SKIP_DIR = new Set(['__tests__'])

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
  const parts = posix(rel).split('/')
  if (parts[0] === 'ui' && (parts[1] === 'workbench' || parts[1] === 'panels' || parts[1] === 'components')) {
    return `ui/${parts[1]}`
  }
  if (parts[0] === 'project' && parts[1] === 'datasets') {
    return 'project/datasets'
  }
  return parts[0] in ALLOWED_IMPORTS ? parts[0] : null
}

function allowedDesktop(fromLayer, toLayer) {
  if (!fromLayer || !toLayer || fromLayer === toLayer) return true
  return ALLOWED_IMPORTS[fromLayer]?.has(toLayer) ?? false
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
  const srcRoot = path.join(root, 'packages/internal/project/src')
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
  for (const tier of ['public', 'internal']) {
    const tierDir = path.join(packagesRoot, tier)
    if (!fs.existsSync(tierDir)) continue
    for (const name of fs.readdirSync(tierDir)) {
      const manifestPath = path.join(tierDir, name, 'package.json')
      if (!fs.existsSync(manifestPath)) continue
      result.set(`${tier}/${name}`, { tier, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) })
    }
  }
  return result
}

function checkPackages() {
  const found = new Set()
  const packages = workspacePackages()
  const byName = new Map([...packages.values()].map(entry => [entry.manifest.name, entry]))
  for (const [dir, { tier, manifest }] of packages) {
    if (tier === 'public' && manifest.private === true) {
      found.add(`packages/${dir} sits in public/ but has private: true`)
    }
    if (tier === 'internal' && manifest.private !== true) {
      found.add(`packages/${dir} sits in internal/ but lacks private: true`)
    }
    const deps = { ...manifest.dependencies, ...manifest.peerDependencies }
    for (const dep of Object.keys(deps)) {
      if (dep.startsWith('apps/') || dep.includes('/apps/')) found.add(`${manifest.name} -> ${dep}`)
      if (!dep.startsWith('@desktop-webgis/')) continue
      const target = byName.get(dep)
      if (!target) continue
      if (tier === 'public' && target.tier !== 'public') {
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
