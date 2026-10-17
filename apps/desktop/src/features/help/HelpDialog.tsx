import { EditorDialog } from '@/components/ui/EditorDialog'
import type { HelpDialogPage } from '@/app/commands/help.commands'
import { version } from '../../../package.json'

interface HelpDialogProps {
  page: HelpDialogPage
  onClose(): void
}

export function HelpDialog({ page, onClose }: HelpDialogProps) {
  return <EditorDialog title={page === 'about' ? '关于 Desktop WebGIS' : '操作帮助'} onClose={onClose}>
    <div className="dialog-body help-content">
      {page === 'about' ? <p>Desktop WebGIS · {version}</p> : <>
        <dl className="help-shortcuts">
          <dt>新建项目</dt><dd><kbd>Ctrl + N</kbd></dd>
          <dt>打开项目</dt><dd><kbd>Ctrl + O</kbd></dd>
          <dt>保存项目</dt><dd><kbd>Ctrl + S</kbd></dd>
          <dt>另存为</dt><dd><kbd>Ctrl + Shift + S</kbd></dd>
          <dt>撤销</dt><dd><kbd>Ctrl + Z</kbd></dd>
          <dt>重做</dt><dd><kbd>Ctrl + Shift + Z</kbd></dd>
          <dt>专注模式</dt><dd><kbd>Ctrl + Shift + F</kbd></dd>
          <dt>二维地图临时平移</dt><dd>中键拖动 / 空格 + 左键拖动</dd>
        </dl>
        <details><summary>文件拖放与地图导航</summary>
          <p>二维地图中可将 GeoJSON、SHP ZIP、DXF 或 CSV 文件拖到地图、图层面板或窗口空白处。一次一个文件，完成配置和确认后导入，可一步撤销。</p>
          <p>选择、绘制和修改期间均可用中键，或按住空格再用左键拖动平移；当前工具和未完成的绘制草稿保留。输入框中的空格仍用于输入文字。</p>
        </details>
        <details><summary>目标与数据范围</summary>
          <p>编辑目标、属性表和检查器分别绑定对象，浏览其他图层不会自动切换它们。</p>
          <p>表内搜索仅改变表格显示；图层过滤影响地图和表格。字段统计与“选择匹配记录”使用图层过滤结果，不随表内搜索缩小范围。</p>
        </details>
        <details><summary>属性修改</summary>
          <p>普通实时属性会在有效输入后更新。样式和图层过滤使用草稿，需要应用；切换目标时先处理尚未应用的修改。</p>
        </details>
        <details><summary>窗口布局</summary>
          <p>通过“窗口”菜单打开或关闭图层树、检查器和属性表。拖动标题栏可浮动窗口，标题栏的停靠选择可切换左侧、右侧或底部；属性表底部停靠时覆盖整个地图宽度。</p>
          <p>浮动窗口聚焦标题栏后可用方向键移动，Shift 加快移动；聚焦调整大小控件后可用方向键缩放。拖动中按 Esc 取消。布局自动保存在本机，可用“窗口 → 重置布局”恢复默认状态。</p>
        </details>
      </>}
    </div>
    <footer className="dialog-footer"><button className="button-secondary" onClick={onClose}>关闭</button></footer>
  </EditorDialog>
}
