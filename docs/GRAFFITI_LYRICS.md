# 涂鸦墙（Graffiti Wall）· 暗夜墨光满屏歌词模式

> 一句歌词用行草书法大字铺满整个屏幕，逐字/逐词蹦出，完全无 3D 镜头——纯 DOM 沉浸式歌词展示。

## 功能概述

「涂鸦墙」是 OrangeSea 的一个独立视觉预设模式，与胶片电台（Film Radio）并列。它用一张不透明的全屏 DOM 覆盖层盖住 3D 场景，只展示歌词——当前一句歌词以行草书法大字自然换行（2~3 行）铺满屏幕，按每句随机抽中的入场动画逐字（或逐词）蹦出来。

氛围基调为**「暗夜墨光」**：模糊封面取色做沉浸底色、暗化遮罩、双光晕随节拍呼吸、墨光粒子飘散、字体柔光发光。

**多语言排版**：拉丁文按词排版（单词不可拆行、固定词距、词内紧排），中日韩逐字排版，标点缩小——中英日韩混排间距统一整齐。

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
       └── .graffiti-line[data-anim]   歌词行（flex-wrap 自然换行 + 入场动画变量组）
              ├── .graffiti-word        拉丁词单元（inline-flex，整词不可拆行）
              │      └── .graffiti-char × N
              ├── .graffiti-char        CJK 逐字单元（字距 margin 0.06em）
              ├── .graffiti-char--punct 标点（缩小 0.62em，不旋转不偏移）
              └── .graffiti-space       词距占位（固定 --gw-word-gap 0.22em）
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
- 约束：`scrollHeight ≤ 可视区高度 × 74%`（减去控制栏 124px），且 `scrollWidth ≤ 容器宽`（防单个不可拆长词横向溢出）
- `.graffiti-line` 用 `flex-wrap: wrap`，字号越大换行越多 → scrollHeight 越大
- 二分收敛到满足约束的最大字号：短句一行巨字，长句 2~3 行
- **测量期间挂 `is-measuring` class**：CSS 独立属性 `scale/translate` 与 `transform` 一样计入祖先 scrollable overflow，未点亮字符的入场初始态（rise 的 0.72em 位移、zoom 的 1.85 倍放大）会撑大滚动溢出读数导致字号偏小——测量时中和这些属性（保留静态涂鸦错位 transform，它参与最终视觉）

#### 多语言分词排版（tokenizeGraffitiText）

一行歌词先拆成排版 token（每个字符带全局**码点**索引，与揭示时间表对齐）。拆分前先按 **grapheme cluster 分簇**（`Intl.Segmenter`）：ZWJ emoji（👨‍👩‍👧）、国旗（🇨🇳）、组合重音（é 的 NFD 分解式）整簇作为一个显示单元，避免按码点劈开渲染成碎片；簇的揭示时间取簇首码点索引。

| token | 规则 | 排版 |
|---|---|---|
| `word` | 连续拉丁/西里尔/希腊字母数字（é/ñ/ü 等扩展字母、词内撇号 `don't`、连字符 `well-known`、小数点 `3.14` 不断词） | `inline-flex` 整词不可拆行，词内字母紧排 |
| `char` | CJK 逐字（中文、假名、谚文音节）、emoji 等其他簇 | 字距 `margin-right: 0.06em` |
| `punct` | 全/半角标点、破折号族（——） | 缩小 `0.62em`、不旋转不偏移（书法排版惯例） |
| `space` | 连续/前导空白折叠 | 固定宽 `--gw-word-gap (0.22em)`，**与字体空格宽度度量脱钩** |

> 设计要点：拉丁文的"词"必须成为 DOM 结构单元——否则词内字母间距与词间距离无法区分（早期版本逐字均排，英文看起来像一串散开的字母，且 flex-wrap 会从单词中间断行）。固定词距占位同时解决了不同字体空格宽度不一致的问题（书法字体的空格窄、系统 fallback 字体不可控）。

#### 入场动画池（每句随机）

`.graffiti-line[data-anim]` 携带一组 CSS 变量（`--gw-fx/fy/fs/fr/fb/ease/duro/durf`），驱动 8 种入场动画，每句由 `lineIdx` 稳定种子抽签（同一行重渲染不换动画）：

| data-anim | 效果 | | data-anim | 效果 |
|---|---|---|---|---|
| `pop` | 缩放弹跳（初始效果） | | `zoom` | 镜头对焦：放大+微模糊 → 归位 |
| `rise` | 自下方升起浮现 | | `spin` | 旋转卷入（方向逐字随机） |
| `drop` | 上方砸落，微回弹 | | `slide` | 左右交错滑入（方向逐字随机） |
| `ink` | 晕墨：模糊放大 → 收拢清晰 | | `flash` | 打字机式干脆闪现 |

- 每字过渡时长以动画基准值为中心 ±18% 抖动（`flash` 等快动画保持干脆）
- **reveal 粒度随机**：拉丁行 50% 概率整词同刻蹦出（YRC 用真实词时序，LRC 按词均分），CJK 行恒逐字
- **静态错位与入场动效解耦**：涂鸦随机旋转/偏移留在 `transform`（恒定）；入场动效走 CSS 独立属性 `translate/scale/rotate/filter`（Chromium 104+），互不干扰。旧浏览器忽略独立属性时自动降级为淡入

#### 打字机揭示时间表（computeGraffitiReveals）

`computeGraffitiReveals(line, text, {lineIdx, tokens, groupByWord})` 为每个字符计算揭示时间（相对行首）：

- **YRC 逐字歌词**：按 `word.t`（绝对时间，减去 `line.t` 转行内相对）+ 字内均分 `word.d`，最多 0.55s 内蹦完一个词
- **LRC 逐行歌词**：在该行 `duration` 的前 70% 内按字符数均分，加 ±0.04s 稳定抖动（单调不减，去机械感）
- **码点换算**：YRC 的 `word.c0/c1` 是 UTF-16 code unit 索引（`parseYrcText` 用 `fullText.length` 累计），渲染拆字按码点——函数内建 code unit → 码点映射表统一换算，emoji 等 BMP 外字符不再错位

主循环每帧检查 `elapsed >= reveal[i]`，是则给字符加 `is-shown` class 触发 CSS transition。

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
| `tests/graffiti-lyrics.test.js` | 新增 | 分词/揭示时间表/动画抽签单测（vm 沙箱脚本式） |

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
