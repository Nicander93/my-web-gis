<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores/project.store'
import { useUiStore } from '@/stores/ui.store'

const projectStore = useProjectStore()
const uiStore = useUiStore()

const sampleProjects = [
  { name: 'Rivers 项目', path: 'D:/projects/rivers', crs: 'EPSG:3857', changed: '2024/05/10 10:30', tag: '最近打开' },
  { name: 'City Edit', path: 'D:/projects/city-edit', crs: 'EPSG:3857', changed: '2024/05/09 16:20', tag: '' },
  { name: 'Water Demo', path: 'D:/projects/demo-water', crs: 'EPSG:4326', changed: '2024/05/08 09:15', tag: '' }
]

const recentRows = computed(() => {
  if (projectStore.recentProjects.length > 0) {
    return projectStore.recentProjects.map((recent) => ({
      name: recent.name,
      path: recent.path,
      changed: new Date(recent.openedAt).toLocaleString(),
      crs: 'EPSG:3857',
      recentPath: recent.path
    }))
  }
  return [
    { name: 'Rivers 项目', path: 'D:/projects/rivers', changed: '2024/05/10 10:30', crs: 'EPSG:3857', recentPath: '' },
    { name: 'City Edit', path: 'D:/projects/city-edit', changed: '2024/05/09 16:20', crs: 'EPSG:3857', recentPath: '' },
    { name: 'Water Demo', path: 'D:/projects/demo-water', changed: '2024/05/08 09:15', crs: 'EPSG:4326', recentPath: '' },
    { name: 'Parcel Analysis', path: 'D:/projects/parcel-analysis', changed: '2024/05/07 14:45', crs: 'EPSG:3857', recentPath: '' }
  ]
})

const activities = [
  ['打开项目', 'Rivers 项目', '10:30'],
  ['编辑图层', 'Rivers', '10:22'],
  ['导入文件', 'rivers_export.geojson', '09:58'],
  ['添加图层', 'Stations', '09:47'],
  ['保存项目', 'Rivers 项目', '09:30']
]

async function openProject(): Promise<void> {
  try {
    await projectStore.openProjectFromDialog()
    uiStore.setStatus('项目已打开')
  } catch (error) {
    uiStore.showError('无法打开项目', '请选择有效的项目文件。', String(error))
  }
}

async function openRecentProject(path: string): Promise<void> {
  if (!path) return
  try {
    await projectStore.openRecentProject(path)
    uiStore.setStatus('项目已打开')
  } catch (error) {
    uiStore.showError('打开最近项目', '请使用“打开项目”重新定位项目文件。', String(error))
  }
}
</script>

<template>
  <main class="start-page">
    <div class="start-titlebar">
      <strong>桌面 WebGIS</strong>
      <span>－</span>
      <span>□</span>
      <span>x</span>
    </div>
    <nav class="start-menu">
      <button>文件(F)</button>
      <button>编辑(E)</button>
      <button>视图(V)</button>
      <button>图层(L)</button>
      <button>分析(A)</button>
      <button>工具(T)</button>
      <button>窗口(W)</button>
      <button>帮助(H)</button>
      <span></span>
      <strong>● 已就绪</strong>
      <button>管理员⌄</button>
    </nav>

    <div class="start-shell">
      <aside class="start-sidebar">
        <button class="active">⌂ 开始页</button>
        <button>□ 项目</button>
        <button>◇ 地图</button>
        <button>▱ 图层</button>
        <button>◎ 数据源</button>
        <button>♧ 样式</button>
        <button>▣ 工具箱</button>
        <button>✚ 插件</button>
        <button>⚙ 设置</button>
        <button class="collapse">‹ 折叠</button>
      </aside>

      <section class="start-main">
        <div class="start-hero">
          <div>
            <h1>欢迎使用 桌面 WebGIS</h1>
            <p>轻量、专业、可扩展的桌面 GIS 平台</p>
          </div>
          <div class="start-landscape" aria-hidden="true">
            <span class="mountain mountain-a"></span>
            <span class="mountain mountain-b"></span>
            <span class="river-line"></span>
          </div>
        </div>

        <div class="quick-actions">
          <button @click="projectStore.newProject()">
            <strong>＋ 新建项目</strong>
            <span>创建空白项目</span>
          </button>
          <button @click="openProject">
            <strong>□ 打开项目</strong>
            <span>打开本地项目文件</span>
          </button>
          <button @click="uiStore.addDataDialogOpen = true">
            <strong>◇ 导入 GeoJSON</strong>
            <span>导入 GeoJSON 文件</span>
          </button>
        </div>

        <header class="section-heading">
          <h2>项目</h2>
          <button>全部项目 →</button>
        </header>
        <div class="project-card-grid">
          <article v-for="project in sampleProjects" :key="project.name" class="project-card">
            <div class="project-thumb"><span></span></div>
            <div>
              <h3>{{ project.name }}</h3>
              <p>位置：{{ project.path }}</p>
              <p>修改：{{ project.changed }}</p>
              <p>坐标系：{{ project.crs }}</p>
              <small v-if="project.tag">● {{ project.tag }}</small>
            </div>
            <button title="更多">⋯</button>
          </article>
        </div>

        <header class="section-heading">
          <h2>最近项目</h2>
          <div>
            <button>▷ 打开</button>
            <button>⋯ 更多</button>
          </div>
        </header>
        <div class="start-table">
          <div class="table-head">
            <span>名称</span>
            <span>位置</span>
            <span>修改时间</span>
            <span>坐标系</span>
            <span></span>
          </div>
          <button
            v-for="row in recentRows"
            :key="`${row.name}-${row.path}`"
            class="table-row"
            type="button"
            @click="openRecentProject(row.recentPath)"
          >
            <span>□ {{ row.name }}</span>
            <span>{{ row.path }}</span>
            <span>{{ row.changed }}</span>
            <span>{{ row.crs }}</span>
            <span>▷ ⋯</span>
          </button>
        </div>
      </section>

      <aside class="start-right-rail">
        <section>
          <h2>最近活动</h2>
          <div v-for="activity in activities" :key="`${activity[0]}-${activity[2]}`" class="activity-row">
            <span>{{ activity[0] }}</span>
            <strong>{{ activity[1] }}</strong>
            <time>{{ activity[2] }}</time>
          </div>
          <button class="rail-link">查看全部活动 →</button>
        </section>

        <section>
          <h2>小贴士</h2>
          <article>
            <strong>快速开始</strong>
            <p>通过“新建项目”向导，快速创建并配置您的 GIS 项目。</p>
            <button>了解更多 →</button>
          </article>
          <article>
            <strong>导入数据</strong>
            <p>当前版本支持 GeoJSON 文件导入，导入后可编辑属性与几何。</p>
            <button>了解更多 →</button>
          </article>
        </section>
      </aside>
    </div>

    <footer class="start-status">
      <span>坐标参考系：EPSG:3857</span>
      <span>比例尺：1:25,000</span>
      <strong>就绪 ●</strong>
    </footer>
  </main>
</template>
