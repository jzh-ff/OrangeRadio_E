# 启动页内置视频（Splash Video Presets）

启动画面（splash）是主窗口网页内的全屏 DOM overlay（`#splash`），背景为一个循环静音的 `<video id="splash-video">`。内置视频共 4 个，与用户自定义 MP4 的关系如下。

## 优先级与行为

```
用户自定义视频（IndexedDB 单槽，设置面板「选择」上传）
  └─ 失败/清空 → 内置视频（设置面板「内置启动视频」段选择）
                    ├─ 选中某个 → 每次启动固定播放该视频
                    ├─ 随机（默认）→ 每次启动随机挑一个
                    └─ 加载失败 → 回退到第一个（splash.mp4），不再循环重试
```

- 偏好键：localStorage `orangesea-splash-preset-v1`，取值 `splash | splash-2 | splash-3 | splash-4 | random`；缺失/非法值视为 `random`。
- 自定义视频的键与存储见 `orangesea-splash-video-meta-v1`（localStorage 元信息）与 IndexedDB `orangesea-splash-video-v1`（blob）。
- 设置入口：DIY 控制台（fx）→ 高级参数 → 「启动与退出」组 → 「内置启动视频」分段按钮；启动页仍在显示时切换即时生效。

## 文件清单

| 文件 | 说明 |
| --- | --- |
| `public/assets/splash/splash.mp4` | 视频一（默认兜底，务必保留） |
| `public/assets/splash/splash-2.mp4` … `splash-4.mp4` | 视频二~四 |
| `public/assets/splash/splash-poster.jpg` … `splash-4-poster.jpg` | 各视频海报（正方形 720x720，启动时也用作唱片封面 `#splash-album-art`） |

规格约定：H.264、1280x720、30fps、**无音轨**（`<video>` 是 muted，音轨纯属浪费体积）、moov 前置（faststart）。

## 代码位置

- `public/js/modules/10-shell/03-splash.js`
  - `SPLASH_VIDEO_PRESETS`：内置清单（id/label/src/poster），**加新视频只需在此追加一项并放置对应文件**；
  - `splashResolvePreset()`：按偏好键解析本次要播的内置视频（random 时随机）；
  - `setSplashPreset(id)`：设置面板切换入口，写偏好并按场景即时生效或提示下次生效；
  - `applySplashVideoSource()`：启动时决定最终 src（自定义 > 内置）；
  - `initSplashVideo()` 的 `error` 监听：任何加载失败统一回退 `SPLASH_VIDEO_PRESETS[0]`。
- `public/index.html`：`#splash-preset-seg` 五段切换按钮（随机/视频一~四）；`#splash-video` 标签的静态 `src="assets/splash/splash.mp4"` 是首屏占位，加载后被 JS 覆盖，**不可删除**（测试断言依赖）。
- `public/js/modules/07-fx/09-console-workspace.js`：控制台搜索目录项 `splash-preset-seg`。
- `server/utils.js`：MIME 表含 `.mp4 → video/mp4`。

## 再加一个内置视频的步骤

1. 准备 mp4（720p H.264 无音轨），放入 `public/assets/splash/`，命名延续 `splash-5.mp4`；
2. 生成海报：`ffmpeg -ss 1 -i splash-5.mp4 -vf "crop=min(iw\,ih):min(iw\,ih),scale=720:720" -frames:v 1 -q:v 3 splash-5-poster.jpg`；去音轨可用 `ffmpeg -i in.mp4 -c:v copy -an -movflags +faststart out.mp4`；
3. 在 `SPLASH_VIDEO_PRESETS` 追加 `{ id: 'splash-5', label: '视频五', src: 'assets/splash/splash-5.mp4', poster: 'assets/splash/splash-5-poster.jpg' }`；
4. 在 `#splash-preset-seg` 追加对应按钮（`data-splash-preset="splash-5"`）。

无打包配置改动（`build.files` 已含 `public/**/*`）；新资源需随 git 提交才会进 CI 与安装包。

## 守卫测试

- `scripts/quick-check.js`（splash 断言组）：断言 `SPLASH_VIDEO_PRESETS`、`function setSplashPreset`、html 的 `splash-preset-seg` 及 workspace 目录项存在；
- `tests/splash-wordmark-layout.test.js`：断言 `splash.mp4`/`splash-poster.jpg` 存在、静态 `src="assets/splash/splash.mp4"` 保留、splashJs 含 `assets/splash/splash.mp4` 字符串；新标识符禁止包含 `CUSTOM_BG_`、`wallpaper-engine`、`.pak`、`audioTide` 子串。
