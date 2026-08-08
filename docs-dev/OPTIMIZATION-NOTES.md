# OrangeSea 优化与新功能落地记录（Phase 6）

> 对应 `ROADMAP.md` 的 Phase 6。每项完成后更新状态与验证方式。
> 状态图例：⬜ 未开始 ｜ 🔨 进行中 ｜ ✅ 已完成

## 一、工程基建

| 项 | 状态 | 说明 / 验证 |
|---|---|---|
| 提交积压改动 | ✅ | 4 个 commit 收编（server 拆分 / 彩蛋移除 / 视觉重做+测试 / 演唱会预设），工作区干净 |
| 修 ARCHITECTURE.md | ✅ | 重写为 server/ 模块化架构 + OrangeSea 品牌 + 9 预设 |
| 修 ROADMAP.md | ✅ | Phase 1-5 标完成，新增 Phase 6 当前 |
| 修 MODDING-GUIDE.md | ✅ | 行号引用改为 server/routes 结构，预设新增流程更新 |
| 补 local-library / kugou / listen journal 测试 | 🔨 | |
| 配置 GitHub Actions CI | 🔨 | |
| run-tests.js 注释修正 | 🔨 | |

## 二、性能优化

| 项 | 状态 | 说明 / 验证 |
|---|---|---|
| 播放 URL 缓存 | 🔨 | `server/context.js` 加缓存 Map（platform+songId+quality+凭证指纹，TTL 30min，登出失效） |
| index-loader 并行加载 | 🔨 | 102 模块 fetch 并行 + 顺序注入，去掉同步 XHR |
| 更新包流式哈希 | 🔨 | `update.js` verifyUpdateFile 改 createReadStream 管道 |
| 听歌日志防抖写 | 🔨 | persistListenSyncJournal 200ms 合并 |
| 每帧 DOM 缓存 | 🔨 | main-loop thumb-cover、home-actions 引用缓存 |
| 天气电台提速 | 🔨 | 逐曲探测并发上限 + 10min 结果缓存 |
| 汽水解密限流 | 🔨 | 单曲大小上限 + 并发下载数上限 |

## 三、代码质量

| 项 | 状态 | 说明 / 验证 |
|---|---|---|
| requestText/requestJson 四合一 | ⬜ | 收敛到 server/utils.js |
| 删 update.js 死代码 | ⬜ | 无镜像版 downloadUpdateAsset/downloadAndApplyPatch |
| 修 8 个重复定义 | ⬜ | preset-archive-data.js 双定义保留后版 |
| 删空 stub | ⬜ | login-workflow-connections、startHeadTracking、IDLE_GUIDE |
| 空 catch 补日志 | ⬜ | 播放/登录关键路径 |
| quick-check 与 tests 去重 | ⬜ | 8 项内联回归检查 |
| playQueueAt 局部抽取 | ⬜ | 只做低风险抽取 |

## 四、安全加固

| 项 | 状态 | 说明 / 验证 |
|---|---|---|
| CSP 收紧 | ✅ | 已随积压完成（desktop/main.js LOCAL_APP_CSP：仅放行 jsdelivr/huggingface 白名单；script-src 因 index-loader script.text 注入 + 内联 onclick 保留 unsafe-inline/unsafe-eval 并注释原因） |
| 代理超时 + SSRF 防护 | ⬜ | /api/cover 5s 超时 + 8MB 上限 + 内网段拒绝 |
| cookie 加密落盘 | ⬜ | AES-256-GCM，机器特征派生密钥，兼容旧文件 |
| 主窗口 sandbox 评估 | ⬜ | 尝试开启 + 冒烟验证，失败回退 |
| 安全测试 | ⬜ | CSP 注入断言、代理 SSRF 拒绝单测 |

## 五、新功能

| 项 | 状态 | 说明 / 验证 |
|---|---|---|
| 演唱会现场视觉预设 | ✅ | 已完成并提交（a35090e）：9 号预设、灯海 shader、聚光灯层、测试通过 |
| 睡眠定时器 | ⬜ | 底部控制条 + 15/30/60/90min / 曲末，到点暂停 |
| 歌单导入导出 | ⬜ | OS2 风格分享码 + .osplaylist.json 文件 |
| 歌曲下载/离线缓存 | ⬜ | 白名单平台流式下载 + 元数据，本地库可导入 |
| 听歌月度/年度报告 | ⬜ | 基于 listenStats 的统计弹窗 |
