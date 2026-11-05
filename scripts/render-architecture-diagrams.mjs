import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import rough from 'roughjs'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../docs/architecture')
const gen = rough.generator()
const font = 'KaiTi, STKaiti, 楷体, Segoe Print, Comic Sans MS, cursive'
const ink = '#1e1e1e'
const muted = '#495057'

const palette = {
  blue: '#a5d8ff',
  blueSoft: '#d0ebff',
  violet: '#d0bfff',
  green: '#b2f2bb',
  yellow: '#ffec99',
  orange: '#ffd8a8',
  gray: '#e9ecef',
  paper: '#fffef9'
}

function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function pathOf(ops) {
  return ops.map((op) => {
    const n = op.data.map((value) => Math.round(value * 10) / 10)
    if (op.op === 'move') return `M ${n[0]} ${n[1]}`
    if (op.op === 'lineTo') return `L ${n[0]} ${n[1]}`
    return `C ${n[0]} ${n[1]} ${n[2]} ${n[3]} ${n[4]} ${n[5]}`
  }).join(' ')
}

function draw(drawable) {
  const { stroke, strokeWidth, fill } = drawable.options
  return drawable.sets.map((set) => {
    const d = set.path || pathOf(set.ops)
    if (set.type === 'path') {
      return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`
    }
    return `<path d="${d}" fill="${fill}" stroke="none"/>`
  }).join('')
}

function sketchOptions(seed, fill) {
  return {
    seed,
    roughness: 1.35,
    bowing: 1.15,
    stroke: ink,
    strokeWidth: 1.8,
    fill,
    fillStyle: 'solid',
    disableMultiStroke: true
  }
}

function scene(width, height) {
  let seed = 3
  const shapes = []
  const labels = []
  const nextSeed = () => { seed += 11; return seed }

  function box(x, y, w, h, fill, lines) {
    shapes.push(draw(gen.rectangle(x, y, w, h, sketchOptions(nextSeed(), fill))))
    const gap = 5
    const total = lines.reduce((sum, line) => sum + line.size, 0) + gap * (lines.length - 1)
    let top = y + (h - total) / 2
    for (const line of lines) {
      labels.push(
        `<text x="${x + w / 2}" y="${top + line.size / 2}" text-anchor="middle" dominant-baseline="middle" font-family="${font}" font-size="${line.size}" fill="${line.color ?? ink}">${esc(line.t)}</text>`
      )
      top += line.size + gap
    }
  }

  function title(x, y, text, size = 26) {
    labels.push(
      `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" fill="${ink}">${esc(text)}</text>`
    )
  }

  function note(x, y, text) {
    labels.push(
      `<text x="${x}" y="${y}" font-family="${font}" font-size="15" fill="${muted}">${esc(text)}</text>`
    )
  }

  function arrow(x1, y1, x2, y2) {
    const dx = x2 - x1
    const dy = y2 - y1
    const length = Math.hypot(dx, dy) || 1
    const ux = dx / length
    const uy = dy / length
    const tip = 11
    shapes.push(draw(gen.line(x1, y1, x2 - ux * tip, y2 - uy * tip, {
      seed: nextSeed(),
      roughness: 1.2,
      bowing: 0.8,
      stroke: ink,
      strokeWidth: 1.6,
      disableMultiStroke: true
    })))
    const px = -uy
    const py = ux
    const bx = x2 - ux * tip
    const by = y2 - uy * tip
    shapes.push(draw(gen.polygon([
      [x2, y2],
      [bx + px * 5.5, by + py * 5.5],
      [bx - px * 5.5, by - py * 5.5]
    ], {
      ...sketchOptions(nextSeed(), ink),
      roughness: 0.7,
      bowing: 0.4,
      strokeWidth: 1.2
    })))
  }

  function svg() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${palette.paper}"/>
  ${shapes.join('\n  ')}
  ${labels.join('\n  ')}
</svg>
`
  }

  return { box, title, note, arrow, svg }
}

function write(name, markup) {
  writeFileSync(join(outDir, name), markup)
}

function desktopLayers() {
  const s = scene(1120, 900)
  s.title(40, 48, 'apps/desktop/src 是五层，不是一条直线')
  s.note(40, 76, '往下的箭头是依赖方向。同一行里的模块平级，横箭头才表示谁用谁。')

  const y1 = 104
  const h1 = 132
  const w1 = 316
  s.box(40, y1, w1, h1, palette.blue, [
    { t: 'ui/workbench', size: 20 },
    { t: '工作台外壳', size: 16, color: muted },
    { t: 'App · 二维 / 三维工作台 · 菜单', size: 14, color: muted }
  ])
  s.box(402, y1, w1, h1, palette.blue, [
    { t: 'ui/panels', size: 20 },
    { t: '业务面板', size: 16, color: muted },
    { t: '图层 · 地图 · 检查器 · 属性表 · 三维', size: 14, color: muted }
  ])
  s.box(764, y1, w1, h1, palette.blueSoft, [
    { t: 'ui/components', size: 20 },
    { t: '通用控件', size: 16, color: muted },
    { t: '按钮 · 弹窗 · 样式', size: 14, color: muted }
  ])
  s.arrow(356, y1 + h1 / 2, 402, y1 + h1 / 2)
  s.arrow(718, y1 + h1 / 2, 764, y1 + h1 / 2)

  const y2 = 292
  s.arrow(560, y1 + h1, 560, y2)
  s.box(40, y2, 1040, 96, palette.violet, [
    { t: 'commands', size: 20 },
    { t: '用户操作的入口。改工程、改要素、切工具，都先到这里。', size: 16, color: muted }
  ])

  const y3 = 444
  s.arrow(560, y2 + 96, 560, y3)
  s.box(40, y3, 500, 128, palette.green, [
    { t: 'engine-host', size: 20 },
    { t: '把工程画出来', size: 16, color: muted },
    { t: 'OpenLayers 宿主 · Cesium 宿主', size: 14, color: muted }
  ])
  s.box(580, y3, 500, 128, palette.green, [
    { t: 'io', size: 20 },
    { t: '文件和服务', size: 16, color: muted },
    { t: '导入导出 · WFS · SceneDocument', size: 14, color: muted }
  ])

  const y4 = 612
  s.arrow(290, y3 + 128, 290, y4)
  s.arrow(830, y3 + 128, 830, y4)
  const w4 = 316
  s.box(40, y4, w4, 132, palette.yellow, [
    { t: 'stores', size: 20 },
    { t: '界面状态', size: 16, color: muted },
    { t: '选中、面板、当前工具', size: 14, color: muted },
    { t: '关掉工程就可以丢', size: 14, color: muted }
  ])
  s.box(402, y4, w4, 132, palette.orange, [
    { t: 'project', size: 20 },
    { t: '当前工程', size: 16, color: muted },
    { t: '配置 · 撤销 · 保存与恢复', size: 14, color: muted }
  ])
  s.box(764, y4, w4, 132, palette.yellow, [
    { t: 'project/datasets', size: 20 },
    { t: '要素表', size: 16, color: muted },
    { t: '基线 Provider + 未保存 Buffer', size: 14, color: muted }
  ])
  s.arrow(356, y4 + 66, 402, y4 + 66)
  s.arrow(718, y4 + 66, 764, y4 + 66)

  const y5 = 792
  s.arrow(560, y4 + 132, 560, y5)
  s.box(40, y5, 1040, 68, palette.gray, [
    { t: 'platform    本机文件、对话框、凭据、HTTP。Tauri 和浏览器的差别留在这里。', size: 16 }
  ])
  return s.svg()
}

function fullstack() {
  const s = scene(1120, 980)
  s.title(40, 48, '从工作台到 OpenLayers / Cesium')
  s.note(40, 76, '左边走二维，右边走三维。两边在场景文档和系统底座汇合。')

  s.box(40, 104, 760, 110, palette.blue, [
    { t: 'apps/desktop', size: 20 },
    { t: 'ui 工作台与面板  ·  commands 用户操作  ·  stores 界面状态', size: 16, color: muted }
  ])
  s.box(820, 104, 260, 110, palette.violet, [
    { t: 'apps/viewer', size: 20 },
    { t: '只读发布页', size: 16, color: muted },
    { t: '不带编辑器', size: 14, color: muted }
  ])

  s.arrow(420, 214, 420, 250)
  s.box(40, 250, 1040, 118, palette.orange, [
    { t: 'project  +  project/datasets  +  io', size: 20 },
    { t: '工程配置、撤销历史、要素表，以及导入导出', size: 16, color: muted },
    { t: 'io 把工程投影成 SceneDocument，viewer 读的就是这份文档', size: 15, color: muted }
  ])

  s.arrow(300, 368, 300, 404)
  s.arrow(820, 368, 820, 404)
  s.box(40, 404, 500, 128, palette.green, [
    { t: '二维引擎', size: 20 },
    { t: 'engine-host/map-runtime-host', size: 15, color: muted },
    { t: 'ol-runtime · ol-scene-runtime', size: 15, color: muted }
  ])
  s.box(580, 404, 500, 128, palette.green, [
    { t: '三维引擎', size: 20 },
    { t: 'engine-host/scene3d-runtime-host', size: 15, color: muted },
    { t: 'cesium-scene-runtime · scene-core', size: 15, color: muted }
  ])

  s.arrow(290, 532, 290, 568)
  s.arrow(830, 532, 830, 568)
  s.box(40, 568, 500, 128, palette.blueSoft, [
    { t: 'packages/public  二维', size: 20 },
    { t: 'ol-style · ol-selection', size: 16, color: muted },
    { t: 'ogc-io · vector-io', size: 16, color: muted }
  ])
  s.box(580, 568, 500, 128, palette.blueSoft, [
    { t: 'packages/public  三维', size: 20 },
    { t: 'cesium-layer · tileset-edit', size: 16, color: muted },
    { t: 'measure · effects · popup', size: 16, color: muted }
  ])

  s.arrow(290, 696, 290, 748)
  s.arrow(830, 696, 830, 748)
  s.box(40, 748, 500, 88, palette.gray, [
    { t: 'OpenLayers 10', size: 20 },
    { t: 'Canvas / WebGL 地图', size: 15, color: muted }
  ])
  s.box(580, 748, 500, 88, palette.gray, [
    { t: 'CesiumJS', size: 20 },
    { t: 'WebGL 三维场景', size: 15, color: muted }
  ])
  s.box(40, 864, 1040, 72, palette.gray, [
    { t: 'platform + Tauri    文件、凭据、HTTP。可发布包不认识 Desktop 里的工程。', size: 16 }
  ])
  return s.svg()
}

function desktopUi() {
  const s = scene(1120, 760)
  s.title(40, 46, '工作台：一块画布，面板浮在上面')
  s.note(40, 74, '开合侧栏不改变地图或三维视口的中心。')

  s.box(40, 100, 1040, 72, palette.blue, [
    { t: 'App', size: 20 },
    { t: '菜单栏 · 二维工具条 · 新建 / 打开 / 导入 / 导出', size: 16, color: muted }
  ])

  s.arrow(300, 172, 300, 208)
  s.arrow(820, 172, 820, 208)

  s.box(40, 208, 500, 64, palette.green, [
    { t: 'Workspace2D  二维地图', size: 18 }
  ])
  s.box(580, 208, 500, 64, palette.violet, [
    { t: 'Workspace3D  三维场景', size: 18 }
  ])

  s.box(40, 292, 500, 78, palette.blueSoft, [
    { t: 'MapCanvas', size: 18 },
    { t: '铺满的 OpenLayers 画布 · 弹窗 · 点选', size: 14, color: muted }
  ])
  s.box(580, 292, 500, 78, palette.blueSoft, [
    { t: 'SceneRibbon + Cesium 视口', size: 18 },
    { t: '绘制、变换、裁剪、压平、量算', size: 14, color: muted }
  ])

  s.box(40, 388, 240, 110, palette.yellow, [
    { t: '左侧', size: 18 },
    { t: '图层树', size: 15, color: muted },
    { t: '搜索 · 分组', size: 14, color: muted }
  ])
  s.box(300, 388, 240, 110, palette.yellow, [
    { t: '右侧', size: 18 },
    { t: '检查器', size: 15, color: muted },
    { t: '信息 · 空间处理', size: 14, color: muted }
  ])
  s.box(580, 388, 240, 110, palette.orange, [
    { t: '左侧', size: 18 },
    { t: '场景树', size: 15, color: muted },
    { t: '显隐 · 锁定 · 排序', size: 14, color: muted }
  ])
  s.box(840, 388, 240, 110, palette.orange, [
    { t: '右侧', size: 18 },
    { t: '对象检查器', size: 15, color: muted },
    { t: '光照 · 地形 · 画质', size: 14, color: muted }
  ])

  s.box(40, 516, 500, 72, palette.green, [
    { t: '底部属性表', size: 18 },
    { t: '多图层表 · 字段计算 · 过滤', size: 14, color: muted }
  ])
  s.box(580, 516, 500, 72, palette.violet, [
    { t: '底部任务与诊断', size: 18 },
    { t: '加载日志 · 点一下定位到对象', size: 14, color: muted }
  ])

  s.box(40, 608, 500, 88, palette.gray, [
    { t: '浮动窗', size: 18 },
    { t: '图层属性 · 制图规则 · 过滤器', size: 15, color: muted }
  ])
  s.box(580, 608, 500, 88, palette.gray, [
    { t: '浮动窗', size: 18 },
    { t: '三维属性 · 代码导出 · 资源重定位', size: 15, color: muted }
  ])
  return s.svg()
}

write('desktop-layers.svg', desktopLayers())
write('fullstack-architecture.svg', fullstack())
write('desktop-ui.svg', desktopUi())
console.log('wrote 3 diagrams')
