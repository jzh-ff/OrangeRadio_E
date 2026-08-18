# 安装器/卸载器控件暗色化（2026-08-18）

目标：消灭向导里所有白色区域（输入框、按钮、进度页白面板、完成页黑字不可见），全部贴合 14100A/F5F0E6/FF7A3D 品牌暗色。改动全部在 `build/installer.nsh`。

## 手段清单（按问题分类）

| 问题 | 根因 | 手段 |
| --- | --- | --- |
| 输入框白色背景 | 原设计故意"浅底深字"（`SetCtlColors $x "14100A" "F5F0E6"`） | 反转为 `"F5F0E6" "14100A"` + 套 `DarkMode_Explorer` 主题（边框/滚动条变暗） |
| 按钮白色背景 | `SetCtlColors` 对 push button 背景无效（WM_CTLCOLORBTN 的刷子被视觉样式忽略） | `uxtheme::SetWindowTheme(hwnd, "DarkMode_Explorer")`（Win10 1809+，旧系统调用无害保持浅色回退） |
| 安装进度页白色大面板 | `MUI_BGCOLOR` 只作用于欢迎/完成页的 1200 面板；instfiles 页的 1018 rect 是原生白色，且从未被染 | FindWindow #32770 后 `GetDlgItem 1018` + `SetCtlColors "" "14100A"` |
| 进度条浅色背景 | 主题模式下 msctls_progress32 忽略 PBM 颜色消息 | 先去主题 `SetWindowTheme(hwnd, "")` 再发 `PBM_SETBKCOLOR(0x2001)=0x0A1014`、`PBM_SETBARCOLOR(0x409)=0x3D7AFF`（注意颜色参数是 0xBBGGRR） |
| 完成页复选框文字看不见 | 完成页是 MUI2 用 nsDialogs 实现的（非 InstallOptions）；checkbox 是 BUTTON 类，视觉样式下由**主题绘制文字、忽略 SetCtlColors 的文字色**——黑字落在深底上不可见；而同页 label（STATIC）吃 WM_CTLCOLOR 所以正常 | 对 1203 复选框 `SetWindowTheme(hwnd, "")` 去主题，恢复 CTLCOLOR 生效（米白字 + 深底） |
| 反馈页联系方式占位提示看不清 | cue banner（EM_SETCUEBANNER）灰字不受 SetCtlColors 控制，深底上对比不足 | 删除 cue banner，改为输入框上方常显橙色 label（布局整体上移压缩：说明 42u/标签 74u/多行框 86u+24u/新标签 113u/输入框 126u，底边不超内页 ~139u 极限） |

## 染色时机（最大的坑）

内页控件（instfiles 的 1018/1006/1016、完成页的 1201-1204）**在页面切换时才创建**，GuiInit 里的一次性 `MineradioTintCommonControls` 只够到首页。必须每页挂 show 回调重染：

- 安装进度页：`customPageAfterChangeDir` 宏内 `!define MUI_PAGE_CUSTOMFUNCTION_SHOW MineradioTintInstFiles`——assistedInstaller.nsh 模板中下一个 MUI 页面正是 `MUI_PAGE_INSTFILES`（行 46），会消费该 define。
- 安装完成页：`customFinishPage` 里 define（既有逻辑），指向 `MineradioTintCommonControls`。
- 卸载进度页：`MUI_UNPAGE_INSTFILES` 前无模板检查点，改在 `customUnInstall` 宏（卸载 Section 开头被调用）里 `Call un.MineradioTintInstFiles`，页面刚显示即染色。
- 卸载完成页：`customUninstallPage` 宏内 define——卸载模板中该检查点位于 `MUI_UNPAGE_INSTFILES` 之后、`MUI_UNPAGE_FINISH` 之前。

**严禁**在 installer.nsh 顶部 define `MUI_PAGE_CUSTOMFUNCTION_SHOW`：会被更早的 `PAGE_INSTALL_MODE`（MultiUser 安装模式页）消费，且**卸载器编译**时它在 un. 节里 Call 非 un. 前缀函数直接编译失败（`Call must be used with function names starting with "un."`）。

## 复用的调色板与控件 ID

- 四色不变：深底 `14100A`、米白 `F5F0E6`、暖金 `C9A87A`、橙 `FF7A3D`。
- 外层向导按钮 1（下一步/卸载/完成）/2（取消）/3（上一步）跨页面持久，GuiInit 染一次即可，但每页 show 重染无害。
- 内页常用 ID：1004/1006（instfiles 动作文字/详情框）、1016（进度条）、1018（白面板 rect）、1027（显示详细信息按钮）、1201/1202（完成页标题/描述 label）、1203（完成页"运行"复选框）。完成页控件 ID 由 nsDialogs 自动分配（Field 顺序 1200 起），可用 Win32 `EnumChildWindows` + `GetDlgCtrlID` 实测枚举。

