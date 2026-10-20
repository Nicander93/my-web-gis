import { MenuBar } from './header/MenuBar'
import { Toolbar } from './header/Toolbar'
import { useProjectStore } from '@/stores/project.store'
import { getProjectType } from '@/services/project-type'
import { isTauri } from '@tauri-apps/api/core'
import { WindowControls } from './header/WindowControls'

/** 项目身份与完整菜单常驻，常用命令按任务分组。 */
export function Header({ showToolbar = true }: { showToolbar?: boolean }) {
  const project = useProjectStore((state) => state.project)
  const dirty = useProjectStore((state) => state.dirty)
  const type = getProjectType(project)
  const native = isTauri()
  return (
    <header className="app-header">
      <div className={`window-bar${native ? ' window-bar--native' : ''}`}>
        <div className="brand-lockup">
          <span className="brand-mark">
            <img src="/brand/logo.png" alt="my-web-gis" width={20} height={20} />
          </span>
          <strong>my-web-gis</strong>
          <span className="window-separator" />
          <MenuBar />
        </div>
        <div className="window-context" data-tauri-drag-region={native ? '' : undefined}>
          <span
            className="workspace-name"
            title={showToolbar ? project.name : undefined}
            data-tauri-drag-region={native ? '' : undefined}
          >
            {showToolbar
              ? project.name === 'Untitled Project'
                ? '未命名二维地图'
                : project.name
              : '未打开项目'}
          </span>
          {showToolbar && (
            <span className="project-kind" data-tauri-drag-region={native ? '' : undefined}>
              {type === '3d' ? '三维场景' : '二维地图'}
            </span>
          )}
          {dirty && (
            <span className="project-dirty" role="status" data-tauri-drag-region={native ? '' : undefined}>
              未保存
            </span>
          )}
        </div>
        {native && <WindowControls />}
      </div>
      {type === '2d' && showToolbar && <Toolbar />}
    </header>
  )
}
