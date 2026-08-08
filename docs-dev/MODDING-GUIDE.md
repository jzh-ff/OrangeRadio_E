# OrangeSea（橘子海）二次开发指南

> 配套阅读：[ARCHITECTURE.md](./ARCHITECTURE.md)。本文聚焦「改哪里、怎么改」。

## 一、开发环境

```bash
npm install        # 安装依赖（Electron 较大，耐心等待）
npm start          # 开发运行（electron .）
npm test           # 跑全部 tests/*.test.js（脚本式 + node:test）
npm run build:win  # 打包 NSIS 安装包 → dist/
```

- 前端无构建步骤，改 `public/` 下文件后重启应用即可（或主窗口内刷新）
- 启动故障排查：看 `%AppData%\OrangeSea\startup-state.json` 和 `startup-error.log`
- 后端端口随机，前端同源 fetch，无需关心端口
- 静态守卫：`node scripts/quick-check.js`（`quick-check.bat full` 带 Electron 冒烟）

## 二、方向 A：UI / 视觉定制

按改动收益排序：

### 1. 全局配色（性价比最高）
- `public/css/index.css:288-349` — 四个 `:root` 块：
  - `:288-319` 主色板：`--fc-bg/--fc-paper/--fc-ink/--fc-accent/--fc-accent-rgb/--home-accent/--visual-tint/--champagne/--chill-*`
  - `:321-328` 玻璃材质：`--glass-bg/--glass-border/--glass-shadow*`
  - `:344-349` 图标色
- 同步改视觉默认值：`public/js/modules/00-state/04-fx-defaults.js:9-195`（约 120 个 fx 字段）
- 同步改首启存档：`public/default-user-fx-archive.json`（保证新用户首启一致）

### 2. 启动 splash
- DOM：`public/index.html:80-95`（`.splash-wordmark` 字标 + `.splash-sub` 标语）
- 样式：`public/css/index.css:1215-1316`（金/青/红渐变硬编码在此）
- 动效：`public/js/modules/10-shell/03-splash.js`（WebGL 噪声 + 音效节奏）

### 3. 视觉预设（新增/改名/改图标）
- 预设元数据：`public/js/modules/07-fx/00-preset-archive-data.js:2-23`（presetMeta + presetIcons + presetDisplayOrder，当前 9 个预设 0-8）
- 新增预设需四处联动：
  1. `00-state/00-core-stores.js:101-109` — `MAX_VISUAL_PRESET_INDEX` 与 `LEGACY_REMOVED_VISUAL_PRESET_INDEX`（追加在末尾时无需平移 `SONIC_PRESET_INDEX=7`；哨兵值要与新索引错开）
  2. `02-visual/00-pointer-cover-particles.js` — 顶点 shader 的 `uPreset` 分支链（参照 `uPreset < 8.5` 演唱会分支）
  3. `11-main-loop.js` — 音频映射（`fx.preset >= 4` 自动走"新视觉"整形，无需改；如需要独立行为再改）
  4. `07-fx/04-preset-grid-uniforms.js:82-118` — setPreset 链路（清理/加载预设专属资源，如骷髅点云、音域地形、聚光灯层）
- 新增预设时同步更新：`scripts/quick-check.js` 守卫断言、`09-console-workspace.js` hint 文案、可选 `01-orbit-free-camera.js` 相机基线

### 4. 玻璃拟态风格
- SVG 滤镜：`public/index.html:1113-1200`（4 个 `feDisplacementMap`）
- 动画：`public/js/modules/05-playback/15-control-glass-animations.js`

### 5. 桌面歌词样式
- `public/desktop-lyrics.html`（整文件 1237 行）：`:8-32` 变量、`:179-183` 入场动画、`:225` 默认文本、`:232-233` 颜色四元组

### 6. 首页仪表盘
- `public/js/modules/05-playback/03a-home-dashboard.js`、`03-home-discover-weather.js`、`04-home-empty-wallpaper.js`
- DOM：`public/index.html:163-309`

## 三、方向 B：功能新增

### 新增桌面能力（IPC 三件套）
1. `desktop/main.js` 加 `ipcMain.handle`（参照 `main.js:4520-5451` 现有模式，务必用 `isTrustedMainWindowIpc(event)` 校验）
2. `desktop/preload.js` 加 contextBridge 暴露方法
3. 前端 `window.desktopWindow.xxx()` 调用

### 新增后端端点
- `server/routes/` 下新增路由模块（参照 `routes/local.js` 最小实现），导出 `async handle(req, res, url)`，命中返回 `true`
- 在 `server.js:22-38` 的 `routeModules` 数组按分发顺序注册（放在 static 兜底之前）
- 共享状态/常量收敛到 `server/context.js`，纯工具放 `server/utils.js`

