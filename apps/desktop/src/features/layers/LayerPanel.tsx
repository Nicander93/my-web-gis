import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Search,
  X,
  ArrowUp,
  ArrowDown,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import {
  colorToString,
  symbolPrimaryColor,
  type LayerStyle,
  type Symbol
} from '@desktop-webgis/ol-style'
import { LayerContextMenu } from './LayerContextMenu'
import { LayerPopupMenu } from './LayerPopupMenu'
import { MenuItem } from '@/app/header/menus/MenuItem'
import { EditorDialog } from '@/components/ui/EditorDialog'
import { projectCommands } from '@/app/commands/project.commands'
import { layerCommands } from '@/app/commands/layer.commands'
import { useWorkbenchStore } from '@/stores/workbench.store'

function previewFromSymbol(symbol: Symbol): {
  kind: 'point' | 'line' | 'polygon'
  color: string
} {
  const color = colorToString(symbolPrimaryColor(symbol))
  if (symbol.type === 'circle') return { kind: 'point', color }
  if (symbol.type === 'solid' && 'width' in symbol && !('fill' in symbol))
    return { kind: 'line', color }
  if (symbol.type === 'mixed') {
    if (symbol.polygon) return { kind: 'polygon', color }
    if (symbol.line) return { kind: 'line', color }
    return { kind: 'point', color }
  }
  return { kind: 'polygon', color }
}

function getPreviewSymbol(style: LayerStyle | { kind: string }): {
  kind: 'point' | 'line' | 'polygon'
  color: string
} {
  if (isLegacyStyle(style as never)) {
    const legacy = style as { kind: string; fill: string; stroke: string }
    if (legacy.kind === 'polygon')
      return { kind: 'polygon', color: legacy.fill }
    if (legacy.kind === 'line') return { kind: 'line', color: legacy.stroke }
    return { kind: 'point', color: legacy.fill }
  }

  const normalized = style as LayerStyle
  if (normalized.mode === 'single') {
    return previewFromSymbol(normalized.symbol)
  }
  if (normalized.mode === 'categorized') {
    return previewFromSymbol(
      normalized.categories[0]?.symbol ?? normalized.fallback
    )
  }
  return previewFromSymbol(normalized.breaks[0]?.symbol ?? normalized.fallback)
}

interface MenuState {
  layerId: string
  x: number
  y: number
}

interface LayerPanelProps {
  searchOpen: boolean
  onCloseSearch(): void
}

