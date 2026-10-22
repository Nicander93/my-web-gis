# my-web-gis · 二维工作区 UX 交付包 V1

## 使用顺序

1. 解压到 `my-web-gis` 仓库根目录（保持 `docs/` 结构）。
2. 先读 `docs/ux/my-web-gis-ux-productization-plan-v1.md`。
3. 再读 `docs/ux/prototype-index-v1.md`，按表对照 HTML。
4. 将 `docs/ux/agent-brief-v1.md` 交给开发 Agent，按 P0–P5 增量实施。

## 重要说明

- HTML 原型仅是交互/布局参考，不能将模拟数据与 JavaScript 当作生产实现。
- 用户最终口头决策优先于较早 HTML 原型（尤其是属性表筛选、右侧要素页、可关闭 Tab、信息工具行为）。
- `docs/reference` 下二维技术设计 V1.1 为旧 `main` 的**历史参考**，不是本轮重写二维内核的任务清单。
- 基线功能分支 `codex/2d-cartography`；让 Agent 先确认当前 HEAD。
- 此包不包含对 GitHub 仓库的代码修改。
