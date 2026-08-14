# 风格世界（Genre Mode）

## 目标与边界

风格世界根据当前曲目的音乐风格，把播放器的既有 Three.js 舞台切换为八个可交互世界。它复用主 `scene`、`camera`、`renderer`、音频分析和主循环；DOM 只承载 HUD、世界罗盘、传送门过渡和歌词 surface，不遮蔽或替代 3D 舞台。

模式状态存于 `orangesea-genre-mode-v1`，罗盘锁定存于 `orangesea-genre-lock-v1`。风格世界与胶片电台、涂鸦墙和普通视觉预设双向互斥。启动预加载按最终模块顺序处理冲突：genre 优先于 film。

## 12 → 8 映射

解析器保留 12 个稳定风格族群，注册表将相近族群合并为 8 个世界：

| 族群 family | 世界 id |
|---|---|
| `electronic` | `electronic` |
| `rock`、`metal` | `rock-metal` |
| `hiphop` | `hiphop` |
| `pop`、`anime` | `prism` |
| `default`（未识别） | 按曲目身份在 8 个世界中稳定随机 |
| `folk` | `folk` |
| `classical` | `classical` |
| `jazz`、`soul` | `jazz-soul` |
| `ambient` | `ambient` |

八个世界的产品名和歌词 style 由 registry manifest 唯一声明：

| id | 设计名 | 英文名 | lyricStyle |
|---|---|---|---|
| `electronic` | 霓虹反应城 | Neon Reactive City | `hologram-signs` |
| `rock-metal` | 裂隙铸造场 | Rift Foundry | `fractured-stage` |
| `hiphop` | 午夜街区 | Midnight Block | `architectural-type` |
| `prism` | 棱镜梦乐园 | Prism Dreamland | `dream-ribbons` |
| `folk` | 琥珀旷野 | Amber Wilds | `constellation-script` |
| `classical` | 无尽歌剧院 | Infinite Opera House | `spatial-score` |
| `jazz-soul` | 蓝烟俱乐部 | Blue Smoke Club | `improvised-anchor` |
| `ambient` | 潮汐虚境 | Tidal Void | `horizon-dissolve` |

## 风格画像解析

`public/js/modules/02-visual/16-genre-resolve.js` 的 `resolveGenreProfile(song)` 返回：

```js
{
  family: 'electronic',
  world: 'electronic',
  confidence: 1,
  source: 'genre',
  version: 'genre-profile-v4'
}
```

来源按以下顺序解析：

1. `song.genre`：本地 ID3 或 Spotify 艺人风格，`source: genre`，置信度 `1`。
2. 播客 `radioCategory/category/album`：仅播客或有 `radioName` 时使用，`source: category`，置信度 `0.85`。
3. 旧对象首次迁移的合法 `visualGenre`：`source: legacy`，通常为 `0.7`。
4. 艺人 / 标题 / 专辑关键词：先匹配艺人锚点表，再匹配风格词（兼容 `artists[]`、`title`、`singer`）。`source: keyword`，置信度 `0.65`。
5. 无命中：`family: default`，`source: default`，置信度 `0.15`；世界按曲目身份哈希在 8 个世界中稳定抽取，同一首歌不跳世界。

流行和动漫仍映射到棱镜梦乐园。未识别不再固定棱镜。标题或专辑里出现摇滚 / 爵士 / 电音等风格词时，应进入对应世界，而不是被「华语」一词统一推进 pop。

结果缓存在 `song.visualGenreProfile`，并用 `_visualGenreProfileSignature` 校验。签名包含规则版本、曲目身份字段、genre/category、艺人、标题、专辑和播客字段；任一输入或 `GENRE_PROFILE_VERSION` 变化都会使缓存失效并重新解析。`inferGenreFamily()` 和 `songGenreDisplayText()` 是兼容入口。

## 模块架构

### Registry

`17-genre-world-registry.js` 保存八世界 manifest、12 → 8 映射和运行时 kit。`registerGenreWorld(id, kit)` 只接受已声明 id、带 `create` 的对象，并且每个内置世界只允许成功注册一次。查询入口为 `getGenreWorld()`、`genreWorldForFamily()`、`listGenreWorlds()`。

### Engine

`18-genre-world-engine.js` 在主 scene 中创建一个 `genreWorldRoot`，所有世界对象使用 layer 29。进入模式时保存完整相机值、对象属性和 layer mask；退出或候选创建失败时恢复。任一时刻仅有一个 current world container。

