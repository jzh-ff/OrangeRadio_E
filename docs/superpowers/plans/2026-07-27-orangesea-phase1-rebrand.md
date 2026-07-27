# Phase 1：OrangeSea 换皮重塑品牌 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Mineradio 2.0.2 完整换皮为 OrangeSea（橘子海）品牌：应用身份、数据目录、前端品牌元素、图标、更新通道全部独立，与原版零冲突共存。

**Architecture:** 品牌信息分四层——打包层（package.json build 段）、主进程层（desktop/main.js 应用名/目录/托盘）、前端层（public/ 文本+样式+命名空间）、资源层（build/icon.ico 等美术资源）。自下而上逐层替换，最后全量 grep 兜底验证。

**Tech Stack:** Electron 42 / Node 20 / 原生 JS+CSS / electron-builder NSIS

**背景阅读：** `docs-dev/ARCHITECTURE.md`（架构）、`docs-dev/MODDING-GUIDE.md` 第四节（换皮清单）

---

## 关键约束（所有任务通用）

1. **不改 GPL-3.0 授权**：LICENSE 原样保留；NOTICE.md 追加衍生声明（Task 1 完成）
2. **更新的 `mineradio` 配置 key 保留**：server.js 用 `pkg.mineradio.update` 读取更新配置（server.js:465-504），key 名不动，只改内容，避免后端读不到配置
3. **localStorage key 全量替换**：`mineradio-*` → `orangesea-*`，新旧数据不迁移（换皮即新起点）
4. **全局 JS 桥名替换**：`window.MineradioSonicTopography`、`window.__mineradio*` → `window.OrangeseaSonicTopography`、`window.__orangesea*`
5. **CSS id/类名不动**：`.splash-word-mine` 等选择器名保留（改动面太大），只改其文字内容与视觉——样式留给 Phase 2
6. **提交规范**：每任务一个 commit，前缀 `rebrand:`

---

### Task 1: git 分支 + GPL 衍生声明

**Files:**
- Modify: `NOTICE.md`
- Create: `README.ORANGESEA.md`（新品牌说明，不动原 README）

- [ ] **Step 1: 创建换皮分支**

```bash
cd /d/ZCodeWP/MineRadio
git checkout -b orangesea-rebrand
```

- [ ] **Step 2: NOTICE.md 追加衍生声明**

在 `NOTICE.md` 文件末尾追加：

```markdown

---

## Derivative Work: OrangeSea（橘子海）

OrangeSea is a derivative work based on Mineradio 2.0.2 by XxHuberrr,
licensed under GPL-3.0. The original project: https://github.com/XxHuberrr/Mineradio

"Mineradio" name, MR Logo and original visual expressions belong to the original author.
OrangeSea uses its own brand identity and does not use the Mineradio name or logo as its own.

Modifications (Phase 1 - Rebrand):
- Rebranded application identity to OrangeSea / 橘子海
- Separated user data directory (%AppData%\OrangeSea) and cache directory (D:\OrangeSeaCache)
- Replaced application icon and installer artwork with original designs
- Disabled upstream update channel (pointed at original author's repository)
- Renamed localStorage namespace and internal bridge globals
```

- [ ] **Step 3: 创建新品牌 README**

Create `README.ORANGESEA.md`:

```markdown
# OrangeSea · 橘子海

Windows 沉浸式音乐播放器——日落渐变暗色视觉，粒子舞台、3D 歌词与桌面模式的私人音乐空间。

本项目是基于 [Mineradio](https://github.com/XxHuberrr/Mineradio)（GPL-3.0）的二次创作，
遵循 GPL-3.0 开源。原作者 XxHuberrr，详见 NOTICE.md。

## 开发

```bash
npm install
npm start
npm run build:win
```

## 文档

- 总体路线图：docs-dev/ROADMAP.md
- 技术架构：docs-dev/ARCHITECTURE.md
- 二创指南：docs-dev/MODDING-GUIDE.md
```

- [ ] **Step 4: Commit**

```bash
git add NOTICE.md README.ORANGESEA.md
git commit -m "rebrand: add GPL derivative notice and OrangeSea readme"
```

---

### Task 2: package.json 品牌字段与更新通道

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 修改品牌与打包字段**

对 `package.json` 做如下精确替换：

