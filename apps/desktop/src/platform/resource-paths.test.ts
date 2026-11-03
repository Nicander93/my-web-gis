import { expect, it } from 'vitest'
import { normalizeLocalResourcePath, resolveResourceReference, rebaseResourceReference, referenceForProjectFile } from './resource-paths'

it('resolves against the chosen project directory and preserves filename characters without URL decoding', () => {
  expect(resolveResourceReference({ kind: 'relative', path: '模型/a%20 b#1.glb' }, 'D:\\projects\\map.webgis.json'))
    .toEqual({ kind: 'absolute', path: 'D:/projects/模型/a%20 b#1.glb' })
  expect(resolveResourceReference({ kind: 'relative', path: '../assets/model.glb' }, 'D:/projects/map.webgis.json'))
    .toEqual({ kind: 'absolute', path: 'D:/assets/model.glb' })
  expect(() => resolveResourceReference({ kind: 'relative', path: 'model.glb' }, null)).toThrow('项目文件路径')
  expect(() => resolveResourceReference({ kind: 'relative', path: '../../model.glb' }, 'D:/map.webgis.json')).toThrow('根目录')
})

it('recomputes save-as references across drives and keeps external resources referenced', () => {
  const reference = { kind: 'relative', path: 'models/tower.glb' } as const
  expect(rebaseResourceReference(reference, 'D:/project/map.webgis.json', 'D:/project/copy.webgis.json')).toEqual(reference)
  expect(rebaseResourceReference(reference, 'D:/project/map.webgis.json', 'E:/saved/copy.webgis.json'))
    .toEqual({ kind: 'absolute', path: 'D:/project/models/tower.glb' })
  expect(rebaseResourceReference(reference, 'D:/project/map.webgis.json', 'D:/project/sub/copy.webgis.json'))
    .toEqual({ kind: 'absolute', path: 'D:/project/models/tower.glb' })
  expect(referenceForProjectFile({ kind: 'absolute', path: 'E:/saved/models/tower.glb' }, null, 'E:/saved/copy.webgis.json'))
    .toEqual({ kind: 'relative', path: 'models/tower.glb' })
})

it('supports UNC and canonical Windows prefixes while avoiding false sibling/case matches', () => {
  expect(normalizeLocalResourcePath('\\\\?\\D:\\data\\a.glb')).toBe('D:/data/a.glb')
  expect(normalizeLocalResourcePath('\\\\?\\UNC\\server\\share\\a.glb')).toBe('//server/share/a.glb')
  expect(resolveResourceReference({ kind: 'relative', path: 'models/a.glb' }, '//server/share/project/map.webgis.json'))
    .toEqual({ kind: 'absolute', path: '//server/share/project/models/a.glb' })
  expect(referenceForProjectFile({ kind: 'absolute', path: 'D:/project-other/a.glb' }, null, 'D:/project/map.webgis.json').kind).toBe('absolute')
  expect(referenceForProjectFile({ kind: 'absolute', path: 'D:/Project/a.glb' }, null, 'D:/project/map.webgis.json').kind).toBe('absolute')
  const online = { kind: 'url', url: 'https://example.test/model.glb?revision=3' } as const
  expect(referenceForProjectFile(online, null, 'D:/project/map.webgis.json')).toEqual(online)
  expect(() => normalizeLocalResourcePath('D:model.glb')).toThrow()
  expect(() => normalizeLocalResourcePath('D:/model.glb:secret')).toThrow()
})
