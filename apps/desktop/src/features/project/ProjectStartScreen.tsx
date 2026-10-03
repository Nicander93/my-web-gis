import { Box, FolderOpen, Map, Plus } from 'lucide-react'
import { projectCommands } from '@/app/commands/project.commands'

export function ProjectStartScreen() {
  return <main className="project-start" aria-label="项目起始页"><div className="project-start__content">
    <div className="project-start__heading"><span className="project-start__mark"><Map size={26} aria-hidden="true" /></span><h1>开始一个项目</h1><p>为地图制作和三维场景搭建选择合适的工作空间。</p></div>
    <div className="project-start__types"><div><Map size={22} aria-hidden="true" /><strong>二维地图</strong><p>管理地理数据，编辑要素，制作专题图。</p></div><div><Box size={22} aria-hidden="true" /><strong>三维场景</strong><p>组织城市模型，调整对象，设计水面和环境。</p></div></div>
    <div className="project-start__actions"><button className="button-primary" onClick={projectCommands.newProject}><Plus size={15} aria-hidden="true" />新建项目</button><button className="button-secondary" onClick={() => { void projectCommands.openProject() }}><FolderOpen size={15} aria-hidden="true" />打开已有项目</button></div>
  </div></main>
}