export function LayerPanel({ searchOpen, onCloseSearch }: LayerPanelProps) {
  const editLayerId = useWorkbenchStore((state) => state.editLayerId)
  const [deletingGroup, setDeletingGroup] = useState<LayerGroup | null>(null)
  const [removeChildren, setRemoveChildren] = useState(false)
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const project = useProjectStore((state) => state.project)
  const selectedLayerId = useProjectStore((state) => state.selectedLayerId)
  const selection = useProjectStore((state) => state.selection)
  const setSelectedLayer = useProjectStore((state) => state.setSelectedLayer)
  const setLayerVisible = useProjectStore((state) => state.setLayerVisible)
  const setGroupVisible = useProjectStore((state) => state.setGroupVisible)
  const renameLayer = useProjectStore((state) => state.renameLayer)
  const removeGroup = useProjectStore((state) => state.removeGroup)
  const relocateLayer = useProjectStore((state) => state.relocateLayer)
  const moveRootEntry = useProjectStore((state) => state.moveRootEntry)
  const sessions = useSessionStore((state) => state.sessions)

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [groupMenu, setGroupMenu] = useState<{
    group: LayerGroup
    x: number
    y: number
  } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({})
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

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
    else setQuery('')
  }, [searchOpen])

  function closeSearch(): void {
    setQuery('')
    onCloseSearch()
  }

  function openMenuFor(
    layerId: string,
    clientX: number,
    clientY: number
  ): void {
    setGroupMenu(null)
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
    setRemoveChildren(false)
    setDeletingGroup(group)
  }

  function onDropLayer(
    target:
      | { kind: 'root'; index: number }
      | { kind: 'group'; groupId: string; index: number }
  ): void {
    if (!dragLayerId) return
    relocateLayer(dragLayerId, target)
    setDragLayerId(null)
  }

  function matchesQuery(layer: Layer): boolean {
    if (!q) return true
    return layer.name.includes(q)
  }

  function renderLayerRow(
    layer: Layer,
    options?: { indent?: boolean; groupId?: string; indexInGroup?: number }
  ): ReactNode {
    if (!matchesQuery(layer)) return null
    const isActive = selectedLayerId === layer.id
    const isLoading = Boolean(sessions[layer.id]?.loading)
    const selectedCount =
      selection.layerId === layer.id ? selection.featureIds.length : 0
    const style = isLegacyStyle(layer.style)
      ? migrateLegacyStyle(layer.style)
      : layer.style
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
            onDropLayer({
              kind: 'group',
              groupId: options.groupId,
              index: options.indexInGroup
            })
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
            {editLayerId === layer.id && (
              <span className="layer-edit-marker" title="编辑目标已锁定">
                编辑
              </span>
            )}
            {isLoading ? (
              <Loader2 className="layer-loading-icon" size={12} />
            ) : null}
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
            const rect = (
              event.currentTarget as HTMLElement
            ).getBoundingClientRect()
            openMenuFor(layer.id, rect.left, rect.bottom + 4)
          }}
        >
          <MoreHorizontal size={14} />
        </Button>
      </div>
    )
  }

  function renderRootEntry(
    entry: LayerTreeEntry,
    _rootIndex: number
  ): ReactNode {
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
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu(null)
            setGroupMenu({ group, x: event.clientX, y: event.clientY })
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            onDropLayer({
              kind: 'group',
              groupId: group.id,
              index: group.layerIds.length
            })
          }}
        >
          <Button
            variant="icon"
            title={collapsed ? '展开' : '折叠'}
            aria-label={collapsed ? '展开组' : '折叠组'}
            onClick={() =>
              setCollapsedGroups((state) => ({
                ...state,
                [group.id]: !collapsed
              }))
            }
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </Button>
          <Button
            variant="icon"
            className="visibility-button"
            title={group.visible ? '隐藏组' : '显示组'}
            aria-label={
              group.visible ? `隐藏组${group.name}` : `显示组${group.name}`
            }
            onClick={() => setGroupVisible(group.id, !group.visible)}
          >
            {group.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </Button>
          <Folder size={14} />
          <span className="layer-group-name">{group.name}</span>
          <span className="layer-group-count">{group.layerIds.length}</span>
          <Button
            variant="icon"
            title="组操作"
            aria-label={`组操作：${group.name}`}
            aria-haspopup="menu"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              setMenu(null)
              setGroupMenu({ group, x: rect.left, y: rect.bottom + 4 })
            }}
          >
            <MoreHorizontal size={14} />
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
      {searchOpen && (
        <label className="search-field layer-search">
          <Search size={14} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索图层"
            aria-label="搜索图层"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeSearch()
              }
            }}
          />
          <Button
            variant="icon"
            title="关闭搜索"
            aria-label="关闭搜索"
            onClick={closeSearch}
          >
            <X size={14} />
          </Button>
        </label>
      )}
      <div
        className="layer-tree"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          onDropLayer({ kind: 'root', index: rootOrder.length })
        }}
      >
        {rootOrder.map((entry, index) => renderRootEntry(entry, index))}
        {tree.layers.length === 0 && (
          <div className="workbench-empty">
            <Folder size={24} />
            <strong>尚无图层</strong>
            <p>添加数据后，在此处管理顺序、分组与显隐。</p>
            <button
              className="button-secondary"
              onClick={projectCommands.addData}
            >
              添加数据
            </button>
          </div>
        )}
        {tree.layers.length > 0 && filteredEmpty && (
          <p className="empty-state">没有匹配的图层</p>
        )}
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
      {deletingGroup && (
        <EditorDialog title="移除图层组" onClose={() => setDeletingGroup(null)}>
          <div className="dialog-body">
            <p>
              移除「{deletingGroup.name}」？默认保留其{' '}
              {deletingGroup.layerIds.length} 个图层并移到顶层。
            </p>
            <label className="attr-check">
              <input
                type="checkbox"
                checked={removeChildren}
                onChange={(event) => setRemoveChildren(event.target.checked)}
              />
              同时移除组内图层
            </label>
            {removeChildren && (
              <p className="editor-warning">组内图层将从此项目移除。</p>
            )}
          </div>
          <footer className="dialog-footer">
            <button
              className="button-secondary"
              onClick={() => setDeletingGroup(null)}
            >
              取消
            </button>
            <button
              className={removeChildren ? 'button-danger' : 'button-primary'}
              onClick={() => {
                removeGroup(deletingGroup.id, removeChildren)
                setDeletingGroup(null)
              }}
            >
              {removeChildren ? '移除组及图层' : '移除组，保留图层'}
            </button>
          </footer>
        </EditorDialog>
      )}
      {groupMenu ? (
        <LayerPopupMenu
          x={groupMenu.x}
          y={groupMenu.y}
          label="组菜单"
          onClose={() => setGroupMenu(null)}
        >
          <MenuItem
            icon={ArrowUp}
            label="上移组"
            onClick={() => {
              moveRootEntry({ type: 'group', id: groupMenu.group.id }, 'up')
              setGroupMenu(null)
            }}
          />
          <MenuItem
            icon={ArrowDown}
            label="下移组"
            onClick={() => {
              moveRootEntry({ type: 'group', id: groupMenu.group.id }, 'down')
              setGroupMenu(null)
            }}
          />
          <MenuItem
            icon={Trash2}
            label="删除组"
            onClick={() => {
              handleRemoveGroup(groupMenu.group)
              setGroupMenu(null)
            }}
          />
        </LayerPopupMenu>
      ) : null}
    </div>
  )
}
