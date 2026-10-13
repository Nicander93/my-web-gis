import { describe, expect, it } from 'vitest'
import { createCityScene, getCityNodeState, getCityDescendantIds, moveCityGroup, moveCityNodes, parseCityScene, removeCityGroup } from './index'
import type { CityScene, GraphicNode } from './index'

function scene(): CityScene {
  const city = createCityScene()
  city.groups = [{ id: 'g', name: '规划', visible: true }, { id: 'h', name: '道路', visible: true }]
  city.nodes = ['a','b','c'].map((id, index): GraphicNode => ({ id, name: id, type: 'graphic', visible: index !== 1, geometry: { type: 'point', heightMode: 'ground', positions: [[116 + index,39,0]] }, style: { color: '#336699', width: 3, pointSize: 10 }, properties: {} }))
  return city
}
describe('city groups contract', () => {
  it('retains nested folders through JSON and rejects cycles or missing parents before mutation', () => {
    const city = scene()
    city.groups![1].parentId = 'g'; city.nodes[0].groupId = 'h'
    city.groups![0].visible = false; city.groups![0].locked = true
    expect(parseCityScene(JSON.stringify(city))).toEqual(city)
    expect(getCityDescendantIds(city, 'g')).toEqual(['a'])
    expect(getCityNodeState(city, city.nodes[0])).toEqual({ visible: false, locked: true })
    expect(city.nodes[0].visible).toBe(true)
    city.groups![0].locked = false
    const before = structuredClone(city)
    expect(() => moveCityGroup(city, 'g', 'h')).toThrow('后代')
    expect(() => parseCityScene({ ...city, groups: [{ ...city.groups![0], parentId: 'h' }, city.groups![1]] })).toThrow('成环')
    expect(() => parseCityScene({ ...city, groups: [{ ...city.groups![0], parentId: 'missing' }, city.groups![1]] })).toThrow('不存在')
    expect(city).toEqual(before)
    const dissolved = removeCityGroup(city, 'g')
    expect(dissolved.groups![0]).toMatchObject({ id: 'h', visible: false })
    expect(dissolved.groups![0].parentId).toBeUndefined()
    expect(dissolved.nodes[0]).toMatchObject({ id: 'a', groupId: 'h', visible: true })
  })
  it('rejects duplicate/conflicting IDs, missing references and v1 group extensions', () => {
    const city = scene(); city.nodes[0].groupId = 'g'
    expect(parseCityScene(JSON.stringify(city))).toEqual(city)
    const invalid = structuredClone(city); invalid.nodes[0].groupId = 'missing'; expect(() => parseCityScene(invalid)).toThrow('分组引用')
    invalid.nodes[0].groupId = 'g'; invalid.groups![1].id = 'g'; expect(() => parseCityScene(invalid)).toThrow('重复')
    invalid.groups![1].id = 'a'; expect(() => parseCityScene(invalid)).toThrow('冲突')
    expect(() => parseCityScene({ ...city, version: 1 })).toThrow('version 2')
    expect(() => parseCityScene({ ...city, groups: {} })).toThrow('数组')
  })
  it('inherits group visibility/locking without overwriting child flags', () => {
    const city = scene(); city.nodes[0].groupId = city.nodes[1].groupId = 'g'
    city.groups![0].visible = false; city.groups![0].locked = true
    expect(getCityNodeState(city, city.nodes[0])).toEqual({ visible: false, locked: true })
    expect(city.nodes[0].visible).toBe(true); expect(city.nodes[0].locked).toBeUndefined()
    city.groups![0].visible = true; city.groups![0].locked = false; city.nodes[1].locked = true
    expect(getCityNodeState(city, city.nodes[0])).toEqual({ visible: true, locked: false })
    expect(getCityNodeState(city, city.nodes[1])).toEqual({ visible: false, locked: true })
  })
  it('moves and reorders multiple nodes atomically and rejects locked or invalid targets', () => {
    const city = scene(), before = structuredClone(city)
    const moved = moveCityNodes(city, ['a','b'], 'g')
    expect(city).toEqual(before); expect(moved.nodes.map(node => node.id)).toEqual(['c','a','b'])
    const reordered = moveCityNodes(moved, ['b'], 'g', 'a')
    expect(reordered.nodes.map(node => node.id)).toEqual(['c','b','a'])
    expect(moveCityNodes(reordered, ['a','b'], undefined).nodes.every(node => !node.groupId)).toBe(true)
    moved.groups![0].locked = true
    expect(() => moveCityNodes(moved, ['a','c'], 'h')).toThrow('锁定')
    expect(() => moveCityNodes(city, ['c'], 'missing')).toThrow('不存在')
    expect(() => moveCityNodes(city, ['c'], 'g', 'a')).toThrow('排序目标')
    expect(() => moveCityNodes(city, ['missing'])).toThrow('存在的对象')
    expect(city).toEqual(before)
  })
  it('dissolves a folder while preserving members and effective visibility', () => {
    const city = scene(); city.nodes[0].groupId = 'g'; city.groups![0].visible = false
    const result = removeCityGroup(city, 'g')
    expect(result.nodes).toHaveLength(3); expect(result.nodes[0].groupId).toBeUndefined(); expect(result.nodes[0].visible).toBe(false)
    expect(result.groups?.map(group => group.id)).toEqual(['h']); expect(city.groups).toHaveLength(2)
    city.groups![0].locked = true; expect(() => removeCityGroup(city, 'g')).toThrow('解锁')
  })
})
