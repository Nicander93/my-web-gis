import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  GripVertical,
  Layers3,
  Loader2,
  MoreHorizontal,
  Search
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import {
  flattenLayerIds,
  isLegacyStyle,
  migrateLegacyStyle,
  normalizeLayerTree,
  type Layer,
  type LayerGroup,
  type LayerTreeEntry
} from '@desktop-webgis/gis-core'
import { colorToString, symbolPrimaryColor, type LayerStyle, type Symbol } from '@desktop-webgis/ol-style'
import { LayerContextMenu } from './LayerContextMenu'
import { layerCommands } from '@/app/commands/layer.commands'

function previewFromSymbol(symbol: Symbol): { kind: 'point' | 'line' | 'polygon'; color: string } {
  const color = colorToString(symbolPrimaryColor(symbol))
  if (symbol.type === 'circle') return { kind: 'point', color }
  if (symbol.type === 'solid' && 'width' in symbol && !('fill' in symbol)) return { kind: 'line', color }
  if (symbol.type === 'mixed') {
    if (symbol.polygon) return { kind: 'polygon', color }
    if (symbol.line) return { kind: 'line', color }
    return { kind: 'point', color }
  }
  return { kind: 'polygon', color }
}

function getPreviewSymbol(style: LayerStyle | { kind: string }): { kind: 'point' | 'line' | 'polygon'; color: string } {
  if (isLegacyStyle(style as never)) {
    const legacy = style as { kind: string; fill: string; stroke: string }
    if (legacy.kind === 'polygon') return { kind: 'polygon', color: legacy.fill }
    if (legacy.kind === 'line') return { kind: 'line', color: legacy.stroke }
    return { kind: 'point', color: legacy.fill }
  }

  const normalized = style as LayerStyle
  if (normalized.mode === 'single') {
    return previewFromSymbol(normalized.symbol)
  }
  if (normalized.mode === 'categorized') {
    return previewFromSymbol(normalized.categories[0]?.symbol ?? normalized.fallback)
  }
  return previewFromSymbol(normalized.breaks[0]?.symbol ?? normalized.fallback)
}

interface MenuState {
  layerId: string
  x: number
  y: number
}

