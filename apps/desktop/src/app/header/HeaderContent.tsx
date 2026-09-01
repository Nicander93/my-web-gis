import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  FilePlus2,
  FileText,
  FolderOpen,
  Layers2,
  LocateFixed,
  MapPinned,
  MousePointer2,
  Move,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Scan,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { HeaderButton } from './HeaderButton'
import { HeaderGroup } from './HeaderGroup'
import type { HeaderTabId } from './HeaderTabs'
import { editCommands } from '@/app/commands/edit.commands'
import { layerCommands } from '@/app/commands/layer.commands'
import { mapCommands } from '@/app/commands/map.commands'
import { projectCommands } from '@/app/commands/project.commands'
import { viewCommands } from '@/app/commands/view.commands'

interface HeaderContentProps {
  activeTab: HeaderTabId
}

/** 根据当前一级 Tab 渲染轻量 Ribbon 命令区。 */
export function HeaderContent({ activeTab }: HeaderContentProps) {
  if (activeTab === 'map') {
    return (
      <div className="header-content">
        <HeaderGroup label="导航">
          <HeaderButton icon={Move} label="平移" onClick={mapCommands.pan} />
          <HeaderButton icon={ZoomIn} label="放大" onClick={mapCommands.zoomIn} />
          <HeaderButton icon={ZoomOut} label="缩小" onClick={mapCommands.zoomOut} />
          <HeaderButton icon={Scan} label="全图" onClick={mapCommands.zoomToAll} />
          <HeaderButton icon={LocateFixed} label="定位" onClick={mapCommands.locate} />
        </HeaderGroup>
        <HeaderGroup label="选择">
          <HeaderButton icon={MousePointer2} label="选择" onClick={mapCommands.select} />
          <HeaderButton icon={RotateCcw} label="清除选择" onClick={mapCommands.clearSelection} />
        </HeaderGroup>
      </div>
    )
  }

  if (activeTab === 'edit') {
    return (
      <div className="header-content">
        <HeaderGroup label="历史">
          <HeaderButton icon={Undo2} label="撤销" shortcut="Ctrl+Z" onClick={editCommands.undo} />
          <HeaderButton icon={Redo2} label="重做" shortcut="Ctrl+Shift+Z" onClick={editCommands.redo} />
        </HeaderGroup>
        <HeaderGroup label="创建">
          <HeaderButton icon={Pencil} label="绘制" onClick={editCommands.draw} />
        </HeaderGroup>
        <HeaderGroup label="修改">
          <HeaderButton icon={Pencil} label="修改几何" onClick={editCommands.modify} />
          <HeaderButton icon={Trash2} label="删除" onClick={editCommands.deleteSelected} />
        </HeaderGroup>
      </div>
    )
  }

  if (activeTab === 'layers') {
    return (
      <div className="header-content">
        <HeaderGroup label="定位">
          <HeaderButton icon={MapPinned} label="缩放到图层" onClick={layerCommands.zoomToLayer} />
        </HeaderGroup>
        <HeaderGroup label="管理">
          <HeaderButton icon={ArrowUp} label="上移" onClick={layerCommands.moveUp} />
          <HeaderButton icon={ArrowDown} label="下移" onClick={layerCommands.moveDown} />
          <HeaderButton icon={Trash2} label="移除" onClick={layerCommands.remove} />
        </HeaderGroup>
        <HeaderGroup label="显示">
          <HeaderButton icon={Eye} label="可见" onClick={layerCommands.editStyle} />
        </HeaderGroup>
        <HeaderGroup label="数据">
          <HeaderButton icon={FileText} label="属性表" onClick={layerCommands.openAttributeTable} />
          <HeaderButton icon={Download} label="导出" onClick={layerCommands.export} />
        </HeaderGroup>
      </div>
    )
  }

  if (activeTab === 'view') {
    return (
      <div className="header-content">
        <HeaderGroup label="面板">
          <HeaderButton icon={Layers2} label="图层" onClick={viewCommands.toggleLayers} />
          <HeaderButton icon={Eye} label="属性" onClick={viewCommands.toggleInspector} />
          <HeaderButton icon={FileText} label="属性表" onClick={viewCommands.toggleAttributeTable} />
        </HeaderGroup>
        <HeaderGroup label="界面">
          <HeaderButton icon={RotateCcw} label="重置布局" onClick={viewCommands.resetLayout} />
        </HeaderGroup>
      </div>
    )
  }

  return (
    <div className="header-content">
      <HeaderGroup label="项目">
        <HeaderButton icon={FilePlus2} label="新建" shortcut="Ctrl+N" onClick={projectCommands.newProject} />
        <HeaderButton icon={FolderOpen} label="打开" shortcut="Ctrl+O" onClick={projectCommands.openProject} />
        <HeaderButton icon={Save} label="保存" shortcut="Ctrl+S" onClick={projectCommands.saveProject} />
        <HeaderButton icon={Save} label="另存为" onClick={projectCommands.saveProjectAs} />
      </HeaderGroup>
      <HeaderGroup label="数据">
        <HeaderButton icon={Plus} label="添加数据" onClick={projectCommands.addData} />
        <HeaderButton icon={Upload} label="新建图层" onClick={projectCommands.addData} />
      </HeaderGroup>
      <HeaderGroup label="输出">
        <HeaderButton icon={Download} label="导出" onClick={projectCommands.exportData} />
      </HeaderGroup>
    </div>
  )
}
