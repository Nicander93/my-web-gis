# 三类核心组件视觉校准

日期：2026-10-18。基线 `ee23d0208501cc0a2c2da1129839a2290da106de`，独立分支 `ui/visual-alignment-core`。

本轮仅实施 S0–S5，覆盖主题接入、Ribbon/按钮、二维属性表、三维完整属性窗及二维共享窗框。不改 GIS 引擎、算法、文件协议和业务事务，也不推广到其余组件。

## 依据与验收边界

- [任务原文](AGENT_VISUAL_TASK.md)、[视觉规范](01-core-ui-visual-spec.md)。
- [二维 HTML](reference/desktop-webgis-2d-final.html)、[三维 HTML](reference/desktop-webgis-3d-final.html)从仓库既定原型原样复制；SHA256 见 [基线记录](baseline.json)。原型数据与模拟地图未进入生产代码。
- 用户此前明确将视觉检查留给自己，并要求使用单测和行为 E2E。因此本轮不生成 before/after 截图，不宣称视觉签收通过。下面以源码差异、真实 DOM 几何和行为数据说明结果，视觉质量待用户确认。

## 变更对照

| 问题 | 处理 | 对应规范 |
| --- | --- | --- |
| `tokens.css`、`workbench.css` 和 AntD 存在多份强调绿/背景色 | `tokens.css` 为唯一主题来源，ConfigProvider 读取当前 CSS 语义值并监听主题/系统模式变化 | 2.1 |
| 普通控件被全局压成 24px | 普通表单 30px、Ribbon 工具 34px、嵌入图标 24px，保持字号和用途层级 | 1、2.2 |
| 三维命令平铺，每个 Tab 重复“添加数据” | 现有命令按浏览/场景表现/组织、符号/几何/效果、对象/变换/管理等分组；添加数据保留在场景 Tab；溢出时提供更多工具菜单 | 3 |
| 属性表标题、活动面板 Tab、图层 Tab 叠加挤压数据 | 用共享标题插槽将活动面板切换与图层 Tab 放进同一顶栏，保留 AntD Tabs、关闭/恢复、分页和会话数据 | 4 |
| 字段计算等设置常驻挤压数据，基线滚动区仅 31px | 使用 AntD Popover 按需显示，保留原有草稿和数据操作；表格数据区随窗口伸缩 | 4 |
| 声明的行高与真实盒模型不一致 | 表格局部 ConfigProvider 移除额外垂直 padding，保留 32px 表头、30px 记录行；实际 DOM 尺寸进入 E2E 断言 | 4 |
| 三维完整属性窗重复实现窗框，大部分字段同一模板 | 复用 modeless 窗框；纯展示 PropertyField/Group/Vector3、数值单位、POI 图标预览、效果参数与折叠控制点 | 5 |
| 搜索只在当前分类生效，API 别名难找 | 搜索切换到对应分类并显示分类归属；三轴字段支持 `transform.translation` 等别名 | 5 |

新几何目标：应用栏 40px、Ribbon Tab 31px、工具行 43px、工具按钮 34px；属性表顶栏 36px、工具栏 40px、表头 32px、记录行 30px、底栏 29px；三维属性窗初值 670×514px，内容独立滚动，底部操作不收缩。

## Token 与 CSS 归属

| 文件 | 权威范围 |
| --- | --- |
| `src/styles/tokens.css` | 浅色、暗色、系统模式语义调色板；普通/图标/Ribbon 控件尺寸 |
| `src/components/ui/DesktopUiProvider.tsx` | CSS → AntD 主题映射；不再持有另一套颜色字面量 |
| `src/styles/antd-workbench.css` | AntD 模态框及 GIS 表格组件外观，颜色只引用 Token |
| `src/styles/workbench.css` | 既有 Ribbon 及表格工具/状态行布局；本轮删除重复根 Token 和整批 compact 尾部覆盖 |
| `src/styles/core-ui.css` | 标题插槽、图层 Tab、按需工具弹层和 Ribbon 分组布局 |
| `src/components/ui/property-window.css` | 完整属性窗、字段/三轴/单位/效果区的展示布局 |

删除项：`workbench.css` 的三处 `:root` 主题/密度覆盖、全局 `--desktop-control-height:24px`、重复 Ribbon 行高、尾部对图层树/检查器等组件的 compact 覆盖；`DesktopUiProvider` 的硬编码调色板；三维属性窗重复的移动/标题/搜索/分类/底栏实现。普通输入与嵌入式图标高度不再使用同一变量。

未全量迁移其余 feature CSS，避免超出三类核心组件范围；其他组件中的历史字面量不是本轮视觉签收结论。未新增 `!important`。

## 回归命令

在仓库根目录执行（原生脚本在 `apps/desktop` 执行）：

```powershell
rtk pnpm --filter @desktop-webgis/desktop build
rtk pnpm --filter @desktop-webgis/desktop test
rtk pnpm --filter @desktop-webgis/desktop exec playwright test --config playwright.visual.config.ts --project=desktop --project=laptop --project=wide
rtk proxy node scripts/native-resource-acceptance.mjs --layout125
```

专项 E2E 使用 36 条、8 个属性字段的确定性 GIS 测试要素，运行真实 OpenLayers、AntD 表格、真实示例 3D Tiles 和独立 POI。测试覆盖表格停靠/浮动/滚动、列宽与字段、筛选/计算、编辑撤销、项目保存重开、预览取消、错误/版本冲突、输入法组合态 Esc、窗体按钮命中区域与主题变化。既有业务断言保留；仅取消截图输出，并随顶栏位置更新 Tab 定位器。

`map-navigation-drop.e2e.ts` 的旧 Ribbon ≤70px 断言依据新规范改为 74–76px 的双边界断言；文件拖入、选择和绘制中临时平移的断言不变。

`workbench.e2e.ts` 旧工具栏/状态栏合计 ≤64px 的断言改为分别实测 40px 和 29px，避免与本次明确的尺寸规范冲突；表绑定、筛选、地图范围和编辑断言不变。

最终命令结果与原生报告见 [验收数据](acceptance.json)。历史失败及修复见 `baseline.json`；原生测试因“添加数据”只在场景 Tab 展示而更新了导航步骤，保留焦点、内容/历史及 Canvas 身份的断言。

综合矩阵首次为 84 通过、3 条旧尺寸上限断言失败；更新为新规范的双项尺寸断言后，三个分辨率复跑均通过。最终按钮/表格补检另有 6 项通过（其中 3 项为新增焦点场景）。记录的是组合后的 90 个独立场景覆盖，不把它表述为一次完整 90 项全绿运行。

开发检查还发现说明性 Tooltip 在模态框回焦后遮挡页签：已限制启用工具仅在 hover 时提示，禁用原因支持键盘焦点；说明浮层不接管指针。最终补检覆盖导入、模态框关闭、页签点击和方向键导航，未使用强制点击绕过遮挡。

## 暂停点与遗留

本轮完成代码、行为和几何验收后停在 S5，不自动推广其他组件。PR 等待用户视觉确认，不自动合并。

- 视觉比例和细节尚待用户审查，未制作截图对照。
- 原生受控 DPR 1.25 与操作系统 125% 缩放分开记录；真实系统 125% 缩放、实体输入法操作、实体显卡表现未据浏览器结果推定通过。
- 保留三固定 Docking 窗口身份，不开展自由窗口体系重构。
- 生产构建既有的大包和动态/静态混合导入警告仍在，未以本次视觉专项扩展为打包重构。
