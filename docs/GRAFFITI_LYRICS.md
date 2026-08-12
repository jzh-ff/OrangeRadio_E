# 涂鸦墙（Graffiti Wall）· 暗夜墨光满屏歌词模式

> 一句歌词用行草书法大字铺满整个屏幕，逐字蹦出，完全无 3D 镜头——纯 DOM 沉浸式歌词展示。

## 功能概述

「涂鸦墙」是 OrangeSea 的一个独立视觉预设模式，与胶片电台（Film Radio）并列。它用一张不透明的全屏 DOM 覆盖层盖住 3D 场景，只展示歌词——当前一句歌词以行草书法大字自然换行（2~3 行）铺满屏幕，一个字一个字蹦出来。

氛围基调为**「暗夜墨光」**：模糊封面取色做沉浸底色、暗化遮罩、双光晕随节拍呼吸、墨光粒子飘散、字体柔光发光。

## 使用方法

### 开启 / 关闭

在 **DIY 控制台 → 视觉预设网格**中，点击末尾的「**涂鸦墙**」卡片（图标为毛笔笔触）。

- 点击开启，再次点击关闭
- 状态持久化（记忆到 localStorage，下次启动恢复）
- 与胶片电台、所有数值视觉预设（0~8）**互斥**：开启涂鸦墙会自动退出胶片电台；切换任意数值预设会自动退出涂鸦墙

### 字体与颜色

涂鸦墙**复用全局歌词字体/颜色设置**：

- **字体**：DIY 控制台 → 字体选择器。默认 `liucao`（刘建毛草），推荐切换为 `longcang`（龙藏）、`mashan`（马善政楷书）等行草/书法字体以获得最佳涂鸦感
- **颜色**：DIY 控制台 → 歌词颜色。默认月白 `#d7d2c4`，光晕色自动跟随字色

切换字体/颜色后**实时生效**，无需退出重进。

## 技术架构

### 四层叠加覆盖层

```
#graffiti-overlay (position:fixed; z-index:5; 不透明)
├── L0  .graffiti-bg-cover    模糊封面底（blur 64px + saturate 1.45）
├── L0.5 .graffiti-bg-shade   暗化遮罩（径向+线性渐变，保证可读）
├── L1  .graffiti-glow-a/b    双光晕呼吸（CSS @keyframes 11~13s）
├── L2  #graffiti-canvas      墨光粒子（Canvas 2D，~30 粒，离屏精灵复用）
└── L3  .graffiti-stage        歌词舞台
       └── .graffiti-line      歌词行（flex-wrap 自然换行）
              └── .graffiti-char × N   逐字单元
```

### 数据流

```
主循环 rAF (60fps)
├── 歌词 tick（节流 ~30fps）
│   ├── checkGraffitiStyleChange()  → 字体/颜色变化检测 → syncGraffitiStyle()
│   └── tickGraffitiLyrics()
│       ├── getAdjustedLyricPlaybackTime() → findStageLyricIndexAtTime()
│       ├── 切行 → renderGraffitiLine() → fitGraffitiFontSize()（二分测量）
│       └── 逐字揭示：elapsed >= reveal → add('is-shown')
└── 粒子 tick（60fps）
    └── tickGraffitiParticles() → drawImage(精灵) × 30
```

### 核心算法

#### 字号自适应（自然换行铺满）

`fitGraffitiFontSize(container)` 用二分查找确定最大可行字号：

- 上限 `hi ≈ 半屏高`，下限 `lo = 32px`
- 约束：`scrollHeight ≤ 可视区高度 × 74%`（减去控制栏 124px）
- `.graffiti-line` 用 `flex-wrap: wrap`，字号越大换行越多 → scrollHeight 越大
- 二分收敛到满足约束的最大字号：短句一行巨字，长句 2~3 行

#### 打字机逐字蹦出

`computeGraffitiReveals(line, charCount)` 为每个字符计算揭示时间（相对行首）：

- **YRC 逐字歌词**：按 `word.t`（绝对时间，减去 `line.t` 转行内相对）+ 字内均分 `word.d`，最多 0.55s 内蹦完一个词
- **LRC 逐行歌词**：在该行 `duration` 的前 70% 内按字符数均分

主循环每帧检查 `elapsed >= reveal[i]`，是则给字符加 `is-shown` class 触发 CSS transition（opacity + scale + rotate 弹性动画）。

#### 涂鸦随机种子

`graffitiCharSeed(lineIdx, charIdx, salt)` 用行索引+字索引生成 0~1 的稳定伪随机数，为每个字生成：
- 旋转 `±8°`（`--gw-rot`）
- 垂直偏移 `±0.05em`（`--gw-dy`）

同一行每次渲染随机值一致，不会闪烁。

#### 墨光粒子（性能优化）

初始化时离屏预渲染一个 64×64 的光点精灵（`buildGraffitiParticleSprite()`），运行时每帧用 `globalAlpha` + `drawImage` 复用，避免每帧 30 次 `createRadialGradient`（Canvas 2D 较重的 API）。粒子亮度随低频能量（`frequencyData` bin 1~8）提升。

## 文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `public/js/modules/10-shell/08-graffiti-lyrics.js` | 新增 | 主逻辑模块 |
| `public/css/graffiti-lyrics.css` | 新增 | 样式（`body.graffiti` 命名空间） |
| `public/index.html` | 修改 | CSS link + `#graffiti-overlay` HTML 结构 |
| `public/js/index-loader.js` | 修改 | 注册新模块到加载序列 |
| `public/js/modules/07-fx/04-preset-grid-uniforms.js` | 修改 | 预设卡片 + 高亮 + `setPreset` 互斥退出 |
| `public/js/modules/10-shell/06-film-radio.js` | 修改 | 双向互斥（进入胶片电台时退出涂鸦墙） |

## 全局 API

| 函数 | 说明 |
|---|---|
| `toggleGraffitiMode()` | 切换涂鸦墙开关（卡片 onclick 绑定） |
| `applyGraffitiMode(on, opts)` | 设置开关状态，`opts: {save, toast, animate}` |
| `graffitiMode` | 当前是否开启（布尔，全局变量） |

## 设计决策

1. **为什么用 DOM 覆盖层而非 Three.js？** 用户明确要求「不要 3D 镜头，只展示歌词」。DOM 实现打字机效果更灵活，且能复用 CSS 字体/动画生态。胶片电台已验证此架构可行。
2. **为什么与数值预设互斥？** 涂鸦墙是纯展示模式，与 3D 粒子/镜头场景不兼容（覆盖层盖住了 3D）。与胶片电台采用相同的互斥范式。
3. **为什么进入时降 3D 质量到 eco？** 覆盖层已盖住 3D 场景，3D 渲染不可见，把帧预算让给歌词/粒子动画。退出时恢复原质量档（不写入存档）。
4. **为什么背景必须不透明？** Electron 下 `backdrop-filter` 不可靠，半透明会把 3D 舞台透出来盖住歌词。L0 模糊封面 + L0.5 暗化遮罩合起来保证不透。