| 字段 | 原值 | 新值 |
|---|---|---|
| `"name"` (:2) | `"mineradio"` | `"orangesea"` |
| `"productName"` (:3) | `"Mineradio"` | `"OrangeSea"` |
| `"version"` (:4) | `"2.0.2"` | `"0.1.0"`（二创独立版本线） |
| `"description"` (:5) | 原描述 | `"橘子海 - Windows 沉浸式音乐播放器，日落渐变暗色视觉，融合桌面模式、歌词舞台、粒子视觉和 3D 歌单架。"` |
| `"author"` (:6) | `"Mineradio"` | `"OrangeSea"` |
| `"build.appId"` (:17) | `"com.mineradio.desktop"` | `"com.orangesea.desktop"` |
| `"build.productName"` (:18) | `"Mineradio"` | `"OrangeSea"` |
| `"build.win.executableName"` (:47) | `"Mineradio"` | `"OrangeSea"` |
| `"build.nsis.shortcutName"` (:65) | `"Mineradio"` | `"OrangeSea"` |
| `"build.nsis.artifactName"` (:72) | `Mineradio-${version}-Setup.${ext}` | `OrangeSea-${version}-Setup.${ext}` |

- [ ] **Step 2: 禁用上游更新通道**

`package.json:82-95` 的 `"mineradio"` 段（**key 名保留**，server.js 依赖它读取）：

```json
  "mineradio": {
    "update": {
      "provider": "none",
      "preview": false,
      "preferMirrors": false,
      "mirrors": []
    }
  },
```

同时删除 `"build.publish"` 段（:74-80，指向原作者 GitHub 仓库的发布配置）。

- [ ] **Step 3: 验证 JSON 合法且后端读配置不报错**

