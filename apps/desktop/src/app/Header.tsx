import { AppWindow } from 'lucide-react'
import { MenuBar } from './header/MenuBar'
import { Toolbar } from './header/Toolbar'
import { useProjectStore } from '@/stores/project.store'
import { getProjectType } from '@/services/project-type'

/** 项目身份与完整菜单常驻，常用命令按任务分组。 */
export function Header({ showToolbar = true }: { showToolbar?: boolean }) {
  const project = useProjectStore((state) => state.project)
  const dirty = useProjectStore((state) => state.dirty)
  const type = getProjectType(project)
  return (
    <header className="app-header">
      <div className="window-bar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <AppWindow size={15} />
          </span>
          <strong>Desktop WebGIS</strong>
          <span className="window-separator" />
          <span
            className="workspace-name"
            title={showToolbar ? project.name : undefined}
          >
            {showToolbar
              ? project.name === 'Untitled Project'
                ? '未命名二维地图'
                : project.name
              : '未打开项目'}
          </span>
          {showToolbar && (
            <span className="project-kind">
              {type === '3d' ? '三维场景' : '二维地图'}
            </span>
          )}
          {dirty && (
            <span className="project-dirty" role="status">
              未保存
            </span>
          )}
        </div>
      </div>
      <MenuBar />
      {type === '2d' && showToolbar && <Toolbar />}
    </header>
  )
}
