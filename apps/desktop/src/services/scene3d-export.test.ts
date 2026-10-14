import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportScene } from './scene3d-export'
import { pickSaveFile, writeTextFile } from './files'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('./files', () => ({ pickSaveFile: vi.fn(), writeTextFile: vi.fn() }))

describe('desktop 3D scene export', () => {
  beforeEach(() => vi.resetAllMocks())

  it('writes the scene before reporting a saved file', async () => {
    vi.mocked(pickSaveFile).mockResolvedValue('D:/scenes/scene3d.scene.json')
    vi.mocked(writeTextFile).mockResolvedValue()
    expect(await exportScene('{"city":{}}', '城区')).toEqual({ kind: 'saved', path: 'D:/scenes/scene3d.scene.json' })
    expect(pickSaveFile).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '城区.scene.json' }))
    expect(writeTextFile).toHaveBeenCalledWith('D:/scenes/scene3d.scene.json', '{"city":{}}')
  })

  it('does not write when the save dialog is cancelled', async () => {
    vi.mocked(pickSaveFile).mockResolvedValue(null)
    expect(await exportScene('{}', '城区')).toEqual({ kind: 'cancelled' })
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('propagates write failures instead of reporting success', async () => {
    vi.mocked(pickSaveFile).mockResolvedValue('D:/scenes/scene3d.scene.json')
    vi.mocked(writeTextFile).mockRejectedValue(new Error('Disk full'))
    await expect(exportScene('{}', '城区')).rejects.toThrow('Disk full')
  })
})