export function LayerPanel() {
  const [query, setQuery] = useState('')
  const project = useProjectStore((state) => state.project)
  const selectedLayerId = useProjectStore((state) => state.selectedLayerId)
  const selection = useProjectStore((state) => state.selection)
  const setSelectedLayer = useProjectStore((state) => state.setSelectedLayer)
  const setLayerVisible = useProjectStore((state) => state.setLayerVisible)
  const setGroupVisible = useProjectStore((state) => state.setGroupVisible)
  const renameLayer = useProjectStore((state) => state.renameLayer)
  const createGroup = useProjectStore((state) => state.createGroup)
  const removeGroup = useProjectStore((state) => state.removeGroup)
  const relocateLayer = useProjectStore((state) => state.relocateLayer)
  const moveRootEntry = useProjectStore((state) => state.moveRootEntry)
  const sessions = useSessionStore((state) => state.sessions)

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [dragLayerId, setDragLayerId] = useState<string | null>(null)

  const tree = useMemo(() => normalizeLayerTree(project), [project])
  const rootOrder = tree.rootOrder
  const groups = tree.groups
  const layerById = useMemo(
    () => new Map(tree.layers.map((layer) => [layer.id, layer])),
    [tree.layers]
  )
  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups]
  )

  const q = query.trim()

  function openMenuFor(layerId: string, clientX: number, clientY: number): void {
    setSelectedLayer(layerId)
    setMenu({ layerId, x: clientX, y: clientY })
  }

  function beginRename(layerId: string): void {
    const layer = layerById.get(layerId)
    if (!layer) return
    setRenamingId(layerId)
    setRenameValue(layer.name)
  }

  function commitRename(): void {
    if (renamingId) {
      renameLayer(renamingId, renameValue)
    }
    setRenamingId(null)
  }

  function handleRemoveGroup(group: LayerGroup): void {
    const keepChildren = window.confirm(
      `删除组「${group.name}」？

确定：保留子图层（移到顶层）
取消：再确认是否连同子图层一起移除`
    )
    if (keepChildren) {
      removeGroup(group.id, false)
      return
    }
    const removeTogether = window.confirm(
      `将组「${group.name}」与其 ${group.layerIds.length} 个子图层一起移除？此操作不可从该对话框撤销。`
    )
    if (removeTogether) {
      removeGroup(group.id, true)
    }
  }

  function onDropLayer(target: { kind: 'root'; index: number } | { kind: 'group'; groupId: string; index: number }): void {
    if (!dragLayerId) return
    relocateLayer(dragLayerId, target)
    setDragLayerId(null)
  }

  function matchesQuery(layer: Layer): boolean {
    if (!q) return true
    return layer.name.includes(q)
  }

  function renderLayerRow(layer: Layer, options?: { indent?: boolean; groupId?: string; indexInGroup?: number }): ReactNode {
    if (!matchesQuery(layer)) return null
    const isActive = selectedLayerId === layer.id
    const isLoading = Boolean(sessions[layer.id]?.loading)
    const selectedCount =
      selection.layerId === layer.id ? selection.featureIds.length : 0
    const style = isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : layer.style
    const preview = getPreviewSymbol(style)
    const indent = options?.indent ? ' is-child' : ''

    return (
      <div
        key={layer.id}
        className={`layer-item${isActive ? ' is-active' : ''}${isLoading ? ' is-loading' : ''}${indent}`}
        draggable
        onDragStart={() => setDragLayerId(layer.id)}
        onDragEnd={() => setDragLayerId(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          if (options?.groupId != null && options.indexInGroup != null) {
            onDropLayer({ kind: 'group', groupId: options.groupId, index: options.indexInGroup })
          } else {
            const rootIndex = rootOrder.findIndex(
              (entry) => entry.type === 'layer' && entry.id === layer.id
            )
            onDropLayer({ kind: 'root', index: Math.max(rootIndex, 0) })
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          openMenuFor(layer.id, event.clientX, event.clientY)
        }}
      >
        <GripVertical className="drag-icon" size={13} />
        <Button
          variant="icon"
          className="visibility-button"
          title={layer.visible ? '隐藏图层' : '显示图层'}
          aria-label={layer.visible ? `隐藏${layer.name}` : `显示${layer.name}`}
          onClick={() => setLayerVisible(layer.id, !layer.visible)}
        >
          {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </Button>
        {renamingId === layer.id ? (
          <input
            className="layer-rename-input"
            value={renameValue}
            autoFocus
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') setRenamingId(null)
            }}
          />
        ) : (
          <button
            className="layer-name-button"
            type="button"
            onClick={() => setSelectedLayer(layer.id)}
            onDoubleClick={() => beginRename(layer.id)}
          >
            <span
              className={`layer-symbol layer-symbol-${preview.kind}`}
              style={
                preview.kind === 'polygon'
                  ? { background: preview.color, borderColor: preview.color }
                  : { background: preview.color }
              }
            />
            <span>{layer.name}</span>
            {isLoading ? <Loader2 className="layer-loading-icon" size={12} /> : null}
            {selectedCount > 0 ? (
              <span className="layer-selection-count" title="选中要素数">
                {selectedCount}
              </span>
            ) : null}
          </button>
        )}
        <Button
          variant="icon"
          className="layer-more-button"
          title="更多"
          aria-label={`更多操作 ${layer.name}`}
          onClick={(event) => {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
            openMenuFor(layer.id, rect.left, rect.bottom + 4)
          }}
        >
          <MoreHorizontal size={14} />
        </Button>
      </div>
    )
  }

  function renderRootEntry(entry: LayerTreeEntry, _rootIndex: number): ReactNode {
    if (entry.type === 'layer') {
      const layer = layerById.get(entry.id)
      if (!layer) return null
      return renderLayerRow(layer)
    }

    const group = groupById.get(entry.id)
    if (!group) return null
    const collapsed = collapsedGroups[group.id]
    const childLayers = group.layerIds
      .map((id) => layerById.get(id))
      .filter((layer): layer is Layer => layer != null && matchesQuery(layer))

    if (q && childLayers.length === 0) return null

    return (
      <div key={group.id} className="layer-group">
        <div
          className="layer-group-header"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            onDropLayer({ kind: 'group', groupId: group.id, index: group.layerIds.length })
          }}
        >
          <Button
            variant="icon"
            title={collapsed ? '展开' : '折叠'}
            aria-label={collapsed ? '展开组' : '折叠组'}
            onClick={() =>
              setCollapsedGroups((state) => ({ ...state, [group.id]: !collapsed }))
            }
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </Button>
          <Button
            variant="icon"
            className="visibility-button"
            title={group.visible ? '隐藏组' : '显示组'}
            aria-label={group.visible ? `隐藏组${group.name}` : `显示组${group.name}`}
            onClick={() => setGroupVisible(group.id, !group.visible)}
          >
            {group.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </Button>
          <Folder size={14} />
          <span className="layer-group-name">{group.name}</span>
          <span className="layer-group-count">{group.layerIds.length}</span>
          <Button
            variant="icon"
            title="上移组"
            aria-label="上移组"
            onClick={() => moveRootEntry({ type: 'group', id: group.id }, 'up')}
          >
            ↑
          </Button>
          <Button
            variant="icon"
            title="下移组"
            aria-label="下移组"
            onClick={() => moveRootEntry({ type: 'group', id: group.id }, 'down')}
          >
            ↓
          </Button>
          <Button
            variant="icon"
            title="删除组"
            aria-label="删除组"
            onClick={() => handleRemoveGroup(group)}
          >
            ×
          </Button>
        </div>
        {!collapsed &&
          group.layerIds.map((layerId, index) => {
            const layer = layerById.get(layerId)
            if (!layer) return null
            return renderLayerRow(layer, {
              indent: true,
              groupId: group.id,
              indexInGroup: index
            })
          })}
      </div>
    )
  }

  const filteredEmpty =
    flattenLayerIds(tree).filter((id) => {
      const layer = layerById.get(id)
      return layer ? matchesQuery(layer) : false
    }).length === 0

  return (
    <div className="feature-panel layer-manager">
      <div className="feature-heading">
        <div>
          <span className="eyebrow">LAYER MANAGER</span>
          <h3>图层</h3>
        </div>
        <div className="layer-heading-actions">
          <Button
            variant="icon"
            title="新建组"
            aria-label="新建组"
            onClick={() => {
              const selected = selectedLayerId ? [selectedLayerId] : []
              createGroup('新建组', selected)
            }}
          >
            <FolderPlus size={15} />
          </Button>
          <Button
            variant="icon"
            title="上移"
            aria-label="上移图层"
            disabled={!selectedLayerId}
            onClick={() => selectedLayerId && layerCommands.moveUp(selectedLayerId)}
          >
            ↑
          </Button>
          <Button
            variant="icon"
            title="下移"
            aria-label="下移图层"
            disabled={!selectedLayerId}
            onClick={() => selectedLayerId && layerCommands.moveDown(selectedLayerId)}
          >
            ↓
          </Button>
          <Button variant="icon" title="图层选项" aria-label="图层选项">
            <Layers3 size={15} />
          </Button>
        </div>
      </div>
      <label className="search-field">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索图层"
        />
      </label>
      <div
        className="layer-tree"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          onDropLayer({ kind: 'root', index: rootOrder.length })
        }}
      >
        <div className="tree-root">
          <Folder size={14} />
          <span>工作空间</span>
        </div>
        {rootOrder.map((entry, index) => renderRootEntry(entry, index))}
        {tree.layers.length === 0 && <p className="empty-state">没有图层，请通过&quot;添加数据&quot;导入</p>}
        {tree.layers.length > 0 && filteredEmpty && <p className="empty-state">没有匹配的图层</p>}
      </div>
      {menu ? (
        <LayerContextMenu
          layerId={menu.layerId}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRequestRename={beginRename}
        />
      ) : null}
    </div>
  )
}
