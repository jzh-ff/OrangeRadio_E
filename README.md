# OrangeSea · 橘子海

![OrangeSea 启动页 · 把日落调成你的频率](./docs/assets/readme/orangesea-splash.png)

OrangeSea 是一款 Windows 桌面沉浸式音乐播放器，把搜索播放、歌词舞台、粒子视觉、3D 歌单架和完整桌面模式组合成一个更接近现场感的私人音乐空间。日落渐变暗色视觉，融合桌面模式、歌词舞台、粒子舞台与 3D 歌单架。

> 本项目是基于 [Mineradio](https://github.com/XxHuberrr/Mineradio)（GPL-3.0）的二次创作，遵循 GPL-3.0 开源。原作者 XxHuberrr，归属与致谢详见 [NOTICE.md](./NOTICE.md)。

## 当前版本

当前版本：`1.0.0`

状态：OrangeSea 1.0.0 第一个正式版。

> 安全提示：请从可信来源获取安装包，不要运行来源不明的可执行文件。`v1.0.10` 及更早的旧 Mineradio 安装包不再建议继续安装或传播。

## 发布状态

OrangeSea 自 `v1.0.0` 起提供 Windows 正式安装包（`OrangeSea-1.0.0-Setup.exe`，NSIS 安装向导）。可从仓库 Release 页或可信分发渠道获取，也可参照下方「开发运行」自行构建。

| 入口 | 说明 | 链接 |
| --- | --- | --- |
| OrangeSea GitHub Release | 正式版安装包 | [OrangeRadio_E Releases](https://github.com/jzh-ff/OrangeRadio_E/releases) |
| 上游 Mineradio GitHub Release | 上游成熟版本 | [Mineradio Releases](https://github.com/XxHuberrr/Mineradio/releases) |

## 下载或安装被拦截怎么办

小众 Electron 桌面软件、未签名安装包有时会被浏览器、Windows Defender 或 SmartScreen 提示风险。请先确认安装包来自官方入口，并核对文件名。

1. 浏览器下载栏提示风险时，打开下载列表，点这条下载右侧的 `...` 三个点，选择 `保留` / `仍要保留` / `显示更多` 后继续保留。
2. Windows SmartScreen 弹出蓝色拦截窗口时，点 `更多信息`，再点 `仍要运行`。
3. 如果杀毒软件明确显示木马、高危或已经隔离，不要强行运行；删除该文件后重新下载，仍然异常请带截图反馈给作者。

## 赞赏支持

如果 OrangeSea 陪你多听了一首歌，可以请作者喝杯咖啡。

![微信赞赏码](./docs/assets/support/wechat-qr.png)

## 核心特性

- 首页包含每日推荐、平台推荐、继续听、听歌画像和我的歌单入口
- 完整桌面模式保留播放器、主页、歌单和桌面交互
- 支持本地 MP4 与 Wallpaper Engine 视觉内容
- 播放后切换到默认播放态视觉，歌词舞台与粒子舞台同步工作
- 基于节奏的电影镜头视觉系统
- 面向长播客和 DJ 曲目的专属视觉模式
- 歌词舞台、自定义歌词、歌词位置与视觉控制
- 自定义专辑封面上传与裁剪
- 右键唤起 3D 歌单架，支持歌单队列浏览
- 网易云音乐、QQ 音乐、酷狗音乐、汽水音乐、Spotify 账号与音源接入
- 本地音乐库扫描与播放
- 首次启动内置「默认测试」视觉用户存档，软件内默认视觉参数与该存档一致

## 使用说明

Windows 用户可以安装安装包或使用 `win-unpacked` 目录直接运行。安装包会创建桌面快捷方式。

已经安装过旧版本的用户可直接运行新安装包完成更新。

## 开发运行

```bash
npm install
npm start
npm test
npm run build:win
```

桌面版入口由 Electron 主进程加载本地服务。`npm run build:win` 会生成 Windows NSIS 安装包，产物位于 `dist/`。

后端服务已拆分为模块化结构：`server.js` 为装配入口，业务逻辑分布在 `server/`（共享状态、工具、处理器、路由）与各 `*-api.js` 平台桥接模块中。

## 更新机制

应用内更新检测当前默认关闭（`package.json` 的 `mineradio.update.provider` 为 `none`）。手动更新方式：下载新版本安装包直接覆盖安装，用户数据与设置不受影响。

如需启用在线更新检测，可将 `provider` 配置为 `github` 并填写仓库信息；本地验证更新链路时，也可以通过 `MINERADIO_UPDATE_MANIFEST` 指向一个本地 manifest JSON 或 HTTP 地址来模拟线上 Release。

## 第三方音乐平台说明

OrangeSea 不是网易云音乐、QQ 音乐、酷狗音乐、汽水音乐或 Spotify 的官方客户端，也不隶属于任何音乐平台。

项目中的第三方平台接入仅用于个人学习、本地客户端体验和用户自有账号的播放辅助。请遵守对应平台的用户协议、版权规则和会员权益规则。项目不会提供绕过付费、绕过会员、破解音质或重新分发音乐内容的能力。

## 用户数据与隐私

登录 Cookie、搜索历史、自定义封面、自定义歌词、节奏分析缓存等数据只应保存在本机用户数据目录或浏览器本地存储中，不应提交到仓库。

更多说明见 [PRIVACY.md](./PRIVACY.md)。

## 致谢

OrangeSea 是基于 [Mineradio](https://github.com/XxHuberrr/Mineradio) 的二次创作。Mineradio 由 XxHuberrr 主要设计与打造，emily 作为早期视觉底层想法与 `emily` 视觉预设改进方向的共创者和灵感来源之一，特此感谢。

同时感谢小天才e宝、应春日、锋将军、軌跡、林中、骊、风痕、花椰菜🥦在早期体验、测试反馈和发布准备中的帮助。

## 版权与授权

Copyright (C) 2026 XxHuberrr. 本项目基于 Mineradio 二次创作，遵循 GPL-3.0 授权。详见 [LICENSE](./LICENSE)。

MR Logo、Mineradio 名称与界面视觉设计归原作者所有；OrangeSea 名称、日落主题视觉与二次创作部分归本项目作者所有；第三方依赖和第三方服务分别遵循其各自授权与服务条款。
