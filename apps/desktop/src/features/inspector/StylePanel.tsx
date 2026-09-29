import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { layerCommands } from '@/app/commands/layer.commands'
import type { LayerStyle } from '@desktop-webgis/ol-style'
import { colorToString, symbolPrimaryColor } from '@desktop-webgis/ol-style'
import {
  COLOR_RAMP_OPTIONS,
  colorToHex,
  listAttributeFields,
  listNumericFields,
  reclassifyStyle,
  switchStyleMode,
  updateBreakColor,
  updateCategoryColor,
  updateFallbackColor
} from './style-draft'

interface StylePanelProps {
  layerId: string
}

export function StylePanel({ layerId }: StylePanelProps) {
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  const getNormalizedLayerStyle = useProjectStore((state) => state.getNormalizedLayerStyle)
  const patchStyleDraft = useSessionStore((state) => state.patchStyleDraft)
  const sessionDraft = useSessionStore((state) => state.sessions[layerId]?.styleDraft)
  const [message, setMessage] = useState<string | null>(null)

  const layer = project.layers.find((item) => item.id === layerId) ?? null
  const applied = getNormalizedLayerStyle(layerId)
  const features = layer ? featuresByDataset[layer.datasetId] ?? [] : []
  const fields = useMemo(() => listAttributeFields(features), [features])
  const numericFields = useMemo(() => listNumericFields(features), [features])

  if (!layer || !applied) {
    return <div className="empty-state empty-state-box">请选择一个图层</div>
  }

  if (!sessionDraft) {
    return <div className="empty-state empty-state-box">正在准备样式草稿…</div>
  }

  const draft = sessionDraft
  const style = draft.style

  function updateStyle(next: LayerStyle) {
    patchStyleDraft(layerId, {
      style: next,
      dirty: true
    })
    setMessage(null)
  }

  function handleReclassify() {
    const result = reclassifyStyle(style, features, {
      classCount: draft.classCount,
      colorRampId: draft.colorRampId
    })
    if (result.error) {
      setMessage(result.error)
      return
    }
    updateStyle(result.style)
    setMessage('已重新分类（尚未应用）')
  }

  const fallbackColor =
    style.mode === 'single'
      ? colorToHex(symbolPrimaryColor(style.symbol))
      : colorToHex(symbolPrimaryColor(style.fallback))

  return (
    <div className="inspector-card style-panel">
      <div className="card-title-row">
        <div className="card-title">样式</div>
        {draft.dirty ? <span className="draft-badge">草稿未应用</span> : null}
      </div>

      <label className="style-field">
        <span>模式</span>
        <select
          value={style.mode}
          onChange={(event) => updateStyle(switchStyleMode(style, event.target.value as LayerStyle['mode']))}
        >
          <option value="single">单一符号</option>
          <option value="categorized">分类</option>
          <option value="graduated">分级</option>
        </select>
      </label>

      {style.mode !== 'single' ? (
        <label className="style-field">
          <span>字段</span>
          <select
            value={style.field}
            onChange={(event) =>
              updateStyle({
                ...style,
                field: event.target.value
              })
            }
          >
            <option value="">选择字段</option>
            {(style.mode === 'graduated' ? numericFields : fields).map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {style.mode === 'graduated' ? (
        <>
          <label className="style-field">
            <span>分类方法</span>
            <select
              value={style.method === 'manual' ? 'equal-interval' : style.method}
              onChange={(event) =>
                updateStyle({
                  ...style,
                  method: event.target.value as 'equal-interval' | 'quantile'
                })
              }
            >
              <option value="equal-interval">等间距</option>
              <option value="quantile">分位数</option>
            </select>
          </label>
          <label className="style-field">
            <span>分段数</span>
            <input
              type="number"
              min={1}
              max={32}
              value={draft.classCount}
              onChange={(event) =>
                patchStyleDraft(layerId, {
                  classCount: Math.max(1, Number(event.target.value) || 1),
                  dirty: true
                })
              }
            />
          </label>
        </>
      ) : null}

      {style.mode !== 'single' ? (
        <label className="style-field">
          <span>色带</span>
          <select
            value={draft.colorRampId}
            onChange={(event) =>
              patchStyleDraft(layerId, {
                colorRampId: event.target.value,
                dirty: true
              })
            }
          >
            {COLOR_RAMP_OPTIONS.map((ramp) => (
              <option key={ramp.id} value={ramp.id}>
                {ramp.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {style.mode !== 'single' ? (
        <div className="style-actions-inline">
          <Button type="button" onClick={handleReclassify}>
            重新分类
          </Button>
          <span className="style-hint">属性编辑沿用现有断点，不自动重算</span>
        </div>
      ) : null}

      {style.mode === 'categorized' ? (
        <div className="style-list">
          <div className="style-list-title">分类项</div>
          {style.categories.length === 0 ? (
            <p className="style-hint">尚无分类项，请选择字段后点击「重新分类」</p>
          ) : (
            style.categories.map((category, index) => (
              <div key={`${String(category.value)}-${index}`} className="style-list-row">
                <span
                  className="swatch"
                  style={{ background: colorToString(symbolPrimaryColor(category.symbol)) }}
                />
                <input
                  type="color"
                  value={colorToHex(symbolPrimaryColor(category.symbol))}
                  onChange={(event) => updateStyle(updateCategoryColor(style, index, event.target.value))}
                  aria-label={`分类 ${String(category.value)} 颜色`}
                />
                <input
                  className="style-list-label"
                  value={category.label ?? String(category.value)}
                  onChange={(event) => {
                    const next = {
                      ...style,
                      categories: style.categories.map((item, i) =>
                        i === index ? { ...item, label: event.target.value } : item
                      )
                    }
                    updateStyle(next)
                  }}
                />
              </div>
            ))
          )}
        </div>
      ) : null}

      {style.mode === 'graduated' ? (
        <div className="style-list">
          <div className="style-list-title">断点</div>
          {style.breaks.length === 0 ? (
            <p className="style-hint">尚无断点，请选择字段后点击「重新分类」</p>
          ) : (
            style.breaks.map((breakItem, index) => (
              <div key={`${breakItem.value}-${index}`} className="style-list-row">
                <span
                  className="swatch"
                  style={{ background: colorToString(symbolPrimaryColor(breakItem.symbol)) }}
                />
                <input
                  type="color"
                  value={colorToHex(symbolPrimaryColor(breakItem.symbol))}
                  onChange={(event) => updateStyle(updateBreakColor(style, index, event.target.value))}
                  aria-label={`断点 ${breakItem.value} 颜色`}
                />
                <span className="style-break-value">≤ {breakItem.value}</span>
                <input
                  className="style-list-label"
                  value={breakItem.label ?? ''}
                  placeholder="标签"
                  onChange={(event) => {
                    const next = {
                      ...style,
                      breaks: style.breaks.map((item, i) =>
                        i === index ? { ...item, label: event.target.value || undefined } : item
                      )
                    }
                    updateStyle(next)
                  }}
                />
              </div>
            ))
          )}
        </div>
      ) : null}

      <label className="style-field">
        <span>{style.mode === 'single' ? '符号颜色' : 'Fallback'}</span>
        <div className="style-color-row">
          <span className="swatch" style={{ background: fallbackColor }} />
          <input
            type="color"
            value={fallbackColor}
            onChange={(event) => updateStyle(updateFallbackColor(style, event.target.value))}
            aria-label={style.mode === 'single' ? '符号颜色' : 'Fallback 颜色'}
          />
        </div>
      </label>

      {message ? <p className="style-message">{message}</p> : null}

      <div className="style-actions">
        <Button type="button" variant="ghost" onClick={() => layerCommands.resetStyleDraft(layerId)}>
          重置草稿
        </Button>
        <Button type="button" variant="primary" onClick={() => layerCommands.applyStyle(layerId, style)}>
          应用
        </Button>
      </div>
    </div>
  )
}
