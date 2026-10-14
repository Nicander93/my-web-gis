import { expect, it, vi } from 'vitest'
import { createLocalResourceSession } from './local-resource-session'

it('reuses only authorized directory grants and encodes literal filenames without persisting URLs', async () => {
  const grant = vi.fn(async (directory: string) => ({ key: 'lease', url: 'http://webgis-resource.localhost/lease/', directory }))
  const revoke = vi.fn(async () => true)
  const session = createLocalResourceSession({ projectPath: 'D:/project/main.webgis.json', native: true, grant, revoke })
  expect(await session.resolve({ kind: 'relative', path: '模型/a #%.glb' })).toBe('http://webgis-resource.localhost/lease/%E6%A8%A1%E5%9E%8B/a%20%23%25.glb')
  await session.resolve({ kind: 'absolute', path: 'D:/project/models/b.glb' })
  expect(grant).toHaveBeenCalledTimes(1)
  await expect(session.resolve({ kind: 'absolute', path: 'D:/project-other/b.glb' })).rejects.toThrow('授权')
  session.authorizeDirectory('E:/external')
  await session.resolve({ kind: 'absolute', path: 'E:/external/tileset.json' })
  expect(grant).toHaveBeenCalledTimes(2)
  await session.destroy()
  expect(revoke).toHaveBeenCalledTimes(2)
  await expect(session.resolve({ kind: 'url', url: 'https://example.test/a.glb' })).rejects.toThrow('结束')
})

it('revokes a pending grant after disposal and never returns an obsolete authorization URL', async () => {
  let finish!: (value: { key: string; url: string; directory: string }) => void
  const pending = new Promise<{ key: string; url: string; directory: string }>(resolve => { finish = resolve })
  const revoke = vi.fn(async () => true)
  const session = createLocalResourceSession({ projectPath: 'D:/project/main.json', native: true, grant: () => pending, revoke })
  const loading = session.resolve({ kind: 'relative', path: 'model.glb' })
  const rejected = expect(loading).rejects.toThrow('结束')
  const cleanup = session.destroy()
  finish({ key: 'late', url: 'http://webgis-resource.localhost/late/', directory: 'D:/project' })
  await rejected; await cleanup
  expect(revoke).toHaveBeenCalledWith('late')
})

it('observes the first save path in an existing session and retains explicitly authorized old resources after Save As', async () => {
  let projectPath: string | null = null
  const grant = vi.fn(async (directory: string) => ({ key: directory, url: 'http://webgis-resource.localhost/key/', directory }))
  const session = createLocalResourceSession({ projectPath: () => projectPath, native: true, grant, revoke: async () => true })
  await expect(session.resolve({ kind: 'relative', path: 'model.glb' })).rejects.toThrow('项目文件路径')
  projectPath = 'D:/project/main.json'
  await session.resolve({ kind: 'relative', path: 'model.glb' })
  projectPath = 'E:/copy/main.json'
  await session.resolve({ kind: 'absolute', path: 'D:/project/model.glb' })
  expect(grant).toHaveBeenCalledTimes(1)
  await session.destroy()
})
