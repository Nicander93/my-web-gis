import { afterEach, expect, it } from 'vitest'
import { beginStyleInteraction, finishStyleInteraction } from './style-interaction'
import { resolveSceneDrafts } from './scene-draft-guard'

afterEach(() => finishStyleInteraction())

it('keeps only a gesture identity and ends coalescing when a scene target changes', async () => {
  const first = beginStyleInteraction('roads', 'width')
  expect(beginStyleInteraction('roads', 'width')).toBe(first)
  expect(beginStyleInteraction('roads', 'color')).not.toBe(first)
  const next = beginStyleInteraction('roads', 'width')
  finishStyleInteraction('other')
  expect(beginStyleInteraction('roads', 'width')).toBe(next)
  expect(await resolveSceneDrafts()).toBe(true)
  expect(beginStyleInteraction('roads', 'width')).not.toBe(next)
})
