# 风格电台（Genre Mode）· 音乐风格驱动的视觉模式

> 根据当前歌曲的音乐风格（genre），自动切换整套视觉主题的全屏覆盖层——配色、字体气质、装饰纹理、频谱颜色全部跟随风格变化。

## 功能概述

「风格电台」是 OrangeSea 的独立视觉预设模式，与胶片电台（Film Radio）、涂鸦墙（Graffiti Wall）并列。它用一张不透明的全屏 DOM 覆盖层盖住 3D 场景，把当前歌曲解析到 **12 个视觉族群**之一，并将该族群的主题（CSS 变量）下发到覆盖层，切歌时 ~1.2s 平滑过渡。

12 个视觉族群：

| 族群 | 中文 | 视觉气质 | 装饰层 |
|---|---|---|---|
| electronic | 电子 | 霓虹紫粉 · 等宽字体 | 透视网格地平线 |
| hiphop | 嘻哈 | 金链金 | 粗颗粒噪点 |
| rock | 摇滚 | 红黑对比 | 粗颗粒噪点 |
| metal | 金属 | 钢灰银 · 等宽字体 | 粗颗粒噪点 |
| pop | 流行 | 蜜桃橙粉 | 散景光斑 |
| folk | 民谣 | 暖黄纸质 · 衬线字体 | 纸质纤维纹理 |
| classical | 古典 | 黑金 · 衬线字体 | 五线谱横线 |
| jazz | 爵士 | 蓝调蓝 · 衬线字体 | 散景光斑 |
| soul | 灵魂乐 | 酒红丝绒 · 衬线字体 | 无 |
| ambient | 氛围 | 雾蓝低饱和 | 慢呼吸雾光 |
| anime | 动漫 | 樱花粉紫 | 散景光斑 |
| default | 综合 | 中性玻璃（兜底） | 无 |

## 使用方法

### 开启 / 关闭

在 **DIY 控制台 → 视觉预设网格**中，点击末尾的「**风格电台**」卡片（图标为音符）。

- 点击开启，再次点击关闭
- 状态持久化（localStorage `orangesea-genre-mode-v1`，下次启动恢复）
- 与胶片电台、涂鸦墙、所有数值视觉预设（0~8）**三方互斥**：开启任一模式自动退出其余；切换数值预设自动退出本模式

### 自动跟随 / 手动锁定

覆盖层顶部是族群芯片选择器：

- **自动**（默认）：跟随每首歌自动切换主题。当前跟随到的族群以**描边**高亮
- 点击任意族群芯片：**锁定**该主题，不再跟随切歌（描边变为**实填充**），锁定状态持久化（localStorage `orangesea-genre-lock-v1`）
- 歌曲无任何风格信息时：回落「综合」中性主题

### 风格数据来源（自动判定优先级）

1. **本地文件 ID3 标签**：本地曲库扫描时用 music-metadata 读取 `common.genre`（如 `Synthwave/Electronic`）
2. **Spotify artist.genres**：搜索/歌单/专辑结果批量后补（`/artists` 接口，artist 级进程内缓存，失败静默降级）
3. **播客电台分类**：网易云 djradio 的 category
4. **关键词推断**：中文在线源（网易云/QQ/酷狗/汽水）歌曲级无流派字段，用「艺术家 + 标题 + 专辑」关键词规则表推断（中英文艺人锚点 + 风格词）
5. 全部失败 → `default`

有原始 genre 文本时（来源 1/2），信息区还会显示原始标签小字（如 `thrash metal`）；曲目详情弹窗（歌曲/专辑/歌手三个分支）也会显示「风格」行。

## 技术架构

### 模块组成

| 文件 | 职责 |
|---|---|
| `local-library.js` | 本地扫描：`readMetadataWithLimit` 取 `common.genre` 透传到 song.genre |
| `spotify-api.js` | `attachSpotifyArtistGenres(songs)`：`/artists?ids=` 批量后补，Map 缓存 |
| `public/js/modules/02-visual/16-genre-resolve.js` | `normalizeGenre(text)` 文本归一化 + `inferGenreFamily(song)` 推断主入口，结果缓存 `song.visualGenre`（运行时，不持久化） |
| `public/js/modules/02-visual/17-genre-themes.js` | `GENRE_THEMES` 12 族主题表 + `applyGenreTheme(family)` 下发 `--gm-*` CSS 变量 |
| `public/js/modules/10-shell/09-genre-mode.js` | 模式切换/互斥/状态同步/芯片锁定/频谱/歌词/进度 seek（照抄 film-radio 范式） |
| `public/css/genre-mode.css` | 覆盖层布局 + `data-gm-font`（serif/mono/sans）+ `data-gm-deco`（grid/staff/paper/noise/bokeh/mist/none）装饰纹理 |

