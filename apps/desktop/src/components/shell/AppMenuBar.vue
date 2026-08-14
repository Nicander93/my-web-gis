<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

type MenuEntry =
  | { sep: true; label?: undefined; disabled?: undefined; run?: undefined }
  | { sep?: false; label: string; disabled?: boolean; run?: () => Promise<unknown> | unknown }

type MenuGroup = {
  id: string
  label: string
  items: MenuEntry[]
}

const projectStore = useProjectStore()
const uiStore = useUiStore()
const openMenu = ref<string | null>(null)

const hasLayer = computed(() => Boolean(projectStore.activeLayer))
const hasSelection = computed(() => projectStore.selection.featureIds.length > 0)

const menus = computed<MenuGroup[]>(() => [
  {
    id: 'project',
    label: '项目(P)',
    items: [
      { label: '新建项目', run: () => projectStore.newProject() },
      { label: '打开项目', run: () => run(projectStore.openProjectFromDialog, '项目已打开') },
      { label: '保存', run: () => run(projectStore.saveProject, '已保存') },
      { label: '另存为', run: () => run(projectStore.saveProjectAs, '已另存') },
      { sep: true },
      { label: '添加数据', run: () => (uiStore.addDataDialogOpen = true) },
      { label: '导出图层', disabled: !hasLayer.value, run: () => run(() => projectStore.exportActiveLayer(false), '图层已导出') },
      { sep: true },
      { label: '关闭项目', run: () => projectStore.closeProject() }
    ]
  },
  {
    id: 'edit',
    label: '编辑(E)',
    items: [
      { label: '撤销', disabled: !projectStore.editHistory.canUndo, run: () => projectStore.undo() },
      { label: '重做', disabled: !projectStore.editHistory.canRedo, run: () => projectStore.redo() },
      { sep: true },
      { label: '删除所选要素', disabled: !hasSelection.value, run: () => projectStore.deleteSelectedFeatures() }
    ]
  },
  {
    id: 'view',
    label: '视图(V)',
    items: [
      { label: '缩放到全部', run: () => window.dispatchEvent(new CustomEvent('desktop-webgis:zoom-to-all')) },
      { label: uiStore.sidebarOpen ? '隐藏侧栏' : '显示侧栏', run: () => uiStore.toggleSidebar() },
      { label: uiStore.inspectorOpen ? '隐藏属性面板' : '显示属性面板', run: () => uiStore.toggleInspector() },
      { label: uiStore.bottomPanelOpen ? '隐藏属性表' : '显示属性表', run: () => uiStore.toggleAttributeTable() }
    ]
  },
  {
    id: 'layer',
    label: '图层(L)',
    items: [
      { label: '添加数据', run: () => (uiStore.addDataDialogOpen = true) },
      { label: '缩放到当前图层', disabled: !hasLayer.value, run: zoomToActiveLayer },
      { label: '打开属性表', run: () => uiStore.openAttributeTable() },
      { label: '导出图层', disabled: !hasLayer.value, run: () => run(() => projectStore.exportActiveLayer(false), '图层已导出') },
      { label: '移除当前图层', disabled: !hasLayer.value, run: () => projectStore.removeLayer(projectStore.activeLayerId!) },
      { sep: true },
      { label: '图层样式', disabled: true }
    ]
  },
  {
    id: 'feature',
    label: '要素(F)',
    items: [
      { label: '选择', run: () => projectStore.setActiveTool('select') },
      { label: '绘制点', run: () => projectStore.setActiveTool('draw-point') },
      { label: '绘制线', run: () => projectStore.setActiveTool('draw-line') },
      { label: '绘制多边形', run: () => projectStore.setActiveTool('draw-polygon') },
      { label: '修改', run: () => projectStore.setActiveTool('modify') },
      { label: '删除', run: () => projectStore.setActiveTool('delete') }
    ]
  },
  {
    id: 'tools',
    label: '工具(T)',
    items: [
      { label: '命令面板', run: () => (uiStore.commandPaletteOpen = true) },
      { sep: true },
      { label: '测量', disabled: true },
      { label: '书签', disabled: true }
    ]
  },
  {
    id: 'analysis',
    label: '分析(A)',
    items: [
      { label: '缓冲', disabled: true },
      { label: '裁剪', disabled: true },
      { label: '相交', disabled: true }
    ]
  },
  {
    id: 'settings',
    label: '设置(S)',
    items: [{ label: '设置', disabled: true }]
  },
  {
    id: 'help',
    label: '帮助(H)',
    items: [{ label: '帮助', disabled: true }]
  }
])

onMounted(() => document.addEventListener('click', closeIfOutside))
onBeforeUnmount(() => document.removeEventListener('click', closeIfOutside))

function closeIfOutside(event: MouseEvent): void {
  const target = event.target as HTMLElement
  if (!target.closest('.menu-group')) openMenu.value = null
}

function toggleMenu(id: string): void {
  openMenu.value = openMenu.value === id ? null : id
}

async function run(action: () => Promise<unknown> | unknown, message: string): Promise<void> {
  try {
    await action()
    uiStore.setStatus(message)
  } catch (error) {
    uiStore.showError('操作失败', message, String(error))
  }
}

function zoomToActiveLayer(): void {
  const layerId = projectStore.activeLayerId
  if (!layerId) return
  window.dispatchEvent(new CustomEvent('desktop-webgis:zoom-to-layer', { detail: layerId }))
  uiStore.setStatus('已缩放到图层')
}

async function runItem(item: MenuEntry): Promise<void> {
  openMenu.value = null
  if (item.sep || item.disabled || !item.run) return
  await item.run()
}
</script>

<template>
  <nav class="menu-bar" aria-label="Application menu">
    <div v-for="menu in menus" :key="menu.id" class="menu-group">
      <button type="button" :class="{ active: openMenu === menu.id }" @click.stop="toggleMenu(menu.id)">
        {{ menu.label }}
      </button>
      <div v-if="openMenu === menu.id" class="menu-dropdown">
        <template v-for="(item, index) in menu.items" :key="item.sep ? `sep-${index}` : item.label">
          <div v-if="item.sep" class="menu-sep"></div>
          <button
            v-else
            type="button"
            :disabled="item.disabled"
            :title="item.disabled ? '后续版本' : undefined"
            @click="runItem(item)"
          >
            {{ item.label }}
          </button>
        </template>
      </div>
    </div>
    <span class="menu-spacer"></span>
    <span class="window-title">
      {{ projectStore.project?.name }}
      <strong v-if="projectStore.dirty">*</strong>
    </span>
  </nav>
</template>
