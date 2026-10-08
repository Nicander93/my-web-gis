import { ArrowRight, Box, FolderOpen, Map, Plus } from 'lucide-react'
import { projectCommands } from '@/app/commands/project.commands'

/** 无项目时提供直接可用的工作入口，不展示虚构的最近项目。 */
export function ProjectStartScreen() {
  return (
    <main className="project-start" aria-label="项目起始页">
      <aside className="project-start__sidebar">
        <div className="start-app-mark">
          <Map size={22} />
          <strong>Desktop WebGIS</strong>
        </div>
        <span className="start-section-label">项目</span>
        <button
          className="start-nav-item is-active"
          onClick={projectCommands.newProject}
        >
          <Plus size={16} />
          新建项目
        </button>
        <button
          className="start-nav-item"
          onClick={() => void projectCommands.openProject()}
        >
          <FolderOpen size={16} />
          打开项目
        </button>
        <p className="start-storage-note">
          项目文件保存图层、样式和工作场景。数据导出在各图层的菜单中操作。
        </p>
      </aside>
      <section className="project-start__content">
        <header className="project-start__heading">
          <span className="start-section-label">工作空间</span>
          <h1>开始工作</h1>
          <p>根据当前任务创建地图或场景。</p>
        </header>
        <div className="start-workspaces">
          <button onClick={() => projectCommands.createWorkspace('2d', '')}>
            <Map size={27} />
            <span>
              <strong>二维地图</strong>
              <small>导入地理数据，编辑要素，进行空间分析与专题制图。</small>
            </span>
            <ArrowRight size={18} />
          </button>
          <button onClick={() => projectCommands.createWorkspace('3d', '')}>
            <Box size={27} />
            <span>
              <strong>三维场景</strong>
              <small>组织城市模型，调整对象，配置场景环境并发布。</small>
            </span>
            <ArrowRight size={18} />
          </button>
        </div>
        <div className="start-open-project">
          <FolderOpen size={17} />
          <span>继续已有工作</span>
          <button onClick={() => void projectCommands.openProject()}>
            打开项目文件
            <ArrowRight size={14} />
          </button>
        </div>
        <section className="start-guide">
          <h2>一个清晰的工作路径</h2>
          <ol>
            <li>
              <strong>组织数据</strong>
              <span>从本地文件或地图服务添加图层。</span>
            </li>
            <li>
              <strong>选择任务</strong>
              <span>在功能区进入浏览、编辑或处理。</span>
            </li>
            <li>
              <strong>配置对象</strong>
              <span>从图层菜单打开样式、属性和导出。</span>
            </li>
          </ol>
        </section>
      </section>
    </main>
  )
}
