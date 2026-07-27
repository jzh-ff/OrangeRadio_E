# Mineradio 技术架构文档

> 基于 Mineradio 2.0.2（commit `4abaa19`）源码分析整理，供二次开发参考。

## 一、总体架构

Mineradio 是「**Electron 主进程 + 同进程内嵌 Node 后端 + 本地 HTTP 前端页面**」三层结构：

```
┌─────────────────────────────────────────────────────┐
│ Electron 主进程 (desktop/main.js, 6175 行)            │
│  ├─ 窗口管理（主窗口/桌面歌词 overlay/登录弹窗/托盘）    │
│  ├─ IPC 桥（70 个 ipcMain.handle + 7 个 on）          │
│  ├─ 完整桌面模式 / 壁纸引擎模式（PowerShell+C# P/Invoke）│
│  └─ require(server.js) 启动内嵌后端 ──┐               │
└───────────────────────────────────────┼───────────────┘
                                        │
┌───────────────────────────────────────▼───────────────┐
│ Node 后端 (server.js, 7293 行, 原生 http 模块)          │
│  监听 http://127.0.0.1:<随机端口>                       │
│  ├─ 静态托管 public/ 前端                               │
│  ├─ 五平台音乐 API 聚合（网易/QQ/酷狗/汽水/Spotify）      │
│  ├─ 汽水音频 AES-CTR 解密（qishui-audio-decryptor/）    │
│  ├─ 节奏分析（dj-analyzer.js）+ DJ 转场规划（cuefield/）│
│  └─ 自研更新检查/下载（GitHub Releases + 镜像）          │
└───────────────────────────────────────▲───────────────┘
                                        │ fetch /api/*
┌───────────────────────────────────────┴───────────────┐
│ 前端 (public/index.html + js/modules/ 约 100 个模块)     │
│  纯原生 JS + Three.js(r128) + GSAP，无框架无构建         │
│  ├─ 粒子舞台 / 3D 歌词舞台 / 3D 歌单架 / 电影镜头        │
│  ├─ 首页仪表盘 / 搜索 / 播放控制 / 视觉控制台            │
│  └─ 视觉存档系统（localStorage + MR2 分享码）            │
└─────────────────────────────────────────────────────┘
```

**关键特征**：
- 后端不 spawn 子进程，由主进程 `require()` 同进程加载（`desktop/main.js:5671-5702`）
- 端口从 3000 起自动探测空闲端口，注入 `PORT`/`HOST` 环境变量
- 所有平台原生能力（桌面嵌入、壁纸捕获）通过 **PowerShell + Add-Type 内嵌 C#** 实现，无二进制原生模块
- 敏感 IPC 均校验发送者 URL 必须是本地服务源（`isTrustedMainWindowIpc`，`main.js:754-777`）

## 二、启动流程

1. `desktop/main.js:6041-6079` — 单实例锁 → `app.whenReady()` → 注册 wallpaper 自定义协议 → `createWindow()`
2. `createWindowOnce()`（`main.js:5756-6025`）：
   - 计算 16:9 窗口边界（`main.js:4065`）
   - 创建无边框透明主窗口（`frame:false, transparent:true`，preload = `desktop/preload.js`）
   - 先加载 `desktop/startup.html` 启动页（3.5s 看门狗兜底）
   - `ensureLocalServerStarted()` → 找端口 → 注入环境变量 → `require(server.js)` → 等待 listening + HTTP 探活
   - 主窗口导航到 `http://127.0.0.1:<port>/`，失败重试 1 次
   - 全程写 `startup-state.json` 诊断日志

## 三、窗口体系

| 窗口 | 实现 | 说明 |
|---|---|---|
| 主窗口 | `main.js:5770-5792` | 无边框透明圆角，唯一主 UI |
| 桌面歌词 overlay | `createDesktopLyricsWindow()` `main.js:4361-4425` | 920x190 透明、不聚焦、screen-saver 级置顶，加载 `/desktop-lyrics.html` |
| 完整桌面模式 | `desktop/full-desktop-mode-runtime.js`（仅 Win32） | 不新建窗口，把主窗口 HWND **重父级到 Explorer 桌面层**（DefView/图标 ListView 之下），支持图标镂空与指针路由 |
| 壁纸引擎模式 | `desktop/wallpaper-engine-runtime.js`（4048 行） | 启动 Wallpaper Engine 场景，经 Windows Graphics Capture / DWM thumbnail 捕获画面合成到渲染层，FPS 跟随显示器（24~240） |
| 登录弹窗 | `main.js:123-133` | 五平台各自独立 session partition |
| 系统托盘 | `createOrUpdateTray()` `main.js:2036-2070` | |

