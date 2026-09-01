#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseScene } from '@desktop-webgis/scene-schema'
import { buildStaticScene } from './publisher.js'

interface CliOptions {
  scene?: string
  viewer?: string
  out?: string
  resources?: string
  runtimeConfig?: string
  publicUrl?: string
  help: boolean
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(helpText)
    return
  }
  if (!options.scene || !options.viewer || !options.out) {
    throw new Error('必须提供 --scene、--viewer 和 --out。使用 --help 查看示例。')
  }

  const scenePath = path.resolve(options.scene)
  const scene = parseScene(JSON.parse(await readFile(scenePath, 'utf8')))
  const resources = options.resources
    ? await readJsonRecord(path.resolve(options.resources), '资源映射')
    : undefined
  const runtimeConfig = options.runtimeConfig
    ? await readJsonObject(path.resolve(options.runtimeConfig), '运行时配置')
    : undefined
  const credentials = runtimeConfig?.credentials
  if (
    credentials !== undefined &&
    (!credentials ||
      typeof credentials !== 'object' ||
      Array.isArray(credentials) ||
      !Object.values(credentials).every((value) => typeof value === 'string'))
  ) {
    throw new Error('运行时配置 credentials 必须是字符串字典。')
  }

  const result = await buildStaticScene({
    scene,
    viewerDirectory: path.resolve(options.viewer),
    outputDirectory: path.resolve(options.out),
    resources,
    runtimeCredentials: credentials as Record<string, string> | undefined,
    publicBaseUrl: options.publicUrl
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

function parseArguments(args: string[]): CliOptions {
  const options: CliOptions = { help: false }
  const fields: Record<string, keyof Omit<CliOptions, 'help'>> = {
    '--scene': 'scene',
    '--viewer': 'viewer',
    '--out': 'out',
    '--resources': 'resources',
    '--runtime-config': 'runtimeConfig',
    '--public-url': 'publicUrl'
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }
    const field = argument ? fields[argument] : undefined
    if (!field) throw new Error(`未知参数：${argument ?? ''}`)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${argument} 缺少值`)
    options[field] = value
    index += 1
  }
  return options
}

async function readJsonObject(filePath: string, label: string): Promise<Record<string, unknown>> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 JSON 对象：${filePath}`)
  }
  return parsed as Record<string, unknown>
}

async function readJsonRecord(filePath: string, label: string): Promise<Record<string, string>> {
  const parsed = await readJsonObject(filePath, label)
  if (!Object.values(parsed).every((value) => typeof value === 'string')) {
    throw new Error(`${label}的所有值必须是路径字符串：${filePath}`)
  }
  return parsed as Record<string, string>
}

const helpText = `scene-publish — 构建可部署的二维 GIS 静态 Viewer

用法：
  scene-publish --scene report.scene.json --viewer apps/viewer/dist --out publish/report
    [--resources resources.json] [--runtime-config runtime-config.json]
    [--public-url https://maps.example.com/report/]

说明：
  --resources       Scene 相对资源 URL 到本地源文件的 JSON 映射
  --runtime-config  { "credentials": { "credential-id": "secret" } }
  --public-url      部署根地址，仅写入 publish-manifest.json，不执行上传
`

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
