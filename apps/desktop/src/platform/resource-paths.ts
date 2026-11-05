import { validateResourceReference, type ResourceReference } from '@desktop-webgis/cesium-scene-schema'

interface WindowsPath { root: string; parts: string[] }

function absolutePath(value: string): WindowsPath {
  let path = value.replace(/\\/g, '/')
  if (path.startsWith('//?/UNC/')) path = `//${path.slice(8)}`
  else if (path.startsWith('//?/')) path = path.slice(4)
  const drive = /^([a-z]):\//i.exec(path), unc = /^\/\/([^/]+)\/([^/]+)(?:\/|$)/.exec(path)
  const root = drive ? `${drive[1].toUpperCase()}:/` : unc ? `//${unc[1]}/${unc[2]}/` : null
  if (!root || /[\u0000-\u001f]/.test(path) || path.slice(drive ? 2 : 0).includes(':')) throw new Error('本地资源需要完整盘符路径或 UNC 路径')
  const parts: string[] = []
  for (const part of path.slice(drive ? 3 : unc![0].length).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { if (!parts.length) throw new Error('路径不能越过盘符或共享根目录'); parts.pop() }
    else parts.push(part)
  }
  return { root, parts }
}
function format(path: WindowsPath): string { return path.root + path.parts.join('/') }
function projectDirectory(path: string): WindowsPath {
  const result = absolutePath(path)
  if (!result.parts.length) throw new Error('项目路径需要文件名称')
  result.parts.pop(); return result
}

export function normalizeLocalResourcePath(path: string): string { return format(absolutePath(path)) }

export function localProjectDirectory(path: string): string { return format(projectDirectory(path)) }

/** 按路径分段比较，避免把名字只是前缀相同的兄弟目录也一并授权。 */
export function resourcePathWithinDirectory(path: string, directory: string): string | null {
  const file = absolutePath(path), root = absolutePath(directory)
  if (file.root.toLowerCase() !== root.root.toLowerCase() || file.parts.length <= root.parts.length ||
    !root.parts.every((part, index) => part === file.parts[index])) return null
  return file.parts.slice(root.parts.length).join('/')
}

/** 以项目文件为基准解析，绝不使用 document.baseURI。这不会授予文件系统访问权限。 */
export function resolveResourceReference(reference: ResourceReference, projectPath: string | null): ResourceReference {
  if (!validateResourceReference(reference)) throw new Error('资源引用无效')
  if (reference.kind === 'url') return { ...reference }
  if (reference.kind === 'absolute') return { kind: 'absolute', path: normalizeLocalResourcePath(reference.path) }
  if (!projectPath) throw new Error('相对资源需要项目文件路径；请先保存项目或选择本地文件')
  const base = projectDirectory(projectPath)
  return { kind: 'absolute', path: normalizeLocalResourcePath(format(base) + '/' + reference.path) }
}

/** 目标文件夹内优先使用相对路径；外部文件和跨盘文件仍然保持外部引用。 */
export function referenceForProjectFile(reference: ResourceReference, sourceProjectPath: string | null, targetProjectPath: string): ResourceReference {
  const resolved = resolveResourceReference(reference, sourceProjectPath)
  if (resolved.kind === 'url') return resolved
  if (resolved.kind !== 'absolute') throw new Error('资源路径未解析')
  const source = absolutePath(resolved.path), target = projectDirectory(targetProjectPath)
  // 文件夹名保持原样：Windows 共享目录和 WSL 目录可能区分大小写。
  if (source.root.toLowerCase() === target.root.toLowerCase() && source.parts.length > target.parts.length &&
    target.parts.every((part, index) => part === source.parts[index])) {
    return { kind: 'relative', path: source.parts.slice(target.parts.length).join('/') }
  }
  return resolved
}

export function rebaseResourceReference(reference: ResourceReference, sourceProjectPath: string, targetProjectPath: string): ResourceReference {
  return referenceForProjectFile(reference, sourceProjectPath, targetProjectPath)
}