Esc 全局快捷键退出桌面模式；Explorer 重启通过 `TaskbarCreated` 钩子自动恢复。

## 四、IPC 通信

- **preload**：`desktop/preload.js:3-119` 暴露 `window.desktopWindow`；overlay 用 `overlay-preload.js` 暴露 `desktopOverlay`
- **70 个 ipcMain.handle**（`main.js:4520-5451`）分类：
  - 窗口控制 / 完整桌面模式 / 内存管理（含 GPU 诊断）
  - 缓存设置 / 歌词缓存（sha256 key、96MB 上限）
  - Wallpaper Engine（13 个 channel）
  - 全局热键 / 数据导入导出 / FX 自动保存（同步 IPC）
  - 五平台登录（`netease/qq/kugou/qishui/spotify-music-open-login`）
  - 更新与重启 / 桌面歌词 / 壁纸模式开关
- **主→渲染广播**：`desktop-window-state`、`mineradio-global-hotkey`、`mineradio-desktop-lyrics-*`、`mineradio-wallpaper-runtime-state` 等

## 五、后端服务（server.js）

### 5.1 框架

纯 Node 原生 `http` 模块，巨型 `createServer` 回调内 `if (pn === '...')` 链式路由，无 Express。入口 `server.js:5276`，导出 server 实例（`server.js:7293`）。

### 5.2 路由分类（全部 `/api/*`）

| 分类 | 代表端点 |
|---|---|
| 元信息 | `/api/app/version`、`/api/platform/capabilities` |
| 更新 | `/api/update/latest`、`/download`、`/download/status`、`/patch` |
| 搜索 | `/api/search`（网易）、`/api/qq/search`、`/api/kugou/search`、`/api/qishui/search`、`/api/spotify/search`、`/api/podcast/search` |
| 播放链接 | `/api/song/url`、`/api/{qq,kugou,qishui,spotify}/song/url`（Spotify 恒 `playable:false` 引导换源） |
| 歌词 | `/api/lyric`、`/api/{qq,kugou,qishui}/lyric` |
| 登录 | 各平台 `login/cookie`、`login/status`、`logout`；网易另有扫码登录三件套 |
| 歌单/收藏 | `user/playlists`、`playlist/tracks`、`song/like`、`album/subscribe` 等（五平台 URL 模式高度对称） |
| 节奏分析 | `/api/beatmap/cache*`、`/api/cuefield/transition`、`/api/podcast/dj-beatmap` |
| 媒体代理 | `/api/cover`（图片，强制 163 Referer）、`/api/audio`（音频，支持 Range；`#auth=` 走汽水解密） |
| 其他 | `/api/discover/home`、`/api/weather/radio`、`/api/listen/report` |

### 5.3 平台接入职责

| 平台 | 模块 | 方式 |
|---|---|---|
| 网易云 | server.js 内 + `NeteaseCloudMusicApi` 官方 SDK（约 50 个 API） | 默认/兜底平台 |
| QQ 音乐 | server.js 主体 + `qq-vip-api.js`（565 行，仅 VIP 状态判定） | cookie + musickey |
| 酷狗 | `kugou-api.js`（1795 行，完整自实现） | 多通道签名（Android/Web/H5/Gateway） |
| 汽水 | `qishui-api.js`（3605 行，最重） | OAuth/扫码登录，音源加密 |
| Spotify | `spotify-api.js`（1480 行） | OAuth + Web API，仅元数据/歌单，不产出音频 |

### 5.4 汽水音频解密

`qishui-audio-decryptor/`：`spade_a` 密钥（XOR+bitCount 混淆解密）→ 解析 MP4 box（stsz/stsc/senc）→ AES-128-CTR 逐 sample 解密 → 重组为 `.flac` 或 `.m4a`。`/api/audio` 路由检测 `#auth=` 触发，内存 LRU 缓存 96MB。

### 5.5 节奏分析体系

- **`dj-analyzer.js`**（864 行）：流式 MP3 解码（mpg123-decoder）→ 32Hz 高通 + 178Hz 低通保留 kick 频段 → 10ms hop 聚合 RMS/peak → 差分 onset + 自适应阈值 → 网格吸附估计 BPM → 产出 kicks/beats/pulseBeats/cameraBeats 四组时间戳。长音频按 Range 分段抽样
- **`cuefield/`**：DJ 转场规划器，消费 beatmap 缓存（不含音频处理）：小节密度曲线（cue-profile）→ 候选 exit/entry 点（section-candidates）→ 兼容性评估（transition-evaluator）→ 转场配方时间线（recipe-planner）→ LRC 人声窗口避让（lrc-anchors）→ 用户反馈记录（feedback-log）

