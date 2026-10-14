# 项目恢复草稿

恢复草稿是本机的未保存工作副本，与正式 `.webgis.json` 分开管理。正式保存继续通过同目录临时写入与原子替换完成；草稿写入失败不改变项目内容、dirty、Undo/Redo 或正式文件。

## 写入与保留

- 文档修改后空闲 5 秒写入一次，持续编辑时每 120 秒补充快照；`startRecoveryTracking(delayMs, intervalMs)` 提供参数。页面转入后台时尝试写入，但不承诺异步 IO 在进程退出前完成。
- 保存已应用的图层、几何、属性和三维场景内容，以及所属运行时的地图视图/相机。布局、选择、表格偏好、未应用表单预览和凭据值不进入快照。
- Windows 使用 Tauri `app_local_data_dir()/project-recovery`，浏览器使用 IndexedDB `desktop-webgis-recovery`。浏览器存储及下载证据不能替代原生验收。
- 每份草稿最多 32 MiB，最多 20 个项目，总量 128 MiB；超限拒绝新写入并保留原缓存。已验证草稿保留 30 天，启动检查时清理过期项；损坏或未知版本保留到用户明确舍弃。
- 项目 ID 编码为 UTF-8 十六进制键，不能作为路径使用。原生缓存 API 不接受正式项目路径，检查目录/文件的符号链接，草稿只写入应用自己的缓存目录。
- 前端串行队列和存储层条件写入/删除共同保护版本。Windows 使用独占文件句柄协调不同应用进程，进程退出后由系统释放锁，不留下必须手工清理的锁占用。未完成的原子写入临时文件超过一天后仅按受限命名规则清理。

最后一次成功写入后的新编辑可能尚未进入恢复缓存。界面提示写入失败时，应保存正式项目；恢复机制不表示每次按键都已持久化，也不提供断电无损保证。

## 启动与操作

启动后显示“发现恢复草稿”：

1. 有正式文件路径时先只读比较。内容完全一致的草稿按版本条件清理；内容不同或正式文件不可读取时保留草稿及提示。
2. “恢复草稿”加载完整快照、保留项目/图层/对象 ID，并标为未保存副本。工作文件路径清空；之后通过保存对话框明确选择位置，不自动覆盖可能在外部更新的正式文件。草稿继续保留，确认保存当前版本后清理。
3. “舍弃草稿”仅删除所选缓存版本，不删除正式项目。损坏/未知版本不能恢复，但可以明确舍弃。
4. “暂不处理”保留缓存，下一次启动再次提示。已有其他会话的待处理草稿不会被自动写入覆盖；检查或舍弃遇到版本变化时可用“重新检查”。

新建/打开时明确放弃文档修改，会在实际替换成功后清理该会话草稿；取消文件选择仍保留当前内容和恢复能力。一般工程切换保留前一个脏工程的独立草稿。保存失败、保存期间编辑/切换工程，以及草稿清理期间继续编辑，都不能将旧写入当成当前保存确认。

## 验证与边界

自动化入口：

```powershell
rtk pnpm --filter @desktop-webgis/desktop build
rtk pnpm --filter @desktop-webgis/desktop test
rtk pnpm --filter @desktop-webgis/desktop test:e2e project-recovery.e2e.ts --project=laptop --project=desktop --project=wide
rtk proxy node apps/desktop/scripts/native-recovery-acceptance.mjs
cd apps/desktop/src-tauri
rtk cargo test --lib --locked
```

- `project-recovery.test.ts`：草稿格式、隔离、脱离引用、坏数据、凭据、保留期、写入失败、旧版本舍弃与会话清理。
- `recovery-tracking.test.ts`：修改合并、会话偏好隔离、工程切换、失败重试、明确放弃与取消选择。
- `project-save.test.ts`：写入及清理期间的新修改、会话切换、保存失败和清理失败。
- `project-recovery.e2e.ts`：真实 IndexedDB，编辑属性后关闭/重开、损坏草稿舍弃、三维分组 ID 和光照设置恢复、完整保存和缓存清理。关闭前逐项确认最新编辑已进入缓存。
- Rust 测试：实际 Windows 文件、大小/总量/数量限制、独占句柄、损坏文件版本保护；两个子进程分别在临时写入中和草稿提交后直接退出，父进程检查旧文件完整性和缓存重读。两个子测试默认 ignored，仅由父测试以专用目录运行，不是未执行的验收项。

## Windows Tauri 原生验收

`native-recovery-acceptance.mjs` 编译独立应用标识，在 5197 启动自己的 Vite 服务，通过 9229 连接实际 WebView2。启动后检查 `isTauri`、原生应用标识与应用数据目录，不能用浏览器模拟原生桥。端口已占用时不复用其他实例；结束时仅终止自己启动的进程树，并重新构建普通 debug 配置。独立测试缓存和 WebView 配置保留在测试命名空间，不使用日常应用缓存。

2026-10-14 最终运行通过两组实际 Tauri 进程强制退出/重启：

- 二维先保存 value=2 的正式文件，再通过属性表计算改为 42，核对 Windows 草稿文件中的新值后强制结束应用。重启恢复后完整 Dataset/Layer/Feature 内容及 ID 一致，旧正式文件逐字节不变，原生另一个工作文件保存完成后缓存为空。
- 三维加载真实 GLB，保存基准项目，将等比缩放改为 2，检查原生缓存后强制退出。重启重新加载模型，参数、对象 ID、节点和资源一致；原生保存及草稿清理通过。渲染显隐对照：51,355 个签名像素降至 14,806 个背景像素，再恢复至 51,348 个，证明目标模型确实重新显示。

实际 WebView viewport 为 1037×648，devicePixelRatio 约 1.39；这不能替代 Windows 125% 缩放验收。保存用预先绑定的测试工作文件路径，随后点击实际 UI 保存，经过真实原生写入；系统文件选择窗口没有自动化。首次尝试在自动定位飞行中保存时，节点相同而相机从约 2462m 移到约 183m，版本保护正确保留 dirty；最终测试等待视图稳定后保存，没有放宽保存确认或像素断言。

证据：[原生恢复启动截图](../design/desktop-productization/evidence/native-recovery-startup.png)、[恢复后的 GLB 与缩放参数](../design/desktop-productization/evidence/native-city-recovery.png)、[原生运行报告](../design/desktop-productization/evidence/native-recovery-report.json)。报告对应运行标识 `com.desktop-webgis.recovery-acceptance-1791971406313`。

系统文件选择窗口、Windows 125% 缩放、完整本地资源组合及 Tileset 裁剪/压平仍需专项签收。这里的原生 GLB 像素证据不表示 M8 GPU 效果已完成。
