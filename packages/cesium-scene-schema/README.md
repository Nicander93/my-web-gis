# @desktop-webgis/cesium-scene-schema

纯 TypeScript 三维场景协议，无 Cesium、DOM 和 UI 框架依赖。

```ts
import { createCityScene, createTransform, parseCityScene } from '@desktop-webgis/cesium-scene-schema'
const city = createCityScene()
city.assets.blocks = { type: '3dtiles', url: './models/tileset.json' }
city.nodes.push({ id: 'blocks', name: '城市街区', type: '3dtiles', asset: 'blocks', visible: true, transform: createTransform() })
const validated = parseCityScene(JSON.stringify(city))
```

新建 CityScene.version=2；解析器仍接受旧版 1。版本 2 增加 `graphic` 节点、可选对象锁定和 `lighting`（太阳光、阴影、ISO 时间）。图形保存几何类型、WGS84 坐标、高度模式、颜色/线宽/点大小/标签、JSON 属性和 Popup。版本 1 不接受图形和光照配置；编辑器修改旧场景时升级到 2，撤销恢复原始版本。

集成进项目 SceneManifest 时使用 `SceneManifest.version=2` 的可选 `city` 字段，旧二维场景保持可读。相机、模型位置及图形/水面边界为 WGS84 度和椭球米；变换为原始模型 ENU 平移（米）、HPR（度）、正数等比缩放。

`validateCityScene` 返回带路径的错误，`parseCityScene` 验证并返回独立克隆。校验包含资源类型匹配、唯一对象 ID、至少三个不同的水面顶点、数值范围及 URL。资源 URL 接受 HTTP(S) 或相对路径；令牌应由宿主注入，不能写入场景 URL。

JSON Schema 导出：`@desktop-webgis/cesium-scene-schema/city.schema.json`。JSON Schema 描述结构和数值范围；URL 策略、跨资源引用、ID 唯一性和边界不同点仍需调用 TypeScript 验证器。维护协议时执行 `node scripts/generate-city-schema.mjs` 同步独立 schema 和主 Scene schema。

首版 0.1.0，MIT；尚未发布 npm。

## 场景分组

CityScene v2 的可选 `groups` 保存一层分组 `{ id, name, visible, locked? }`；节点使用可选 `groupId` 引用分组。组和对象 ID 必须唯一，引用必须存在；版本 1 不接受分组配置。分组顺序取自 `groups`，组内对象顺序取自 `nodes`，未分组对象也按 `nodes` 排列。折叠、搜索和当前选择由宿主维护，不保存到协议。

```ts
import { getCityNodeState, moveCityNodes, removeCityGroup } from '@desktop-webgis/cesium-scene-schema'

city.groups = [{ id: 'buildings', name: '建筑', visible: true }]
const grouped = moveCityNodes(city, ['blocks'], 'buildings')
const state = getCityNodeState(grouped, grouped.nodes[0]) // 实际 visible / locked
const ungrouped = removeCityGroup(grouped, 'buildings') // 保留对象与实际显隐
```

`moveCityNodes` 返回独立场景，不修改输入；省略分组参数表示移出分组，省略插入目标表示移到末尾。任意源对象、源组或目标组锁定时整批拒绝，避免部分移动。`removeCityGroup` 拒绝解散锁定组。实际显隐为对象与分组显隐的交集，实际锁定为两者锁定的并集；隐藏和解锁分组不会覆盖成员自身设置。宿主将返回配置接入自己的撤销和持久化系统。