## 六、前端架构

### 6.1 技术栈

纯原生 JS + Three.js r128 + GSAP + music-tempo（BPM worker），全部 vendored。**无框架、无构建步骤**：`public/js/index-loader.js:3-124` 用同步 XHR 把 `js/modules/` 约 100 个 `.js` 按数字前缀顺序拼接注入，全局变量共享。

### 6.2 模块划分（js/modules/ 数字前缀）

| 前缀 | 职责 |
|---|---|
| `00-state/` | 核心状态、fx 默认值（`04-fx-defaults.js:9-195`）、打包存档 |
| `01-scene/` | 渲染器画质、电影镜头相机、自由相机 |
| `02-visual/` | 粒子舞台、3D 歌词舞台（`14-stage-lyrics-rendering.js` 154KB 最大）、星河、涟漪 |
| `03-beat/` | BPM worker、封面加载裁剪 |
| `04-shelf/` | 3D 歌单架（PSP 风格卡片） |
| `05-playback/` | API 封装、搜索、首页仪表盘、播放控制、玻璃动画 |
| `06-lyrics/` | 播放列表面板、歌单详情、进度条 |
| `07-fx/` | 视觉控制台、预设网格、用户存档 |
| `08-account/` | 登录状态 |
| `10-shell/` | splash、桌面模式控制坞 |
| `11-main-loop.js` | 主渲染循环：帧门控 → 频谱分析 → 节拍引擎 → uniforms → 各子系统 tick → render |

### 6.3 视觉预设切换

`07-fx/04-preset-grid-uniforms.js:67-99` `setPreset(p)`：写 uniform → 清理/加载预设资源（如骷髅点云 `assets/skull-decimation-points.bin`）→ 涟漪+相机 punch 过渡 → 切换相机基线 → 持久化。共 8 个预设（0-7，含 Sonic Topography 音域地形）。

### 6.4 主题系统

CSS 变量集中在 `public/css/index.css:288-349` 四个 `:root` 块（灰阶/品牌色/玻璃材质/图标色）。主题切换 = 运行时改写 CSS 变量（`07-fx/02-accent-background-controls.js:617-653`），无预设皮肤机制。

### 6.5 视觉存档

双层持久化：当前自动保存 `mineradio-current-fx-autosave-v1`（localStorage，约 120 个字段）+ 命名存档槽 `mineradio-user-fx-archives-v1`。支持 `MR2` 前缀 base64url（可选 gzip）分享码导入导出。

## 七、数据存储

**用户数据根目录**：`%AppData%\Mineradio`（`app.setName` 钉死，`main.js:142-145`）

| 文件 | 内容 |
|---|---|
| `.cookie` / `.qq-cookie` / `.kugou-cookie` / `.qishui-cookie` / `.spotify-token.json` 等 | 五平台凭据 |
| `current-fx-autosave.json` | 视觉特效自动保存（12MB 上限） |
| `cache-settings.json` | 缓存根目录配置 |
| `startup-state.json` / `startup-error.log` | 启动诊断 |
| `desktop-behavior.json` | 关闭行为偏好 |

**缓存目录**：默认 `D:\MineradioCache`（D 盘存在时，否则回退 userData/cache；`main.js:274-303`），下分 `lyrics/`（96MB LRU）、`chromium/`、`beatmaps/`、`updates/`、`native-helper-temp/`。**C 盘被禁止用于 beatmap 缓存**（`server.js:762-768`）。

## 八、自动更新

自研方案（非 electron-updater）：
1. 配置源：`package.json` 的 `mineradio.update` 段（可被 `MINERADIO_UPDATE_*` 环境变量覆盖）
2. 检查：`/api/update/latest` → GitHub Releases API → 回退 latest.yml → 本地 fallback
3. 下载：`/api/update/download` → 镜像列表轮询（gh.llkk.cc / ghfast.top / gh-proxy.com）→ sha256/sha512 校验
4. 安装：`mineradio-open-update-installer` IPC，强制校验路径必须在更新目录内

## 九、打包构建

- `npm run build:win` → electron-builder NSIS 安装包（`Mineradio-{version}-Setup.exe`），产物 `dist/`
- `asar: false`，文件直拷；`signAndEditExecutable: false`（未签名）
- 内测通道：`electron-builder.internal-beta.json`
- 打包清单见 `package.json:27-44` 的 `build.files`

## 十、授权

GPL-3.0。衍生作品对外分发必须以 GPL-3.0 开源并保留版权声明；MR Logo、Mineradio 名称与原创视觉表达归作者所有，**换皮分发时不能使用 Mineradio 名称与 Logo**。
