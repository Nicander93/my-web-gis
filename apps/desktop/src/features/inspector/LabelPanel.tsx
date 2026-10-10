import { useMemo } from 'react'
import { Button } from '@/components/ui/Button'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { layerCommands } from '@/app/commands/layer.commands'
import type { LabelConfig } from '@desktop-webgis/ol-style'
import { rgb } from '@desktop-webgis/ol-style'
import {
  colorToHex,
  listAttributeFields,
  parseHexColor,
  withLabel
} from './style-draft'

interface LabelPanelProps {
  layerId: string
}

function defaultLabel(field = ''): LabelConfig {
  return {
    field,
    fontSize: 12,
    color: rgb(0, 0, 0),
    strokeColor: rgb(255, 255, 255),
    strokeWidth: 2
  }
}

export function LabelPanel({ layerId }: LabelPanelProps) {
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  const getNormalizedLayerStyle = useProjectStore(
    (state) => state.getNormalizedLayerStyle
  )
  const patchStyleDraft = useSessionStore((state) => state.patchStyleDraft)
  const sessionDraft = useSessionStore(
    (state) => state.sessions[layerId]?.styleDraft
  )

  const layer = project.layers.find((item) => item.id === layerId) ?? null
  const applied = getNormalizedLayerStyle(layerId)
  const features = layer ? (featuresByDataset[layer.datasetId] ?? []) : []
  const fields = useMemo(() => listAttributeFields(features), [features])

  if (!layer || !applied) {
    return <div className="empty-state empty-state-box">请选择一个图层</div>
  }

  if (!sessionDraft) {
    return <div className="empty-state empty-state-box">正在准备标注草稿…</div>
  }

  const draft = sessionDraft
  const label = draft.style.label ?? defaultLabel(fields[0] ?? '')
  const enabled = Boolean(draft.style.label?.field)

  function patchLabel(partial: Partial<LabelConfig> | null) {
    if (partial === null) {
      patchStyleDraft(layerId, {
        style: withLabel(draft.style, undefined),
        dirty: true
      })
      return
    }
    const nextLabel: LabelConfig = { ...label, ...partial }
    patchStyleDraft(layerId, {
      style: withLabel(draft.style, nextLabel),
      dirty: true
    })
  }

  return (
    <div className="inspector-card label-panel">
      <div className="card-title-row">
        <div className="card-title">标注</div>
        {draft.dirty ? <span className="draft-badge">草稿未应用</span> : null}
      </div>

      <label className="style-field style-field-checkbox">
        <span>启用标注</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            if (event.target.checked) {
              patchLabel(defaultLabel(fields[0] ?? 'name'))
            } else {
              patchLabel(null)
            }
          }}
        />
      </label>

      <label className="style-field">
        <span>字段</span>
        <select
          disabled={!enabled}
          value={label.field}
          onChange={(event) => patchLabel({ field: event.target.value })}
        >
          <option value="">选择字段</option>
          {fields.map((field) => (
            <option key={field} value={field}>
              {field}
            </option>
          ))}
        </select>
      </label>

      <label className="style-field">
        <span>字号</span>
        <input
          type="number"
          min={8}
          max={72}
          disabled={!enabled}
          value={label.fontSize ?? 12}
          onChange={(event) =>
            patchLabel({
              fontSize: Math.max(8, Number(event.target.value) || 12)
            })
          }
        />
      </label>

      <label className="style-field">
        <span>颜色</span>
        <input
          type="color"
          disabled={!enabled}
          value={colorToHex(label.color ?? rgb(0, 0, 0))}
          onChange={(event) =>
            patchLabel({ color: parseHexColor(event.target.value) })
          }
        />
      </label>

      <label className="style-field">
        <span>描边颜色</span>
        <input
          type="color"
          disabled={!enabled}
          value={colorToHex(label.strokeColor ?? rgb(255, 255, 255))}
          onChange={(event) =>
            patchLabel({ strokeColor: parseHexColor(event.target.value) })
          }
        />
      </label>

      <label className="style-field">
        <span>描边宽度</span>
        <input
          type="number"
          min={0}
          max={8}
          step={0.5}
          disabled={!enabled}
          value={label.strokeWidth ?? 2}
          onChange={(event) =>
            patchLabel({
              strokeWidth: Math.max(0, Number(event.target.value) || 0)
            })
          }
        />
      </label>

      <details className="property-section">
        <summary>缩放范围</summary>
        <label className="style-field">
          <span>最小缩放</span>
          <input
            type="number"
            min={0}
            max={24}
            disabled={!enabled}
            value={label.minZoom ?? ''}
            placeholder="不限"
            onChange={(event) => {
              const raw = event.target.value
              patchLabel({ minZoom: raw === '' ? undefined : Number(raw) })
            }}
          />
        </label>

        <label className="style-field">
          <span>最大缩放</span>
          <input
            type="number"
            min={0}
            max={24}
            disabled={!enabled}
            value={label.maxZoom ?? ''}
            placeholder="不限"
            onChange={(event) => {
              const raw = event.target.value
              patchLabel({ maxZoom: raw === '' ? undefined : Number(raw) })
            }}
          />
        </label>
      </details>
      <div className="style-actions">
        <Button
          type="button"
          variant="ghost"
          onClick={() => layerCommands.resetStyleDraft(layerId)}
        >
          重置草稿
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => layerCommands.applyStyle(layerId, draft.style)}
        >
          应用
        </Button>
      </div>
    </div>
  )
}