### 归一化与推断（16-genre-resolve.js）

```
song.genre ──→ normalizeGenre() ──→ 族群（规则表：anime>classical>metal>electronic>
                                              hiphop>jazz>soul>ambient>rock>folk>pop）
     ↓ 无 genre
播客 category → normalizeGenre()
     ↓ 仍 default
关键词推断 inferGenreFromKeywords()（artist+name+album 过 GENRE_INFER_RULES）
     ↓ 仍 default
'default'，缓存到 song.visualGenre
```

规则表顺序即优先级（更具体的在前，避免被宽泛词抢先：如 `synthpop` 含 `pop` 但归 electronic）。推断表复用并扩充了 `cuefield/transition-evaluator.js` 的艺术家锚点思路，中文侧只用风格词（民谣/古风/电音/说唱…），避免艺人名误判。

### 主题下发与平滑过渡（17-genre-themes.js + genre-mode.css）

- 主题字段：`accent/accent2`（徽章/频谱/进度）、`bg1/2/3`（三段背景渐变）、`ink/muted`（文字）、`glow`（光晕）、`font`（字体气质）、`deco`（装饰层）
- `applyGenreTheme()` 把字段写入 `#genre-overlay` 的 `style.setProperty('--gm-*')` 并设 `data-genre/data-gm-font/data-gm-deco`
- stylesheet 中对 `background-color/color/border-color/box-shadow` 声明 `transition: 1.2s`，变量变化时自动平滑过渡
- 装饰层为纯 CSS 纹理（SVG 噪点 data-uri / repeating-gradient 五线谱 / 透视网格 + mask），零图片请求、零 canvas 开销

### 覆盖层范式（09-genre-mode.js）

照抄 film-radio 范式：

- `applyGenreMode(on, opts)`：`body.genre-mode` class + `html.genre-mode-preload` + localStorage 持久化 + 三方双向互斥 + `refreshPresetGrid()` 联动
- **性能降级**：进入时 `fx.performanceQuality` 临时降为 `'eco'`，退出恢复原档（不写入存档）；覆盖层盖住 3D 场景时主循环自动 0.5fps 保热
- **状态同步**：MutationObserver 监听 `#control-cover/#control-title-text/#control-artist/#progress-fill/#play-icon/#time-display`，零侵入复用标准播放器状态；标题变化 = 切歌 → 触发主题跟随
- **频谱**：48 根 DOM 条，`frequencyData` 对数映射 bin 1..256，rAF 节流 ~30fps
- **歌词**：单行当前歌词，复用 `lyricsLines + findStageLyricIndexAtTime(getAdjustedLyricPlaybackTime())`
- **进度**：`gm-progress` 拖动 seek（pointer capture）

### 互斥接线（三处各加一行）

- `10-shell/06-film-radio.js` `applyFilmRadioMode`：进入时 `applyGenreMode(false, { save: true })`
- `10-shell/08-graffiti-lyrics.js` `applyGraffitiMode`：同上
- `07-fx/04-preset-grid-uniforms.js`：`buildGenreModePresetCard()` 特殊卡片 + `refreshPresetGrid()` 激活态 + `setPreset()` 用户选预设时退出

### 持久化键

| 键 | 含义 |
|---|---|
| `orangesea-genre-mode-v1` | 模式开关（'1'/'0'） |
| `orangesea-genre-lock-v1` | 手动锁定族群（'auto' 或 12 族 id） |

### 其他联动

- `public/js/preload-mode.js`：启动时按存储值预置 `html.genre-mode-preload`，避免首帧闪烁
- `public/css/index.css`：`body.genre-mode #empty-home { z-index: 6 }`（主页浮在覆盖层之上，关掉主页模式仍在）
- `05-playback/06-track-detail-lyrics-actions.js`：曲目详情三个分支（歌曲/专辑/歌手）加「风格」行（`songGenreDisplayText(song)`，无风格不显示）
- 模块注册：`public/js/index-loader.js` 的 `modulePaths`（16/17 在 02-visual 尾，09-genre-mode 在 10-shell 尾）

## 验证记录（2026-08-12）

- `node --check` 全部 11 个改动/新建 JS 文件通过
- 归一化/推断单元测试 18 例全过（含中英 genre 文本、艺人锚点、播客 category、缓存）
- Playwright 端到端：模式开关/锁定持久化/eco 降级/三方互斥（胶片↔涂鸦↔风格 + setPreset 退出）/自动跟随（`thrash metal` → metal 族、赵雷《成都》关键词 → folk 族）全部通过
- 已知边界：无播放歌曲时开启胶片电台会在评论加载处抛错（`detailCommentsConfig(null)`）——**胶片电台既有问题**，与本模式无关