### 新增音源平台（工作量大，参照已有平台对称结构）
1. 新建 `xxx-api.js`（参考 `kugou-api.js`），导出 `handleXxxSearch / handleXxxSongUrl / handleXxxLyric` + 登录系列 + 歌单/收藏系列
2. `server/`：
   - `server/context.js` — cookie 文件常量 + store 注册（仿 `configuredCookieStores`）+ 缓存 Map
   - `server/routes/xxx.js` — 约 10 条对称路由（仿 `routes/kugou.js`）
   - `routes/system.js` — `/api/platform/capabilities` 加能力声明
3. `desktop/main.js`：登录 IPC（仿现有五平台模式）+ 凭据迁移
4. 前端：搜索 tabs（`public/index.html`）、平台色 `--source-xxx`、登录 UI
5. `package.json` build.files（`*-api.js` 通配已覆盖单文件；新子目录需单独加）
6. 若音源加密：参照 `qishui-audio-decryptor/` + `utils.js` 的汽水解密/`routes/proxy.js` `/api/audio` 解密分支

### 不需要动的部分
`dj-analyzer.js`、`cuefield/*` 与具体音源无关（只消费 beatmap），新增平台自动受益。

## 四、方向 C：换皮重塑品牌

### 必改清单（按文件）

| 文件 | 位置 | 内容 |
|---|---|---|
| `package.json` | `:2-3, 17-18, 47, 65, 72, 82-87` | name/productName/appId(`com.mineradio.desktop`)/可执行名/快捷方式/安装包名/更新仓库 owner+repo |
| `desktop/main.js` | `:100-110` | APP_METADATA/APP_NAME/APP_USER_MODEL_ID（决定 %AppData% 目录名、托盘、窗口标题） |
| `desktop/main.js` | `:274-303` | **硬编码 `D:\MineradioCache` 缓存目录名，必须改**，否则与原版缓存互相污染 |
| `public/index.html` | `:7` | `<title>` |
| `public/index.html` | `:80-95` | splash 字标 DOM（Mine/rad/i/o 结构） |
| `public/index.html` | `:346, 1728` | FX 控制台 / 更新弹窗 kicker |
| `public/index.html` | `:21-60` | 标题栏 app-mark/app-title |
| `public/index.html` | `:1116, 1142, 1168, 1194` | 玻璃 SVG 滤镜 id（含 mineradio 前缀，CSS 有 url(#...) 引用需同步） |
| `public/css/index.css` | `:1215-1316` | splash 字标样式 |
| `public/desktop-lyrics.html` | `:6, 190, 225, 573, 754, 950` | 桌面歌词品牌文本 |
| `build/icon.ico` | — | 应用图标（256x256 多尺寸 ico） |
| `public/js/modules/00-state/00-core-stores.js` | `:91-161` | `mineradio-*-v1` localStorage 命名空间（避免与原版共存冲突） |
| `public/js/modules/07-fx/00-preset-archive-data.js` | `:44-52` | 存档类型串 `orangesea-user-fx-archive` + 分享码前缀 `OS2` |
| 全局桥名 | 多处 | `window.OrangeseaSonicTopography`、`window.__mineradioPerf` 等 |
| `package.json` | `mineradio.update` | 指向自己的 repo，或 `provider:"none"` 整体禁用更新 |

### 换皮注意事项
1. **法律**：GPL-3.0 要求衍生作品开源；**不得使用 Mineradio 名称与 Logo**（归作者所有）；需更换自己的品牌标识
2. **更新通道**：不改 owner/repo 的话，你的用户会去检查原作者的 release → 可能出现"自动更新把二创刷回原版"的灾难
3. **用户数据隔离**：APP_NAME 决定 `%AppData%` 目录，缓存目录决定 D 盘文件夹，两者都必须改，否则与原版互相读写
4. **全局搜索兜底**：改完后 `grep -ri "mineradio" --include="*.js" --include="*.html" --include="*.css" --include="*.json"` 检查残留

## 五、验证与打包

```bash
npm start                                    # 开发验证
npm run build:win                            # 正式包
npm run build:win:dir                        # 免安装目录版（快速验证打包内容）
npm run build:win:internal-beta              # 内测通道包
```

打包后必测：首次启动 → 搜索播放 → 歌词舞台 → 预设切换 → 桌面模式 → 更新检测（确认指向新 repo 或已禁用）。

## 附录：国内打包环境配置

electron-builder 默认从 GitHub 下载 winCodeSign 会超时。打包前设置镜像环境变量：

```bash
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run build:win:dir   # 或 build:win
```

首次打包约需 3-5 分钟（下载 Electron + winCodeSign + 解压 + after-pack 注入图标）。产物在 `dist/win-unpacked/OrangeSea.exe`。
