import { describe, expect, it } from 'vitest'
import { createProject } from './project'
import { assertProjectSnapshotWorkspace, requireMapContent, requireSceneContent } from './project-content'

describe('exclusive runtime workspaces', () => {
  it('creates serializable scene content without any map collections or view placeholders', () => {
    const project = createProject('Scene', 'scene3d')
    expect(Object.keys(project.content).sort()).toEqual(['kind', 'scene', 'settings'])
    const before = JSON.stringify(project)
    expect(() => requireMapContent(project)).toThrow('不是二维')
    expect(JSON.stringify(project)).toBe(before)
    expect(requireSceneContent(project).scene.nodes).toEqual([])
  })
  it('does not create a scene as a side effect of querying a map project', () => {
    const project = createProject('Map')
    const before = JSON.stringify(project)
    expect(() => requireSceneContent(project)).toThrow('不是三维')
    expect(JSON.stringify(project)).toBe(before)
    expect(requireMapContent(project).layers).toEqual([])
    expect(project.content).not.toHaveProperty('scene')
  })
  it('rejects 2D data at the scene ownership boundary without discarding the caller data', () => {
    const snapshot = { project: createProject('Scene', 'scene3d'), featuresByDataset: {
      data: [{ id: 'f', geometry: { type: 'Point' as const, coordinates: [1, 2] as [number, number] }, properties: { value: 42 } }]
    } }
    const original = structuredClone(snapshot)
    expect(() => assertProjectSnapshotWorkspace(snapshot)).toThrow('不能包含二维要素')
    expect(snapshot).toEqual(original)
  })
})