## 验证方法（免手动点击）

- 快速重打壳（app 载荷没变时）：`npx electron-builder --win nsis --prepackaged dist/win-unpacked`。
- 自动走安装流程：PowerShell `Start-Process` + `SendKeys '{ENTER}'` 翻页（目录页焦点默认在"安装"按钮）；完成页判定用 `EnumChildWindows` 找文字含 OrangeSea 的 Button 控件（UIA 的 CheckBox ControlType 对 NSIS 老控件不可靠）。
- 卸载器反馈页焦点落在多行输入框（ES_WANTRETURN 会吃掉 ENTER），自动点击用 `SendKeys '%u'`（"卸载(&U)"的 Alt 快捷键）。
- 截图判定用视觉模型逐项核对（输入框背景/边框、按钮底色、文字可读性、白色残留）。

## 已验证页面（2026-08-18 全绿）

安装器：欢迎页 / 目录页（输入框+浏览按钮暗色）/ 进度页（1018 深底 + 橙进度条 + 详情区暗色）/ 完成页（复选框米白字可读）。卸载器：反馈页（双输入框暗色 + 橙色提示 label）/ 卸载进度页 / 卸载完成页（米白文字）。

# 卸载反馈页（2026-08-18）

## 功能与开关

- 卸载向导第一页为「卸载反馈页」：品牌暗色风格（与安装器欢迎页同款 14100A/F5F0E6/FF7A3D 配色），含多行「建议 / 卸载原因」框、单行「联系方式」框（灰字提示），可全部留空直接下一步。
- 开关：`build/installer.nsh` 顶部的 `MINERADIO_FEEDBACK_ENDPOINT`。
  - **保持注释（默认）= 功能整体关闭**，卸载器恢复 electron-builder 默认欢迎页，行为与旧版完全一致（含默认外观与 DPI 行为）。
  - 取消注释并填入自建接收器的对外地址（形如 `https://你的域名/feedback`）即启用。
  - 接收器在 `tools/uninstall-feedback-server/`（零依赖 Node 单文件 + 部署文档），POST 收 JSON 转发 QQ 邮箱，GET 返回网页表单兜底页。
  - 内测版 `installer-internal-beta.nsh` 复用同一脚本，同一定义同时生效。
- 为什么自建：Formspree 注册依赖 Firebase（国内浏览器易卡）、formsubmit 与 web3forms 实测均拒绝服务端调用；自建无第三方限额、数据在自己手里。
- 安全边界不变：`customRemoveFiles`、`un.MineradioValidateUninstallDir`、`un.MineradioRemoveInstalledFiles` 与禁止递归删除等红线一律保留，反馈功能不触碰任何文件删除逻辑。

## 发送链路与约束

- 用户文本只经 `%TEMP%` 临时文件传递（绝不拼进 PowerShell 命令行，防注入）；发送完即删除。
- 发送脚本为纯 ASCII 无 BOM 的 `.ps1`（ASCII 在任何代码页下字节一致）；数据文件按 BOM 自动判别编码读回（本版 NSIS FileWrite 实际按 GBK 写出）。
- HTTP 用 `HttpWebRequest` 且 `Proxy=$null` 强制直连（系统代理/VPN 会劫持 127.0.0.1 与外网请求造成假成功）；超时 15s；2xx/3xx 视为成功。
- 发送失败 → 询问是否打开端点网页表单（自建接收器 GET 即表单页）→ 继续卸载；绝不因反馈失败阻塞或回滚卸载。
- `/S` 静默卸载与升级覆盖安装不显示反馈页、不发送任何内容。
- SMTP 授权码只放服务器环境变量（接收器侧），绝不嵌进安装包（可被解包提取）。

## 已知行为（测试实测结论）

- 本版 NSIS 的 `FileWrite` 按本地代码页（GBK）写出而非 UTF-16；`FileWriteWord` 写 BOM 后同句柄仍为 GBK——这就是发送脚本必须纯 ASCII、数据文件必须 BOM 判别的原因。
- PowerShell 对 `.ps1` 解析失败仍可能返回 exit 0（假成功），因此退出码判定只在其真正执行到状态码检查时可靠；脚本内函数名不可用单字母（`R` 会撞上内置别名 `r` = Invoke-History，别名优先级高于函数）。
- 卸载器 `$INSTDIR` 依赖注册表 `HKCU\Software\<appId>\InstallLocation`（MultiUser 初始化），该值缺失时会回退默认路径 `C:\...\Programs\OrangeSea` 并被安全校验拦截（报「无法确认当前目录属于 OrangeSea」）——属既有设计，非反馈功能引入。

# 2026-06-25 P0 Installer Safety Notes

