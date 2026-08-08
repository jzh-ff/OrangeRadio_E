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

Phase 1 换皮重塑品牌（✅ 已完成）
  产出：以 OrangeSea 身份独立运行/安装、与原版数据完全隔离的播放器
  （appId/dataDir/localStorage 命名空间/图标/安装器/授权声明，quick-check 守卫无残留）

Phase 2 日落渐变暗色视觉定制（✅ 已完成）
  产出：全站日落配色 + splash/桌面歌词/视觉默认值统一新风格

Phase 3 音效/EQ 处理（✅ 已完成）
  产出：10 段参量均衡器（05-playback/19-equalizer.js）+ 音效预设，接入视觉控制台与存档

Phase 4 桌面交互增强（✅ 已完成）
  产出：迷你播放条（10-shell/07-mini-player.js）+ 全局快捷键增强

Phase 5 新增音源平台（✅ 已完成）
  产出：本地音乐库（server/routes/local.js + local-library.js），第 6 个音源（目录扫描）

Phase 6 优化 + 新功能 ⭐ 当前
  产出：性能优化（播放 URL 缓存/并行模块加载/流式哈希/日志防抖等）
       + 代码质量清理（去重/删死码/修重复定义）
       + 安全加固（CSP/代理限流/cookie 加密）
       + 新功能（睡眠定时器/歌单导入导出/歌曲下载/听歌报告）
  进度跟踪：docs-dev/OPTIMIZATION-NOTES.md
```

## 各阶段详解

### Phase 1：换皮重塑品牌（✅ 已完成）
- 范围：package.json 品牌字段、main.js 应用身份与数据目录、前端品牌文本、localStorage 命名空间、全局桥名、原创图标与安装器美术、法律文件（GPL 归属声明）
- 验收：grep 无 mineradio 残留（除授权声明）、`npm start` 以 OrangeSea 运行、数据落到新目录、`build:win:dir` 成功

### Phase 2：日落渐变暗色视觉定制（✅ 已完成）
- 范围：CSS `:root` 日落色板（深海蓝黑底 + 日落橙 #ff7a3d / 珊瑚红 #ff5e62 / 暖金 #ffc46b）、fx 默认值 + 首启存档、splash 日落渐变字标、桌面歌词颜色、平台源色调和
- 验收：全界面无原版青绿色（#00f5d4）残留

### Phase 2.5：多播放器样式（✅ 已完成）
- 产出：简约/DIY 双模式（`preload-mode.js` 防闪烁）+ 胶片电台全屏黑胶播放器（`10-shell/06-film-radio.js` + `film-radio.css`，预设网格特殊卡片，切换数值预设自动退出）

### Phase 3：音效/EQ 处理（✅ 已完成）
- 产出：AudioContext BiquadFilter 链（lowshelf + 8×peaking + highshelf）+ 均衡器 UI + 音效预设 + EQ 参数纳入 fx 存档

### Phase 4：桌面交互增强（✅ 已完成）
- 产出：迷你播放条（`10-shell/07-mini-player.js`）、全局快捷键增强、桌面歌词样式切换

### Phase 5：新增音源平台（✅ 已完成）
- 产出：本地音乐库（目录扫描 → 标签读取 → Range 音频流 → 搜索/歌词），第 6 个音源
- 对称改造点参考 `docs-dev/MODDING-GUIDE.md` 第三节

### Phase 6：优化 + 新功能（⭐ 当前，2026-08 起）
- 跟踪：`docs-dev/OPTIMIZATION-NOTES.md`（逐项状态与验证）
- 方向：
  - 性能：播放 URL 缓存、index-loader 并行加载、更新包流式哈希、听歌日志防抖、每帧 DOM 缓存、天气电台提速、汽水解密限流
  - 代码质量：工具函数去重、删死代码、修重复定义、空 catch 补日志
  - 安全：CSP 收紧、代理超时/SSRF 防护、cookie 加密、主窗口沙箱评估
  - 新功能：睡眠定时器、歌单导入导出（OS2 风格分享码）、歌曲下载/离线缓存、听歌月度/年度报告

## 执行约定

- 每阶段开始前写详细实施计划（`docs/superpowers/plans/`），任务级 checkbox 跟踪
- 每个任务完成后 git commit；每阶段完成后合并
- 全程遵守 GPL-3.0：保留原作者版权声明，NOTICE.md 记录衍生关系
- 每阶段产出更新文档（docs-dev/ 下对应章节）
