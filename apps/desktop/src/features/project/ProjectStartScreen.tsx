import { Box, FolderOpen, Map } from 'lucide-react'
import { projectCommands } from '@/app/commands/project.commands'

/** 无项目时提供直接可用的工作入口，不展示虚构的最近项目。 */
export function ProjectStartScreen() {
  return (
    <main className="project-start" aria-label="项目起始页">
      <section className="project-start__content">
        <div className="project-start__actions">
          <button onClick={() => projectCommands.createWorkspace('2d', '')}>
            <Map size={20} aria-hidden="true" />
            二维地图
          </button>
          <button onClick={() => projectCommands.createWorkspace('3d', '')}>
            <Box size={20} aria-hidden="true" />
            三维场景
          </button>
          <button onClick={() => void projectCommands.openProject()}>
            <FolderOpen size={20} aria-hidden="true" />
            打开项目…
          </button>
        </div>
      </section>
    </main>
  )
}
