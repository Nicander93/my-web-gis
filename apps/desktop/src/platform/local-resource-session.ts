import { invoke, isTauri } from '@tauri-apps/api/core'
import type { ResourceReference } from '@desktop-webgis/cesium-scene-schema'
import { localProjectDirectory, normalizeLocalResourcePath, resolveResourceReference, resourcePathWithinDirectory } from './resource-paths'

interface DirectoryGrant { key: string; url: string; directory: string }
interface LocalResourceSessionOptions {
  projectPath: string | null | (() => string | null)
  native?: boolean
  grant?: (directory: string) => Promise<DirectoryGrant>
  revoke?: (key: string) => Promise<unknown>
}

/** Owns native directory leases for one mounted project; external roots need explicit authorization. */
export function createLocalResourceSession(options: LocalResourceSessionOptions) {
  const roots = new Set<string>()
  const readProjectPath = () => typeof options.projectPath === 'function' ? options.projectPath() : options.projectPath
  const grants = new Map<string, Promise<DirectoryGrant>>()
  const native = options.native ?? isTauri()
  const grant = options.grant ?? (directory => invoke<DirectoryGrant>('grant_local_resource_directory', { directory }))
  const revoke = options.revoke ?? (key => invoke('revoke_local_resource_directory', { key }))
  let destroyed = false
  return {
    /** Call only for a directory selected or otherwise explicitly authorized by the user. */
    authorizeDirectory(directory: string) {
      if (destroyed) throw new Error('资源会话已结束')
      roots.add(normalizeLocalResourcePath(directory))
    },
    async resolve(reference: ResourceReference, signal?: AbortSignal): Promise<string> {
      signal?.throwIfAborted()
      if (destroyed) throw new DOMException('资源会话已结束', 'AbortError')
      const projectPath = readProjectPath()
      if (projectPath) roots.add(localProjectDirectory(projectPath))
      const resolved = resolveResourceReference(reference, projectPath)
      if (resolved.kind === 'url') return resolved.url
      if (resolved.kind !== 'absolute' || !native) throw new Error('本地资源需要 Windows 桌面应用')
      const directory = [...roots].find(root => resourcePathWithinDirectory(resolved.path, root) !== null)
      if (!directory) throw new Error('资源位于项目目录之外，请选择并授权其所在目录')
      let pending = grants.get(directory)
      if (!pending) {
        pending = grant(directory)
        grants.set(directory, pending)
        void pending.catch(() => { if (grants.get(directory) === pending) grants.delete(directory) })
      }
      const lease = await pending
      signal?.throwIfAborted()
      if (destroyed) throw new DOMException('资源会话已结束', 'AbortError')
      const path = resourcePathWithinDirectory(resolved.path, directory)!
      return lease.url + path.split('/').map(encodeURIComponent).join('/')
    },
    /** Pending grants are revoked when they finish, even after the viewer has been disposed. */
    async destroy(): Promise<void> {
      if (destroyed) return
      destroyed = true
      const pending = [...grants.values()]; grants.clear(); roots.clear()
      await Promise.all(pending.map(async item => {
        let lease: DirectoryGrant
        try { lease = await item } catch { return }
        await revoke(lease.key)
      }))
    }
  }
}
