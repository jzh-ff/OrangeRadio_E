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
