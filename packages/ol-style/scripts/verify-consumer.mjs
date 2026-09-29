/**
 * P20 验收：在 pnpm workspace 解析范围外安装 ol-style tarball + 声明的 OL 版本，
 * 执行类型检查与示例运行。不发布 npm，不依赖仓库内其他私有包。
 */
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')
const repoRoot = resolve(pkgRoot, '../..')
const peerOl = '^10.10.0'

function run(command, args, options = {}) {
  // Windows needs shell for pnpm.cmd / npm.cmd resolution.
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...options
  })
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n')
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${detail}`)
  }
  return result
}

function assertNoLeak(text, label) {
  const patterns = [
    /workspace:\*/i,
    /D:\\my-code-repo/i,
    /\/home\/box\//i,
    /file:\/\/\//i
  ]
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      throw new Error(`${label} contains forbidden leak matching ${pattern}`)
    }
  }
}

function walkFiles(dir, extensions) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, extensions))
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

console.log('[verify-consumer] build package')
run('pnpm', ['build'], { cwd: pkgRoot })

console.log('[verify-consumer] inspect dist for path / workspace leaks')
for (const file of walkFiles(join(pkgRoot, 'dist'), ['.js', '.d.ts'])) {
  assertNoLeak(readFileSync(file, 'utf8'), file)
}

const packDir = mkdtempSync(join(tmpdir(), 'ol-style-pack-'))
console.log(`[verify-consumer] pnpm pack -> ${packDir}`)
run('pnpm', ['pack', '--pack-destination', packDir], { cwd: pkgRoot })
const tarballs = readdirSync(packDir).filter((name) => name.endsWith('.tgz'))
if (tarballs.length !== 1) {
  throw new Error(`Expected one tarball in ${packDir}, found: ${tarballs.join(', ') || '(none)'}`)
}
const tarballPath = join(packDir, tarballs[0])

const consumerDir = mkdtempSync(join(tmpdir(), 'ol-style-consumer-'))
if (consumerDir.startsWith(repoRoot)) {
  throw new Error(`Consumer dir must be outside workspace: ${consumerDir}`)
}
console.log(`[verify-consumer] consumer project -> ${consumerDir}`)

const consumerPkg = {
  name: 'ol-style-consumer-smoke',
  private: true,
  type: 'module',
  scripts: {
    typecheck: 'tsc -p tsconfig.json --noEmit',
    start: 'tsx src/demo.ts'
  },
  dependencies: {
    '@desktop-webgis/ol-style': `file:${tarballPath.replace(/\\/g, '/')}`,
    ol: peerOl
  },
  devDependencies: {
    tsx: '^4.20.0',
    typescript: '^5.9.2'
  }
}
writeFileSync(join(consumerDir, 'package.json'), `${JSON.stringify(consumerPkg, null, 2)}\n`)
writeFileSync(
  join(consumerDir, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: []
      },
      include: ['src/**/*.ts']
    },
    null,
    2
  )}\n`
)

const srcDir = join(consumerDir, 'src')
mkdirSync(srcDir, { recursive: true })
copyFileSync(
  join(pkgRoot, 'examples', 'symbology-smoke', 'demo.ts'),
  join(srcDir, 'demo.ts')
)

console.log('[verify-consumer] npm install (outside workspace)')
run('npm', ['install', '--no-fund', '--no-audit'], { cwd: consumerDir })

const lockOrPkg = readFileSync(join(consumerDir, 'package.json'), 'utf8')
assertNoLeak(lockOrPkg, 'consumer package.json')
if (existsSync(join(consumerDir, 'package-lock.json'))) {
  assertNoLeak(readFileSync(join(consumerDir, 'package-lock.json'), 'utf8'), 'consumer package-lock.json')
}

const installedPkgJson = join(
  consumerDir,
  'node_modules',
  '@desktop-webgis',
  'ol-style',
  'package.json'
)
if (!existsSync(installedPkgJson)) {
  throw new Error('Installed package missing @desktop-webgis/ol-style')
}
const installed = JSON.parse(readFileSync(installedPkgJson, 'utf8'))
if (installed.dependencies && Object.values(installed.dependencies).some((v) => String(v).includes('workspace:'))) {
  throw new Error('Installed package has workspace:* runtime dependencies')
}

console.log('[verify-consumer] typecheck')
run('npm', ['run', 'typecheck'], { cwd: consumerDir })

console.log('[verify-consumer] run example')
const start = run('npm', ['run', 'start'], { cwd: consumerDir })
const output = `${start.stdout || ''}${start.stderr || ''}`
console.log(output)
const jsonStart = output.indexOf('{')
const jsonEnd = output.lastIndexOf('}')
if (jsonStart < 0 || jsonEnd < jsonStart) {
  throw new Error('Example output did not contain JSON object')
}
const parsed = JSON.parse(output.slice(jsonStart, jsonEnd + 1))
if (!Array.isArray(parsed.categorizedLegendLabels) || parsed.categorizedLegendLabels.length < 2) {
  throw new Error('Example did not produce categorized legend labels')
}
if (parsed.equalBreakCount < 2 || parsed.quantileBreakCount < 2) {
  throw new Error('Example did not produce graduated legend items')
}

console.log('[verify-consumer] OK')
console.log(
  JSON.stringify(
    {
      tarball: tarballs[0],
      consumerDir,
      peerOl,
      example: parsed
    },
    null,
    2
  )
)

// Keep artifacts for local inspection; callers may delete. Do not touch repo scripts/.
rmSync(packDir, { recursive: true, force: true })
