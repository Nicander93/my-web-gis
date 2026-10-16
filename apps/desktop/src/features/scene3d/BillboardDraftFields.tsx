import { useEffect, useRef, useState } from 'react'
import { Button, Input, InputNumber, Switch, Upload } from 'antd'
import { createBillboardStyle } from '@desktop-webgis/cesium-scene-schema'
import type { BillboardStyle } from '@desktop-webgis/cesium-scene-schema'

interface Props { value?: BillboardStyle; onChange(value?: BillboardStyle): void }

/** Shared draft controls; image bytes travel with the graphic when saving or exporting. */
export function BillboardDraftFields({ value, onChange }: Props) {
  const [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const generation = useRef(0), latest = useRef({ value, onChange })
  latest.current = { value, onChange }
  useEffect(() => () => { generation.current++ }, [])
  async function load(file: File): Promise<void> {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 2_000_000) { setError('请选择不超过 2 MB 的 PNG、JPEG、WebP 或 GIF 图片。'); return }
    const request = ++generation.current, base = JSON.stringify(value)
    setLoading(true); setError('')
    try {
      const decoded = await createImageBitmap(file).catch(() => { throw new Error('图片无法解码，请选择有效图片。') })
      decoded.close()
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('图片读取失败'))
        reader.readAsDataURL(file)
      })
      if (request !== generation.current) return
      if (base !== JSON.stringify(latest.current.value)) throw new Error('图标配置已变化，请重新选择图片。')
      latest.current.onChange({ ...(latest.current.value ?? createBillboardStyle()), image })
    } catch (reason) { if (request === generation.current) setError(reason instanceof Error ? reason.message : '图片读取失败') }
    finally { if (request === generation.current) setLoading(false) }
  }
  return <section className="scene3d-property-section">
    <label className="editor-field">图标<Switch aria-label="启用 Billboard 图标" checked={Boolean(value)} disabled={loading} onChange={enabled => onChange(enabled ? createBillboardStyle() : undefined)} /></label>
    {value && <>
      <label className="editor-field">图片地址<Input aria-label="Billboard 图片地址" value={value.image.startsWith('data:') ? '' : value.image} placeholder={value.image.startsWith('data:') ? '使用内嵌图片；输入网络地址可替换' : 'HTTPS 图片地址'} disabled={loading} onChange={event => onChange({ ...value, image: event.target.value })} /></label>
      <Upload accept="image/png,image/jpeg,image/webp,image/gif" showUploadList={false} disabled={loading} beforeUpload={file => { void load(file); return false }}><Button loading={loading}>选择图标图片</Button></Upload>
      <Button disabled={loading} onClick={() => onChange({ ...value, image: createBillboardStyle().image })}>恢复默认图标</Button>
      {(['width', 'height'] as const).map(key => <label className="editor-field" key={key}>{key === 'width' ? '图标宽度（px）' : '图标高度（px）'}<InputNumber aria-label={key === 'width' ? '图标宽度' : '图标高度'} min={1} max={512} value={value[key]} disabled={loading} onChange={number => { if (number !== null) onChange({ ...value, [key]: number }) }} /></label>)}
      <p className="editor-help">图标底部锚定位置，可与标注同时显示。选择的图片嵌入项目；网络图片需支持跨域访问。</p>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>
}
