import { Box, Download, Eye, FileInput, Globe, LayoutPanelLeft, Plus, Redo2, Trash2, Undo2, Waves } from 'lucide-react'
import { MenuItem } from '@/app/header/menus/MenuItem'
import { requestSceneAction } from './scene3d-actions'
import type { SceneAction } from './scene3d-actions'

interface SceneMenuProps { section: 'data' | 'layer' | 'edit' | 'view' | 'help'; onClose(): void }
const actions = {
  data: [{ label: '添加资源…', icon: Plus, action: 'add-resource' }, { label: '导入场景…', icon: FileInput, action: 'import-scene' }, { label: '导出场景…', icon: Download, action: 'export-scene' }],
  layer: [{ label: '添加模型或数据…', icon: Box, action: 'add-resource' }, { label: '绘制水面', icon: Waves, action: 'draw-water' }, { label: '删除选中对象', icon: Trash2, action: 'delete' }],
  edit: [{ label: '撤销', icon: Undo2, action: 'undo' }, { label: '重做', icon: Redo2, action: 'redo' }],
  view: [{ label: '场景设置', icon: Globe, action: 'scene-settings' }, { label: '回到初始视角', icon: Eye, action: 'initial-view' }, { label: '恢复面板布局', icon: LayoutPanelLeft, action: 'reset-layout' }],
help: [{ label: '添加三维示例', icon: Box, action: 'sample' }]
} satisfies Record<SceneMenuProps['section'], Array<{ label: string; icon: typeof Box; action: SceneAction }>>

export function SceneMenu({ section, onClose }: SceneMenuProps) {
  return <div className="menu-content">{actions[section].map(item => <MenuItem key={item.action} label={item.label} icon={item.icon} onClick={() => { requestSceneAction(item.action); onClose() }} />)}</div>
}
