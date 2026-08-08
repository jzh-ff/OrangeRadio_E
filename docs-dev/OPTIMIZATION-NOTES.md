# OrangeSea 优化与新功能落地记录（Phase 6）

> 对应 `ROADMAP.md` 的 Phase 6。状态图例：✅ 已完成 ｜ 🔨 进行中 ｜ ⬜ 未开始
> 全部改动经 `npm test`（35 个测试）与 `scripts/quick-check.js` 守卫验证。

## 一、工程基建（✅ 全部完成）

| 项 | 说明 |
|---|---|
| 提交积压改动 | 4 个 commit 收编（server 拆分 / 彩蛋移除 / 视觉重做+测试 / 演唱会预设） |
| 修 ARCHITECTURE.md | 重写为 server/ 模块化架构 + OrangeSea 品牌 + 9 预设 |
| 修 ROADMAP.md | Phase 1-5 标完成，新增 Phase 6 当前 |
| 修 MODDING-GUIDE.md | 行号引用改为 server/routes 结构，预设新增流程更新 |
| 补测试 | local-library / kugou-api / listen journal（tests/local-library.test.js、kugou-api.test.js、listen-journal.test.js） |
| GitHub Actions CI | `.github/workflows/ci.yml`：node --check 全部 JS + npm test + quick-check（windows-latest） |
| run-tests.js 注释 | 修正为两种测试风格并存的实际描述 |

## 二、性能优化（✅ 全部完成，commit a3e4ad8）

| 项 | 实现 |
|---|---|
| 播放 URL 缓存 | `server/context.js` 新增 neteasePlaybackUrlCache（platform+songId+quality+凭证指纹+hints，30min TTL，登出清空），`netease-playback.js` handleSongUrl 命中直接返回，跳过探测链 |
| index-loader 并行加载 | 102 模块 fetch 并行 + 按序注入（异步回调中固定 currentScript 锚点），去掉同步 XHR 阻塞 |
| 更新包流式哈希 | `update.js` verifyUpdateFile 改 createReadStream 单遍双 digest（hex+base64），链路逐层 await |
| 听歌日志防抖 | persistListenSyncJournal 200ms 合并批量落盘 |
| 每帧 DOM 缓存 | main-loop thumb-cover 引用缓存 |
| 天气电台提速 | 逐曲探测结果 10min 缓存（weatherPlayableProbeCache） |
| 汽水解密限流 | 单曲 200MB 上限（Content-Length 预检 + 流式计数）+ 并发 2 队列 |

## 三、代码质量（✅ 全部完成，commit 7b2a334）

| 项 | 实现 |
|---|---|
| requestText/requestJson 四合一 | 新建零依赖 `server/http-utils.js`（http/https、timeoutMs、err.statusCode/body/retryAfter、空文本 {}），utils/qishui/spotify/kugou 共用；spotify 保留 UA 注入 wrapper 与错误码前缀语义 |
| 删 update.js 死代码 | downloadUpdateAsset / downloadAndApplyPatch 无镜像版（全仓无调用点） |
| 修 8 个重复定义 | preset-archive-data.js 双定义保留后版 |
| 删空 stub | login-workflow-connections（含常量）、startHeadTracking/stopHeadTracking |
| 空 catch 补日志 | seek 应用失败补 console.warn（其余为有意防御：localStorage/DOM 清理） |
| quick-check 与 tests 去重 | 已确认 8 项回归直接 spawn tests/ 文件（无需再改） |
| playQueueAt 局部抽取 | 错误文案映射 playbackFailureToastText 已独立于 playQueueAt 外 |

## 四、安全加固（✅ 完成主体，commit 057e1ca）

| 项 | 状态 | 说明 |
|---|---|---|
| CSP 收紧 | ✅ | 已随积压完成：LOCAL_APP_CSP 白名单 jsdelivr/huggingface，connect-src 限定；script-src 保留 unsafe-inline/unsafe-eval（index-loader script.text 注入 + 内联 onclick + music-tempo eval，注释说明） |
| 代理 SSRF 防护 | ✅ | `utils.js` isPrivateIPv4/IPv6 + proxyTargetIsBlocked（DNS 解析全地址检查 + 5min TTL 缓存，解析失败宁紧勿松）；`/api/cover` 5s 超时 + 8MB 上限（预检 + 流式计数），`/api/audio` 同样拒绝私网 |
| cookie 加密落盘 | ✅ | `server/cookie-cipher.js` AES-256-GCM（机器特征派生密钥），context 读写自动加解密，历史明文文件兼容回退；main.js 导出前解密 |
| 主窗口 sandbox | ⏸ 未启用 | 评估结论：sandbox:true 需实机 Electron 冒烟（quick-check full）验证壁纸协议/Worker/MediaPipe 等，本环境无法运行 GUI；维持 contextIsolation+nodeIntegration:false 防线，启用步骤留待实机 |
| 安全测试 | ✅ | tests/proxy-ssrf-guard.test.js（私网段/公网/非法 URL）、tests/cookie-cipher.test.js（roundtrip/篡改/兼容） |

## 五、新功能（✅ 全部完成）

| 功能 | 实现 | 测试 |
|---|---|---|
| 演唱会现场视觉预设 | 已完成（commit a35090e）：9 号预设、灯海 shader、聚光灯层 | concert-preset-registration |
| 睡眠定时器 | `05-playback/20-sleep-timer.js` + 底部控制条时钟按钮：15/30/60/90min / 曲末暂停，倒计时弹层，到点 toast | sleep-timer |
| 歌单导入导出 | `06-lyrics/07-playlist-share.js`：OSPL1: gzip+base64url+FNV 校验分享码 + .osplaylist.json 文件，平台白名单归一化追加队列 | playlist-share |
| 歌曲下载/离线缓存 | `server/routes/download.js`：POST /api/download（仅网易/QQ/酷狗/汽水）+ status 轮询，流式写盘到 D:\OrangeSeaCache\downloads，.osdownload.json 元数据，汽水走解密通道，并发 2 限流；前端底部下载按钮 + 轮询 toast | song-download |
| 听歌月度/年度报告 | `05-playback/22-listen-report.js`：首页 dock 入口，周期聚合（总时长/次数/Top 歌曲歌手/时段分布/平台分布），纯函数可测 | listen-report |

## 验证基线

- `npm test`：35/35 通过（原 24 + 新增 11：local-library、listen-journal、kugou-api、netease-playback-url-cache、proxy-ssrf-guard、cookie-cipher、sleep-timer、playlist-share、song-download、listen-report、concert-preset-registration）
- `node scripts/quick-check.js`：全部守卫通过
- CI：`.github/workflows/ci.yml`（语法检查 + npm test + quick-check）
