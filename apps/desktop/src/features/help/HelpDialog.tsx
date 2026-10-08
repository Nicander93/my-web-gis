import { EditorDialog } from '@/components/ui/EditorDialog'
import type { HelpDialogPage } from '@/app/commands/help.commands'
import { version } from '../../../package.json'
import { useProjectStore } from '@/stores/project.store'
import { getProjectType } from '@/services/project-type'

interface HelpDialogProps {
  page: HelpDialogPage
  onClose(): void
}

export function HelpDialog({ page, onClose }: HelpDialogProps) {
  const city = useProjectStore(state => getProjectType(state.project) === '3d')
  return <EditorDialog title={page === 'about' ? '关于 Desktop WebGIS' : '操作帮助'} onClose={onClose}>
    <div className="dialog-body help-content">
      {page === 'about' ? <p>Desktop WebGIS · {version}</p> : <>
        <dl className="help-shortcuts">
          <dt>新建项目</dt><dd><kbd>Ctrl + N</kbd></dd>
          <dt>打开项目</dt><dd><kbd>Ctrl + O</kbd></dd>
          <dt>保存项目</dt><dd><kbd>Ctrl + S</kbd></dd>
          <dt>另存为</dt><dd><kbd>Ctrl + Shift + S</kbd></dd>
          <dt>撤销</dt><dd>{city ? <kbd>Ctrl + Z</kbd> : '编辑 → 撤销'}</dd>
          <dt>重做</dt><dd>{city ? <kbd>Ctrl + Shift + Z</kbd> : '编辑 → 重做'}</dd>
        </dl>
        <details><summary>目标与数据范围</summary>
          <p>编辑目标、属性表和检查器分别绑定对象，浏览其他图层不会自动切换它们。</p>
          <p>表内搜索仅改变表格显示；图层过滤影响地图和表格。字段统计与“选择匹配记录”使用图层过滤结果，不随表内搜索缩小范围。</p>
        </details>
        <details><summary>属性修改</summary>
          <p>普通实时属性会在有效输入后更新。样式和图层过滤使用草稿，需要应用；切换目标时先处理尚未应用的修改。</p>
        </details>
      </>}
    </div>
    <footer className="dialog-footer"><button className="button-secondary" onClick={onClose}>关闭</button></footer>
  </EditorDialog>
}
