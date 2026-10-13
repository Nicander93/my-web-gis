import { describe, expect, it } from 'vitest'
import { constrainWindow, createDockLayout, parseDockLayout } from './docking-layout'

describe('local docking layout', () => {
  it('keeps a complete window accessible after resolution changes', () => {
    expect(constrainWindow({ x: 1700, y: 900, width: 800, height: 700 }, { width: 1024, height: 540 }))
      .toEqual({ x: 224, y: 0, width: 800, height: 540 })
    expect(constrainWindow({ x: -10, y: -20, width: 800, height: 700 }, { width: 160, height: 100 }))
      .toEqual({ x: 0, y: 0, width: 160, height: 100 })
  })

  it('recovers invalid values without accepting unknown windows or docking modes', () => {
    const parsed = parseDockLayout({ left: { dock: 'outside', bounds: { x: NaN, width: Infinity } }, injected: { dock: 'left' } })
    expect(parsed).toEqual(createDockLayout())
    expect(constrainWindow({ x: NaN, y: Infinity, width: NaN, height: -5 }, { width: 1366, height: 600 }))
      .toEqual({ x: 0, y: 0, width: 320, height: 140 })
  })

  it('round trips layout separately from project data and preserves all placements', () => {
    const layout = createDockLayout()
    layout.bottom = { dock: 'floating', bounds: { x: 50, y: 80, width: 900, height: 300 }, maximized: true }
    expect(parseDockLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
    layout.left.bounds.width = 999
    expect(createDockLayout().left.bounds.width).toBe(280)
  })
})