切换是事务式的：候选 kit 完成 `create`、质量设置和曲目应用后才挂入总根节点并替换旧世界；失败时清理候选并保留旧世界。`prism` 是缺失 kit 或目标启动失败时的统一回退。

### Transition

`19-genre-world-transition.js` 是由主循环显式推进的 `idle → closing → crossing → opening → idle` 状态机。普通过渡为 1500–2500ms（默认 2000ms），reduced motion 为 120–300ms（默认 220ms）。crossing 阶段提交新世界；失败时尝试 `prism`，并把实际世界和失败状态提交给 HUD。

### Performance

`20-genre-world-performance.js` 把用户质量档和全局帧压力合成为 `low / medium / high` profile，约束粒子密度、细节、体积光、后处理、灯光、纹理和粒子数量。压力等级会逐级降档；reduced motion 进一步关闭体积光和后处理并限制粒子。

世界模式沿用普通 DPR，再乘 profile 的 `dprScale`（low `0.72`、medium `0.86`、high `1`）。退出模式会恢复普通 DPR，并清空自适应质量签名。

### World Kit 接口

每个 `genre-worlds/*.js` 文件向 registry 注册一个 kit：

- `create(ctx)`：必需；创建并返回世界根或实例。
- `applyTrack(track, ctx, instance)`：应用封面色、曲目信息等静态输入。
- `update(frame, ctx, instance)`：消费主循环提供的时间、低中高频、能量和节拍。
- `renderLyrics(frame, ctx, instance)`：调用共享歌词 renderer 和该世界的 `lyricStyle`。
- `setQuality(profile, ctx, instance)`：应用当前资源预算。
- `dispose(instance, ctx)`：释放该 kit 拥有的资源。

`ctx` 提供共享 `scene/camera/THREE`、世界 container、总根、layer、manifest、质量档、曲目、画像和歌词 style。共享 primitive 位于 `genre-worlds/00-shared-primitives.js`，视觉器 kit 应优先使用 `shaderMaterial` / `shaderPlane` / `audioUniforms` / `bindCover` / `frameCamera` / `tickVisualizer`，而不是再堆楼宇几何体。

### 视觉设计语言（2026-08 视觉器重做）

八个世界不再用方块、圆柱、圆环拼假场景。每个世界是一套**曲风视觉器**，由三层构成：**签名色器**（一眼认出曲风的那个机制，采样全局 `coverTex`）、**气氛底板**（全屏/大平面色器）、**音频分工**（低频尺度、中频形态、高频闪点，beat 只打签名主体）。相机用近机位看英雄，不看沙盘。`coverTex` 是共享资源，kit 不得 dispose。

| 世界 | 签名主体 | 气氛与光 |
|---|---|---|
| electronic | 透视霓虹网格 + 封面全息切片/扫描线 | 深蓝虚空，青色扫描与电火花 |
| rock-metal | 封面裂核平面，bass 冲击波环 + 火星 | 暗红熔床，烟层与点光 |
| hiphop | 封面切成水平金砖条，军鼓错位弹出 | 紫金夜色，低机位 |
| prism | 封面六折万花筒折射，糖果光带 | 粉青天幕，柔和填充 |
| folk | 封面溶解成琥珀尘埃并聚成星座 | 暖橙黄昏，胶片颗粒 |
| classical | 频谱拉成金丝谱线，封面作远处徽章 | 剧院丝绒，几乎不跟 beat 闪 |
| jazz-soul | 噪声烟幕里淡印封面，两束加法光锥 | 蓝金对比，近距现场 |
| ambient | 顶点位移雾海 + 地平线溶解 | 青色空境，长周期呼吸 |

程序化纹理仍由 Canvas 生成（`glowTexture`/`dummyCover`/`noiseTexture`）；色器通过 `shaderMaterial` 标记 owned。全局 `coverTex` 只绑定、不拥有。歌词以可读性优先，排在签名主体之外的安全区。

## 单 scene、renderer、layer 与主循环

`public/js/modules/11-main-loop.js` 是唯一帧入口。风格模式开启时，它按 gate：

1. 同步曲目画像和目标世界。
2. 推进传送门状态机。
3. 更新 HUD 和自适应质量。
4. 构造包含 `time/dt/bass/low/mid/high/energy/beat/frequencyData/timeDomainData/lyrics` 的 frame。
5. 调用 `tickGenreWorld(frame)`，再用主 renderer 渲染主 scene 和主 camera。

世界模块不创建第二套 scene、renderer 或帧调度。layer 29 只隔离风格世界对象；相机 layer 状态在进入时快照、退出时恢复。

## 资源 ownership 与 dispose

