# OrangeSea（橘子海）二创总路线图

> 基于 Mineradio 2.0.2 的二次开发项目。
> 品牌：OrangeSea · 橘子海 ｜ 视觉：日落渐变暗色 ｜ 授权：GPL-3.0（衍生作品同样开源，不使用 Mineradio 名称/Logo）

## 品牌决策（已确认）

| 项 | 决策 |
|---|---|
| 英文名 | OrangeSea |
| 中文名 | 橘子海 |
| 应用 ID | com.orangesea.desktop |
| 数据目录 | %AppData%\OrangeSea |
| 缓存目录 | D:\OrangeSeaCache |
| 图标 | AI 生成原创（橙子+海浪，日落色系） |
| 视觉基调 | 日落渐变暗色（深海蓝黑底 + 橙红日落高光） |
| 更新通道 | 禁用（provider:none），避免指向原作者仓库 |

## 阶段总览

```
Phase 0 准备（✅ 已完成）
  克隆 2.0.2 → 依赖安装 → 架构研究 → 文档（ARCHITECTURE/MODDING-GUIDE）→ 运行验证

Phase 1 换皮重塑品牌 ⭐ 当前
  └─ 产出：可以 OrangeSea 身份独立运行/安装、与原版数据完全隔离的播放器

Phase 2 日落渐变暗色视觉定制
  └─ 产出：全站日落配色 + splash/桌面歌词/视觉默认值统一新风格

Phase 3 音效/EQ 处理
  └─ 产出：10 段参量均衡器 + 音效预设，接入视觉控制台与存档体系

Phase 4 桌面交互增强
  └─ 产出：迷你播放条 + 全局快捷键增强（候选功能点届时细化）

Phase 5 新增音源平台
  └─ 产出：对称接入一个新音源（候选：本地音乐库 / B站音频 / YouTube Music，届时选定）
```

## 各阶段详解

### Phase 1：换皮重塑品牌
- **详细计划**：`docs/superpowers/plans/2026-07-27-orangesea-phase1-rebrand.md`
- 范围：package.json 品牌字段、main.js 应用身份与数据目录、前端品牌文本、localStorage 命名空间、全局桥名、原创图标与安装器美术、法律文件（GPL 归属声明）
- 验收：grep 无 mineradio 残留（除授权声明）、`npm start` 以 OrangeSea 运行、数据落到新目录、`build:win:dir` 成功
- 预估：8 个任务，约 1 天

### Phase 2：日落渐变暗色视觉定制（依赖 Phase 1）
- 范围：
  - `public/css/index.css:288-349` 四个 `:root` 块改为日落色板（深海蓝黑 #0c1220 底 + 日落橙 #ff7a3d / 珊瑚红 #ff5e62 / 暖金 #ffc46b 渐变高光）
  - `public/js/modules/00-state/04-fx-defaults.js` 视觉默认值 + `public/default-user-fx-archive.json` 首启存档
  - splash 样式（`index.css:1215-1316`）改日落渐变字标
  - `public/desktop-lyrics.html` 歌词颜色四元组
  - 平台源色 `--source-*` 与新色板调和
- 验收：全界面无原版青绿色（#00f5d4）残留，视觉预设在新色板下协调
- 预估：5-6 个任务，约 1 天

### Phase 2.5：多播放器样式（用户新增需求，依赖 Phase 2）
- 范围：在现有播放器样式基础上新增多种播放器样式（具体样式方案 Phase 2 完成后与用户细化：如极简模式、黑胶唱机模式、磁带复古模式等候选方向）
- 技术切入点：底部播放条 DOM（`index.html:1204-1357`）+ 播放控制模块（`05-playback/14-player-controls.js`）+ 样式切换机制（参考 fx 存档体系做样式持久化）
- 验收：样式间可切换、选择持久化、各样式下播放控制功能完整
- 预估：视样式数量与复杂度，1-2 天

### Phase 3：音效/EQ 处理（与 Phase 2 可并行）
- 技术路线：前端 `<audio>` → Web Audio `AudioContext` → BiquadFilter 链（lowshelf + 8×peaking + highshelf，10 段）→ destination
- 关键约束：音频已走 `/api/audio` 同源代理，无 CORS 问题；需与现有频谱分析共用 AudioContext（`11-main-loop.js:347-389`）
- 范围：AudioContext 路由改造、EQ 处理模块、fx 控制台 EQ 区 UI、8 个音效预设（流行/摇滚/古典/人声/低音增强/高音增强/现场/监听）、EQ 参数纳入 fx 存档
- 验收：各段增益实时生效、存档恢复、频谱可视化不受影响
- 预估：6-8 个任务，约 1.5 天

### Phase 4：桌面交互增强（独立）
- 候选功能点（届时细化，先列方向）：
  - 迷你播放条模式（窄条小窗，置顶，可拖回主窗）
  - 全局快捷键增强（现有 `mineradio-hotkeys-configure-global` 基础上加自定义键位映射 UI）
  - 桌面歌词样式快速切换
- 预估：2-3 个任务，约 1 天（视选定范围）

### Phase 5：新增音源平台（独立，工作量最大）
- 候选（届时三选一）：
  | 候选 | 难度 | 说明 |
  |---|---|---|
  | 本地音乐库扫描 | ★★ | 扫描本地目录 → music-metadata 读标签 → 接入搜索/歌单，无登录无加密 |
  | B 站音频 | ★★★★ | 搜索/播放/收藏 API + 登录态，无官方面向桌面 API |
  | YouTube Music | ★★★★★ | 仅元数据可行，音频获取合规风险高，不建议 |
- 对称改造点参考 `docs-dev/MODDING-GUIDE.md` 第三节
- 预估：8-12 个任务，2-3 天（本地库约 1 天）

## 执行约定

- 每阶段开始前写详细实施计划（`docs/superpowers/plans/`），任务级 checkbox 跟踪
- 每个任务完成后 git commit；每阶段完成后合并
- 全程遵守 GPL-3.0：保留原作者版权声明，NOTICE.md 记录衍生关系
- 每阶段产出更新文档（docs-dev/ 下对应章节）