```bash
node -e "const p=require('./package.json'); console.log(p.name, p.productName, p.mineradio.update.provider)"
```
Expected: `orangesea OrangeSea none`

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "rebrand: package.json identity to OrangeSea, disable upstream update channel"
```

---

### Task 3: main.js 应用身份与数据目录

**Files:**
- Modify: `desktop/main.js`（多处）

- [ ] **Step 1: 应用名常量**

Read `desktop/main.js:95-150`，找到应用名/元数据定义区（`APP_METADATA`、`APP_NAME`、`APP_USER_MODEL_ID` 附近），执行替换（具体变量名以实际代码为准）：

```
'Mineradio' → 'OrangeSea'          （应用名、窗口标题）
'com.mineradio.desktop' → 'com.orangesea.desktop'  （AppUserModelID，Windows 任务栏分组）
```

注意 `MINERADIO_RUNTIME_NAME` 环境变量名（main.js:108 附近）可保留——它是进程内部约定，但为彻底起见同步改为 `ORANGESEA_RUNTIME_NAME`（grep 全文件确认所有引用点一并替换）。

- [ ] **Step 2: 用户数据目录**

`main.js:142-145` 附近 `app.setName(...)` 确认已随 Step 1 生效（%AppData%\OrangeSea 自动成立，因为 userData 路径派生自 app name）。

- [ ] **Step 3: 硬编码缓存目录（必须改，防与原版冲突）**

`main.js:274-303` 的 `defaultCacheRootPath()` / `normalizeCacheSettings()`：

```
'D:\\MineradioCache' → 'D:\\OrangeSeaCache'
'MineradioCache' → 'OrangeSeaCache'   （回退路径里的目录名同样替换）
```

- [ ] **Step 4: 托盘与其他 UI 文本**

```bash
grep -n "Mineradio" desktop/main.js | grep -iv "mineradio-" | head -40
```

逐个检查输出：托盘 tooltip、对话框标题、日志前缀中的 `Mineradio` → `OrangeSea`。
**保留不动**：`mineradio-*` 形式的 IPC channel 名（如 `mineradio-wallpaper-set-enabled`）——它们是 main.js 与 preload.js/前端之间的内部协议，改名需三端同步且风险高，留待后续技术债清理（记录在 ROADMAP）。

例外：`mineradio-current-fx-autosave-read-sync/save-sync` 两个 channel 同理保留。

- [ ] **Step 5: 语法检查 + Commit**

```bash
node --check desktop/main.js && echo OK
git add desktop/main.js
git commit -m "rebrand: main process identity, userData and cache dirs to OrangeSea"
```

---

### Task 4: 前端品牌文本（index.html + desktop-lyrics.html）

**Files:**
- Modify: `public/index.html`
- Modify: `public/desktop-lyrics.html`

- [ ] **Step 1: index.html 标题与 splash**

- `public/index.html:7` `<title>Mineradio</title>` → `<title>OrangeSea 橘子海</title>`
- splash 字标 DOM（`index.html:80-95`）：当前结构为 `Mine`+`rad`+装饰`i`+`o` 四段。改为两段式：

```html
<!-- 原结构（示例，以实际代码为准）：
<span class="splash-word-mine">Mine</span><span class="splash-word-radio">rad</span><span class="splash-word-i">i</span><span class="splash-word-o">o</span>
-->
<!-- 改为： -->
<span class="splash-word-mine">Orange</span><span class="splash-word-radio">Sea</span>
```

（删除装饰用 `splash-word-i` / `splash-word-o` 两个 span；CSS 选择器保留无妨，空规则不影响渲染。splash 渐变色留给 Phase 2。）

- splash 副标语（`index.html:92`）：`private visual radio` → `sunset visual radio`（日落视觉电台，贴合品牌意象）
- FX 控制台 kicker（`index.html:346`）：`MINERADIO VISUALS · 鼠标移开自动隐藏` → `ORANGESEA VISUALS · 鼠标移开自动隐藏`
- 更新弹窗 kicker（`index.html:1728`）：`MINERADIO` → `ORANGESEA`
- 标题栏（`index.html:21-60` 内 `.desktop-app-title` 等）：`Mineradio` → `OrangeSea`

- [ ] **Step 2: SVG 滤镜 id 全局替换**

`index.html:1116, 1142, 1168, 1194` 四个滤镜 id 含 `mineradio-` 前缀，且 CSS（`css/index.css:333, 338` 等）用 `url(#mineradio-...)` 引用。**两端必须同步**：

```bash
grep -rn "mineradio-control-glass\|mineradio-.*-filter" public/index.html public/css/index.css
```

对所有输出执行统一替换：`id="mineradio-` → `id="orangesea-`，CSS 中 `url(#mineradio-` → `url(#orangesea-`。
（JS 若按 id 引用也需同步：`grep -rn "mineradio-" public/js/ | grep -i filter`）

- [ ] **Step 3: desktop-lyrics.html 品牌文本**

`public/desktop-lyrics.html` 的 `:6`（title）、`:190, :225`（默认显示文本 `Mineradio`）、`:573, :754, :950`：

```
Mineradio → OrangeSea
```

默认待机文本建议改为 `OrangeSea · 橘子海`（:225 的 `default state.text`）。

- [ ] **Step 4: 全前端残留扫描**

```bash
grep -rni "mineradio" public/index.html public/desktop-lyrics.html public/css/ | grep -v "mineradio-.*-filter\|MR2\|mineradio-user-fx"
```

预期仅剩滤镜相关（Step 2 处理后应也无）与白名单项；逐个处理其余输出。

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/desktop-lyrics.html public/css/index.css
git commit -m "rebrand: frontend brand text, splash wordmark, svg filter ids"
```

---

### Task 5: localStorage 命名空间与全局桥名

**Files:**
- Modify: `public/js/modules/00-state/00-core-stores.js`
- Modify: `public/js/modules/07-fx/00-preset-archive-data.js`
- Modify: `public/sonic-topography-preset.js`
- Modify: `public/js/modules/` 下所有引用文件（grep 驱动）

- [ ] **Step 1: localStorage key 批量替换**

```bash
grep -rln "mineradio-" public/js/
```

对输出文件执行全局替换（sed 或编辑器批量替换）：

```
'mineradio-  →  'orangesea-
```

重点确认 `00-core-stores.js:91-161` 的 key 定义区全部命中（约 20+ 个 key，如 `mineradio-current-fx-autosave-v1` → `orangesea-current-fx-autosave-v1`）。

**同步处理** `public/js/preload-mode.js` 与 `public/desktop-lyrics.html` 内嵌脚本（若有 localStorage 引用）。

- [ ] **Step 2: 存档类型串与分享码前缀**

`07-fx/00-preset-archive-data.js`：
- `:44` `'mineradio-user-fx-archive'` → `'orangesea-user-fx-archive'`
- `:46` 分享码前缀 `'MR2'` → `'OS2'`（OrangeSea 2.0 存档格式；与原版分享码不互通，避免格式歧义）

同步修改：`public/default-user-fx-archive.json:2` 的 `"type": "mineradio-user-fx-archive"` → `"orangesea-user-fx-archive"`；
`00-state/05-packaged-fx-archive.js` 内同类型串（grep 确认）。

- [ ] **Step 3: 全局桥名替换**

```bash
grep -rln "MineradioSonicTopography\|__mineradio" public/
```

统一替换：

```
MineradioSonicTopography → OrangeseaSonicTopography   （含 window.MineradioSonicTopography 挂载点与所有引用）
__mineradioPerf → __orangeseaPerf
__mineradioRenderPerf → __orangeseaRenderPerf
__mineradioMainFrameGates → __orangeseaMainFrameGates
__mineradioDesktopLyricsApplyState → __orangeseaDesktopLyricsApplyState
```

已知文件（以 grep 实际输出为准）：`public/sonic-topography-preset.js`、`00-state/00-core-stores.js:101-102`、`11-main-loop.js:625-636`、`07-fx/04-preset-grid-uniforms.js:75`、`10-shell/04-desktop-overlay-fullscreen.js`、`public/desktop-lyrics.html`。

- [ ] **Step 4: 语法检查 + 残留扫描**

```bash
for f in $(grep -rln "orangesea" public/js/); do node --check "$f" || echo "FAIL: $f"; done
grep -rni "mineradio" public/ | grep -v "\.bin\|mineradio-" | head -20
```

第一条：无 FAIL 输出。
第二条：预期仅剩白名单（IPC channel 字符串、注释中的协议说明）。IPC channel 如 `desktop-lyrics.html` 里 `type: 'mineradio-desktop-lyrics-state'`（postMessage type，main.js/overlay 端有对应监听）——**保留**，与 Task 3 Step 4 同策略。

- [ ] **Step 5: Commit**

```bash
git add public/
git commit -m "rebrand: localStorage namespace, fx-archive type, share code prefix, global bridges"
```

---

### Task 6: 原创图标与安装器美术资源

**Files:**
- Create: `build/icon.svg`（源文件，原创设计）
- Create: `build/icon.ico`（多尺寸，构建用）
- Modify: `build/installerSidebar.bmp`、`build/installerHeader.bmp`（安装器美术，日落色系重绘）
- Create: `scripts/generate-icon.js`（生成脚本，可重复执行）

- [ ] **Step 1: 设计并生成 SVG 原创图标**

Create `build/icon.svg`——「日落橙圆 + 海浪弧线 + 声波点」原创设计（256 viewBox）：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a2340"/>
      <stop offset="0.55" stop-color="#3a2a5e"/>
      <stop offset="1" stop-color="#0c1220"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffc46b"/>
      <stop offset="0.6" stop-color="#ff7a3d"/>
      <stop offset="1" stop-color="#ff5e62"/>
    </linearGradient>
    <clipPath id="round"><rect x="8" y="8" width="240" height="240" rx="56"/></clipPath>
  </defs>
  <g clip-path="url(#round)">
    <rect x="8" y="8" width="240" height="240" fill="url(#sea)"/>
    <circle cx="128" cy="118" r="62" fill="url(#sun)"/>
    <path d="M8 150 Q48 134 88 150 T168 150 T248 150 L248 248 L8 248 Z" fill="#0c1220" opacity="0.82"/>
    <path d="M8 168 Q48 152 88 168 T168 168 T248 168 L248 248 L8 248 Z" fill="#101a30" opacity="0.9"/>
    <path d="M8 186 Q48 170 88 186 T168 186 T248 186 L248 248 L8 248 Z" fill="#16223c"/>
    <g fill="#ffc46b">
      <circle cx="84" cy="104" r="4"/>
      <circle cx="128" cy="92" r="5"/>
      <circle cx="172" cy="104" r="4"/>
    </g>
  </g>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="none" stroke="#ffc46b" stroke-opacity="0.35" stroke-width="3"/>
</svg>
```

设计语义：深蓝紫渐变海底（暗色基调）+ 橙红日落圆日（品牌色）+ 三层海浪（橘子海的"海"）+ 三个声波光点（音乐属性）。

- [ ] **Step 2: 生成多尺寸 ICO**

Create `scripts/generate-icon.js`：用纯 Node 把 SVG 光栅化为 16/24/32/48/64/128/256 PNG 并打包成 ICO。

技术路线（无原生依赖）：`sharp` 不在依赖里，改用 Electron 自带的 `nativeImage`：
```js
// scripts/generate-icon.js（在已 npm install 的项目内运行）
// 用法：node scripts/generate-icon.js
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const svgPath = path.join(__dirname, '..', 'build', 'icon.svg');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of sizes) {
    const img = nativeImage.createFromPath(svgPath);
    const resized = img.resize({ width: size, height: size, quality: 'best' });
    pngs.push({ size, buf: resized.toPNG() });
  }
  // 手工拼 ICO：ICONDIR + N×ICONDIRENTRY + PNG 数据块（Vista+ 支持 PNG 内嵌）
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + pngs.length * 16;
  const entries = [];
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);      // 宽度（256 记 0）
    e.writeUInt8(size === 256 ? 0 : size, 1);      // 高度
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += buf.length;
  }
  fs.writeFileSync(
    path.join(__dirname, '..', 'build', 'icon.ico'),
    Buffer.concat([header, ...entries, ...pngs.map(p => p.buf)])
  );
  console.log('icon.ico written:', pngs.map(p => p.size).join('/'));
  app.quit();
});
```

Run:
```bash
node_modules/.bin/electron scripts/generate-icon.js
```
Expected: `icon.ico written: 16/24/32/48/64/128/256`

（备选：若 nativeImage 对 SVG 支持不佳，改用 `npm i -D sharp` 光栅化后同样拼 ICO；执行时先试主路线。）

- [ ] **Step 3: 安装器美术（日落色系 BMP）**

`build/installerSidebar.bmp`（164×314）与 `build/installerHeader.bmp`（150×57）：
用 `scripts/generate-installer-art.js`（同 Step 2 的 nativeImage 路线）：SVG 绘制深海渐变底 + 底部橙色海浪条 + "OrangeSea" 字样 → 导出 BMP（nativeImage.toBitmap 转 BMP 需自写 BMP 头；或用 toPNG 后 `npm i -D png-to-bmp` 转换——执行时选依赖最少路径）。

Sidebar SVG 要点：`#0c1220→#1a2340` 纵向渐变底，底部 1/4 海浪弧线（同 icon.svg 的 path 风格），中部偏上放 icon 圆形缩小版。

- [ ] **Step 4: 验证**

```bash
ls -la build/icon.ico build/icon.svg
file build/icon.ico 2>/dev/null || node -e "const b=require('fs').readFileSync('build/icon.ico');console.log('reserved:',b.readUInt16LE(0),'type:',b.readUInt16LE(2),'count:',b.readUInt16LE(4))"
```
Expected: `reserved: 0 type: 1 count: 7`

- [ ] **Step 5: Commit**

```bash
git add build/ scripts/
git commit -m "rebrand: original OrangeSea icon and installer artwork (sunset over sea)"
```

---

### Task 7: 后端品牌文本与配置

**Files:**
- Modify: `server.js`（少量，品牌字符串）
- Check: `desktop/startup.html`

- [ ] **Step 1: server.js 品牌字符串**

```bash
grep -n "Mineradio\|mineradio" server.js | grep -v "MINERADIO_\|mineradio\.update\|mineradio-desktop-lyrics" | head -30
```

处理输出中的：启动横幅文字（`server.js` listen 回调附近的 console 输出，约 `server.js:7284`）、`/api/app/version` 返回的应用名、User-Agent 字符串（若有 `Mineradio/x.y` UA）。
**保留**：`MINERADIO_*` 环境变量名（与 main.js 注入端一致，改动需两端同步，列入技术债）、`pkg.mineradio` 配置 key。

`desktop/startup.html`（启动页）：检查其中的 `Mineradio` 文字 → `OrangeSea`。

- [ ] **Step 2: 环境变量两端同步检查**

Task 3 Step 1 若已将 `MINERADIO_RUNTIME_NAME` 改名，此处 grep 确认 server.js/cuefield/ 无残留旧名引用：

```bash
grep -rn "MINERADIO_RUNTIME_NAME\|MINERADIO_" server.js cuefield/ dj-analyzer.js *-api.js | grep -v "MINERADIO_BEAT_CACHE_DIR\|MINERADIO_UPDATE_DIR\|MINERADIO_UPDATE_"
```

注意 `MINERADIO_BEAT_CACHE_DIR` / `MINERADIO_UPDATE_DIR` 等由 main.js 注入（main.js:5454-5475），**改名必须两端同改**——本计划统一策略：环境变量名全部保留 `MINERADIO_` 前缀不改（纯内部约定，用户不可见），仅修改用户可见文本。在 ROADMAP 技术债区记录。

- [ ] **Step 3: 语法检查 + Commit**

```bash
node --check server.js && echo OK
git add server.js desktop/startup.html
git commit -m "rebrand: server banner and user-visible strings to OrangeSea"
```

---

### Task 8: 全量验证

**Files:** 无新增（验证任务）

- [ ] **Step 1: 全仓库残留扫描（白名单制）**

```bash
grep -rni "mineradio" --include="*.js" --include="*.html" --include="*.css" --include="*.json" --include="*.md" . | grep -v "node_modules\|\.git/\|dist/\|docs-dev/\|LICENSE\|NOTICE.md\|CHANGELOG.md\|README.md" | grep -vi "mineradio-desktop-lyrics-state\|MINERADIO_\|pkg.mineradio\|mineradio\.update\|'mineradio'" | head -40
```

逐条审查输出。白名单（允许存在）：NOTICE.md/LICENSE/CHANGELOG.md/README.md（原项目归属信息）、IPC channel 名、环境变量名、`package.json` 的 `mineradio` 配置 key、docs-dev/ 架构文档中的引用。
其余一律替换。预期处理后输出 ≤ 20 条且全部可解释。

- [ ] **Step 2: 运行验证清单**

```bash
npm start
```

人工确认（截图记录）：
1. 启动 splash 显示 `OrangeSea` 字标 + `sunset visual radio` 副标语
2. 标题栏显示 `OrangeSea`
3. 托盘 tooltip 为 `OrangeSea`
4. 数据目录已创建：`ls "%AppData%/OrangeSea"`（Git Bash: `ls "$APPDATA/OrangeSea"`）
5. 缓存目录：`ls /d/OrangeSeaCache`（D 盘存在时）
6. FX 控制台 kicker 显示 `ORANGESEA VISUALS`
7. 搜索一首歌能正常播放（核心功能无回归）
8. 视觉存档保存/加载正常（localStorage 新命名空间生效）
9. 关于/更新入口不再检查原作者 release（provider:none 生效，`/api/update/latest` 应返回无更新或禁用态）

- [ ] **Step 3: 打包验证**

```bash
npm run build:win:dir
```

确认：`dist/win-unpacked/OrangeSea.exe` 生成，双击运行后窗口标题/托盘均为 OrangeSea。
（NSIS 完整安装包 `npm run build:win` 可在 Phase 1 全部结束后选跑，验证 artifactName 与图标。）

- [ ] **Step 4: 收尾 Commit + 合并**

```bash
git add -A
git commit -m "rebrand: phase 1 complete - OrangeSea identity verified" --allow-empty
git checkout main && git merge orangesea-rebrand
```

（或保留分支待 Phase 2 完成后一起合并，执行时定。）

---

## 技术债记录（Phase 1 有意保留，后续处理）

| 项 | 原因 | 处理时机 |
|---|---|---|
| IPC channel 名仍为 `mineradio-*` | main.js/preload.js/前端三端协议，改名风险高收益低 | 稳定版本后专项清理 |
| 环境变量 `MINERADIO_*` 前缀 | main.js↔server.js 两端注入/读取需同步改 | 同上 |
| `package.json` 的 `mineradio` 配置 key | server.js 硬编码读取路径 | 同上 |
| 原版用户数据不迁移（%AppData%\Mineradio） | 换皮即新起点，避免继承旧存档引发兼容问题 | 如用户要求再加迁移向导 |

## Self-Review 结论

- ✅ 覆盖 ROADMAP Phase 1 全部范围：品牌字段/应用身份/数据目录/前端文本/命名空间/图标/法律文件/更新通道/验证
- ✅ 无 TBD/占位符；所有替换给出精确旧值→新值或 grep 驱动定位
- ✅ 命名一致性：`OrangeSea`（产品）/`orangesea`（包名与 key 前缀）/`com.orangesea.desktop`（appId）/`OrangeSeaCache`（缓存目录）/`OS2`（分享码）全计划统一
- ⚠️ 行号基于 2.0.2 源码分析，执行时以 grep 实际定位为准（步骤已按 grep 优先设计）
