import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const roots = process.argv.slice(2)
if (!roots.length) throw new Error('用法：node scripts/translate-comments.mjs <目录...>')

const table = {
  '(TLS verified; no public proxy).': '（会校验 TLS，不经过公共代理）。',
  '(set by run-live-keychain-reverify.mjs after cargo build)':
    '（由 run-live-keychain-reverify.mjs 在 cargo build 之后设置）',
  '(`desktop-webgis` / Windows Credential Manager), then **exits completely**.':
    '（`desktop-webgis` 或 Windows 凭据管理器），然后**彻底退出进程**。',
  '--- Phase 1: separate Node writer process persists then exits ---':
    '--- 阶段 1：独立的 Node 写入进程完成持久化后退出 ---',
  '--- Phase 2: fresh vitest process hydrates via credentials.ts ---':
    '--- 阶段 2：新的 vitest 进程通过 credentials.ts 补全凭据 ---',
  'Fail loudly when a scene uses capabilities this codegen/runtime path cannot preserve.':
    '场景用到了这条代码生成或运行时路径无法保留的能力时，直接报错。',
  'Never silently omit WMS/WMTS/filters/styles.':
    '绝不静默忽略 WMS、WMTS、过滤和样式。',
  'Generates an ESM module backed by the public OpenLayers Scene Runtime.':
    '生成一个由公开的 OpenLayers 场景运行时支撑的 ESM 模块。',
  'Native bridge URLs are session scoped. Preserve portable references and resolve them in the host.':
    '原生桥接 URL 只在会话内有效。保留可移植的引用，由宿主来解析。',
  'Collect explicit tileset/glTF dependencies before writing any publication files.':
    '写入任何发布文件之前，先收集明确的 Tileset 和 glTF 依赖。',
  'Builds a static scene without deleting or overwriting an existing artifact.':
    '构建静态场景，不删除也不覆盖已有的产物。',
  'Maps relative URLs used by the scene to absolute or workspace-local source files.':
    '把场景里用到的相对 URL 映射到绝对路径或工作区内的源文件。',
  'Optional runtime secrets. Only written when the caller explicitly supplies them.':
    '可选的运行时密钥，只在调用方显式提供时才写入。',
  'Optional deployment root used to record the final public Viewer URL.':
    '可选的部署根地址，用来记录最终公开的 Viewer URL。',
}

const leftovers = []

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (['node_modules', 'dist', 'target', 'test-results'].includes(name)) continue
      walk(full, acc)
    } else if (['.ts', '.tsx'].includes(extname(name))) acc.push(full)
  }
  return acc
}

let changed = 0
for (const root of roots) {
  for (const file of walk(root)) {
    const before = readFileSync(file, 'utf8')
    let after = before
    for (const [from, to] of Object.entries(table)) after = after.split(from).join(to)
    if (after !== before) {
      writeFileSync(file, after, 'utf8')
      changed++
    }
    for (const line of after.split('\n')) {
      const trimmed = line.trim()
      if (!/^(\/\/|\*|\/\*\*)/.test(trimmed)) continue
      const text = trimmed.replace(/^(\/\/+|\*+|\/\*\*+)\s*/, '').replace(/\*\/$/, '').trim()
      if (!text || !/[A-Za-z]{3}/.test(text)) continue
      if (/^[\x00-\x7F\s]*$/.test(text)) leftovers.push(`${file}: ${text}`)
    }
  }
}

console.log(`更新文件 ${changed} 个`)
console.log(`剩余英文注释 ${leftovers.length} 条`)
writeFileSync('.artifacts-english-comments.txt', leftovers.join('\n'), 'utf8')