只有明确标记 `__genreWorldOwned === true` 或 `userData.genreWorldOwned === true` 的 GPU 资源属于风格世界。共享 primitive 的 `geometry()`、`material()`、`particles()` 和 `ownResource()` 会添加 ownership 标记。

释放规则：

- geometry、单个或数组 material、material 字段和 uniforms 中的 texture 都会遍历。
- 每个 owned resource 只 dispose 一次，并记录 `__genreWorldDisposed`。
- 未标记资源视为共享资源，绝不由世界引擎释放。
- kit 的 `dispose` 成功执行后由 kit 负责其资源；缺失或抛错时引擎执行防御性清理。
- 无论单个资源释放是否失败，container 移除、其余资源清理和相机恢复仍继续。

## HUD、罗盘、锁定与歌词

HUD 显示设计名、英文名、曲目、艺人、解析来源、置信度、锁定状态、播放进度和时间。空闲后 HUD 降低视觉权重；指针、键盘或 HUD 操作会恢复。

罗盘默认 `auto`，随画像切换世界；选择一个世界后写入其 world id 并锁定。旧的 family 锁定值会迁移到对应世界。进度条支持指针定位和方向键、Home、End seek。

`public/js/modules/06-lyrics/08-genre-world-lyrics.js` 提供一个共享歌词 surface，渲染主歌词、翻译、seek 标识和 reduced-motion 状态。每个世界通过 manifest 的 `lyricStyle` 选择排版预设（对齐、位置、字距）；字体和字重跟随 DIY 控制台的 `fx.lyricFont` / `lyricFontWeightValue()`，与涂鸦墙一致。签名未变化时不重复写 DOM。

## 失败回退

- 无风格信息：`default` 按曲目身份稳定随机进入八世界之一。
- 目标 kit 不存在或切换失败：尝试 `prism`，HUD 记录 target、actual 和 failed。
- 引擎首次启动失败：模式进入原子回滚，移除 preload/body class、取消过渡、停止引擎、清歌词、恢复 DPR，并把持久化状态写为关闭。
- 手动进入失败且此前 film/graffiti 已开启：恢复被临时退出的模式。
- localStorage 读取异常：启动预加载保持 simple fallback。

## 扩展新世界

1. 在 `GENRE_WORLD_DEFINITIONS` 添加稳定 id、名称、palette、accent、`lyricStyle` 和 families。
2. 更新 `GENRE_WORLD_FAMILY_MAP`、解析器的 family → world 映射、模式允许 id 和必要的旧锁迁移。
3. 在 `genre-worlds/` 新建 ES5 kit，使用共享 primitive 标记 owned resource，实现 `create`，并按需实现其余生命周期方法。
4. 在 `index-loader.js` 中把 kit 放在 registry、engine 和共享 primitive 之后、shell mode 之前。
5. 为 manifest、注册、事务切换、质量预算、ownership/dispose、歌词 style 和回退路径补测试。
6. 更新罗盘按钮与本文档，再进行低端质量、reduced motion 和长时间切歌检查。

## 自动化测试

在仓库根目录运行六个 genre 专项和 cleanup：

```powershell
node tests/genre-resolve.test.js
node tests/genre-world-engine.test.js
node tests/genre-world-kits.test.js
node tests/genre-world-ownership.test.js
node tests/genre-mode-lifecycle.test.js
node tests/genre-main-loop-integration.test.js
node tests/genre-world-cleanup.test.js
```

完整回归与静态检查：

```powershell
npm test
node --check public/js/preload-mode.js
node --check tests/genre-world-cleanup.test.js
git diff --check
```

## 人工检查清单

- 同时把 film 和 genre 存储值设为开启，冷启动无 film 首帧闪现，最终进入 genre。
- 分别验证八个世界的签名色器（封面参与、音频分层、近机位构图）和对应歌词安全区。
- 自动模式切换不同来源曲目，检查 family、world、来源与置信度；修改同一 song 对象的 genre 后确认缓存失效。
- 锁定罗盘后切歌不换世界；恢复自动后立即跟随画像。
- 快速连续切歌时传送门阶段连续，失败目标回退 `prism`，HUD target/actual 正确。
- film、graffiti 和普通 preset 均能关闭 genre；genre 启动失败能恢复此前模式。
- 检查 low/medium/high、压力降档、DPR 恢复和系统 reduced motion。
- 多次进入、退出及跨世界切换后检查相机、layer、GPU 资源和内存无持续增长。
- 用鼠标和键盘操作 HUD、罗盘与进度条，检查焦点、ARIA、seek 和空闲降权。