- Full setup adoption rule: the installer may adopt an existing registered install only when the registered path itself is a dedicated `...\Mineradio` directory and contains Mineradio files or `.mineradio-install-root`; mixed parent folders and drive roots must stay blocked/quarantined.
- Quick patch rule: installer/uninstaller safety bugs cannot be fixed by a quick patch JSON alone, because the Windows uninstaller and install registry must be replaced by the full NSIS setup.

# 2026-06-26 Fixed Installer Packaging Baseline

- Future Windows releases must keep the repaired `v1.1.1` installer shape: custom NSIS pages and safety logic from `build/installer.nsh`, full setup `.exe`, `.blockmap`, `latest.yml`, and `SHA256SUMS`.
- Baseline release asset: `Mineradio-1.1.1-Setup.exe`, SHA256 `1d35750c5b9c5099bd608baa4cc8564d5a08a183dccb2aa7ab85ef613fd536f7`, size `115090051` bytes.
- Do not publish installer/uninstaller safety fixes as quick patch JSON only. They must be delivered by a full setup package so the Windows uninstaller and registry are replaced.
- Never remove `customRemoveFiles` or restore electron-builder's default recursive `$INSTDIR` deletion path. Keep deletion limited to known Mineradio/Electron top-level files and non-recursive empty-directory cleanup.
- Keep safe overwrite behavior: existing dedicated `...\Mineradio` folders containing Mineradio files can be overwritten; mixed folders, parent folders, drive roots, and user data folders must stay blocked or quarantined.

# Mineradio Installer Style

2026-06-22 用户确认保留当前安装包格式。以后发布安装包，默认沿用这套样式和流程，除非用户明确要求重做。

## 视觉方向

- 中文极简安装器。
- 主色：白底 `#FFFFFF`，主文字 `#111217`，弱文字 `#4B5263` / `#6B7280`，蓝色点缀 `#3257F7`。
- 不要再使用红色 MR、深色大卡片、复杂装饰、英文大段说明或黑底黑字。
- 顶部横幅和侧边图保持黑白蓝极简：`build/installerHeader.bmp`、`build/installerSidebar.bmp`。

## 页面结构

- 欢迎页只保留：
  - `MINERADIO`
  - `Mineradio 安装`
  - 简短中文说明
  - `默认位置：D:\Mineradio`
- 安装目录页只保留：
  - `选择安装位置`
  - 简短中文说明
  - `安装目录` 输入框
  - `浏览...` 按钮
  - `默认推荐：D:\Mineradio；选盘符会自动建文件夹。`

## 技术边界

- 使用 `build/installer.nsh` 的自定义欢迎页和自定义安装目录页。
- `package.json` 中 `build.nsis.allowToChangeInstallationDirectory` 保持 `false`，避免 electron-builder 原生目录页读取旧安装注册表后回填到 `AppData\Local\Programs\Mineradio`。
- 自定义目录页必须保留可编辑输入框和 `浏览...` 按钮。
- 默认路径通过 `MineradioUsePreferredInstallDir` 设置为 `D:\Mineradio`；命令行 `/D=` 参数仍可覆盖。
- 用户选择盘符根目录时，通过 `MineradioNormalizeInstallDir` 自动补成 `盘符:\Mineradio`。

## 发布前验证

发布前必须本地打开新生成的 `dist\Mineradio-版本-Setup.exe` 验证：

- 欢迎页显示中文极简样式，默认位置为 `D:\Mineradio`。
- 安装目录页输入框显示 `D:\Mineradio`。
- `浏览...` 按钮能弹出中文文件夹选择窗口。
- 验证时不要点 `安装`，确认后取消退出。

## 2026-06-25 安装安全补充

- 默认安装路径从 `D:\Mineradio` 开始按 D-Z 顺序选择第一个存在的盘；只有电脑不存在任何 D-Z 盘时，才允许默认落到 `C:\Mineradio`。
- 用户手动选择目录时，安装器必须强制落到独立 `Mineradio` 子文件夹；若 D-Z 盘存在，手动选择 C 盘也要阻止。
- 非空且无法识别为 Mineradio 的目录必须阻止安装，避免卸载阶段删除用户其它文件。
- 新安装器写入 `.mineradio-install-root` 标记；新卸载器必须先验证路径和标记/主程序/卸载器，再进入卸载。
- 新卸载器禁止使用 `RMDir /r $INSTDIR` 删除整个安装根目录，也禁止递归删除 `resources`、`locales` 等应用子目录；只能删除 Mineradio/Electron 顶层已知文件，最后用非递归 `RMDir "$INSTDIR"` 尝试移除空目录。
- 安装新版本时，若检测到旧版本没有 `.mineradio-install-root` 安全标记，必须跳过旧卸载器，只删除旧目录中的 `Uninstall Mineradio.exe` 单文件并清理卸载注册表，避免触发历史安装包的整目录递归删除逻辑。
