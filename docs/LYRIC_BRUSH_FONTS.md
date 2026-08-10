# 歌词毛笔书法字体

为「视觉控制台 → 歌词 → 歌词字体」网格新增 4 款适合歌词展示的毛笔书法风格字体。采用**混合加载**策略：主力字体本地打包保证离线可用，其余走 Google Fonts CDN。

## 字体清单

| 键名 (`data-font`) | 显示名 | 字体家族 | 风格 | 加载方式 | 授权 |
|---|---|---|---|---|---|
| `mashan` | 毛笔行楷 | Ma Shan Zheng（马善政） | 行楷（端正毛笔，最接近手写） | 📦 **本地打包** `public/fonts/MaShanZheng.woff2` | SIL OFL 1.1 |
| `longcang` | 龙藏行书 | Long Cang（龙藏） | 行书/行草（飘逸） | ☁️ Google Fonts CDN | SIL OFL 1.1 |
| `liucao` | 狂放草书 | Liu Jian Mao Cao（刘建毛草） | 草书（狂放） | ☁️ Google Fonts CDN | SIL OFL 1.1 |
| `xiaowei` | 清秀小楷 | ZCOOL XiaoWei（站酷小薇） | 小楷（清秀古朴） | ☁️ Google Fonts CDN | SIL OFL 1.1 |

> 4 款均为 **SIL Open Font License 1.1**，允许商用、打包、修改、再分发。

## 设计取舍

- **为什么混合加载**：中文字体体积大（每款 woff2 3–8MB），全部本地打包会让安装包膨胀 20MB+。挑最常用、最具代表性的行楷（马善政）本地打包，兼顾离线可用与体积控制；其余 3 款走 CDN，首次联网后浏览器自动缓存。
- **离线降级**：未联网时，3 款 CDN 字体会回退到 CSS 栈中的系统字体（Kaiti SC / STKaiti / KaiTi / STCaoshu 等楷体/草书），在装有书法字体的系统上仍有近似效果；毛笔行楷因本地打包始终可用。
- **字重处理**：书法字体仅提供单一字重（400），`lyricFontWeightValue()` 对这 4 个键强制返回 400，避免用户拖动「字重」滑块时用高字重把字形压糊（笔锋丢失）。

## 字体栈映射

`public/js/modules/02-visual/05-lyrics-fonts-texture.js` 的 `lyricFontStackForKey()`：

```js
if (key === 'mashan')   return '"Ma Shan Zheng","Kaiti SC","STKaiti","KaiTi",cursive';
if (key === 'longcang') return '"Long Cang","Kaiti SC","STKaiti","KaiTi",cursive';
if (key === 'liucao')   return '"Liu Jian Mao Cao","STCaoshu","STKaiti","KaiTi",cursive';
if (key === 'xiaowei')  return '"ZCOOL XiaoWei","Source Han Serif SC","SimSun","Songti SC",serif';
```

`builtinLyricFontKeyPattern()` 正则已加入 `mashan|longcang|liucao|xiaowei`，使这 4 个键被识别为合法内置字体键（而非自定义上传字体）。

## 字体加载声明

### 主窗口 `public/index.html`
- `<head>` 的 Google Fonts `<link>` 追加了 `Long+Cang`、`Liu+Jian+Mao+Cao`、`ZCOOL+XiaoWei` 三款 CDN 字体。
- 紧随其后用内联 `<style>` 声明本地打包的 Ma Shan Zheng `@font-face`：
  ```css
  @font-face {
    font-family: "Ma Shan Zheng";
    src: url("fonts/MaShanZheng.woff2") format("woff2");
    font-weight: 400; font-style: normal; font-display: swap;
  }
  ```

### 桌面悬浮歌词层 `public/desktop-lyrics.html`
该 HTML 是独立 Electron 窗口，原先未引入任何 Web 字体。已补充：
- Google Fonts `<link>`（含 Inter / Noto Sans SC / 三款 CDN 书法字体）
- Ma Shan Zheng 本地 `@font-face`（相对路径 `fonts/MaShanZheng.woff2` 解析到同一静态服务）

否则桌面歌词切换到这些字体时会回退到系统字体。

## CSP 配置

`desktop/main.js` 的 `LOCAL_APP_CSP` 已放行：
- `style-src ... https://fonts.googleapis.com` —— CDN CSS
- `font-src 'self' data: https://fonts.gstatic.com` —— 本地字体（`'self'`）+ CDN 字体本体（`gstatic`）+ 用户上传字体的 `data:` URL

**无需修改 CSP**。

## 渲染链路（自动复用，无需额外绑定）

新增的 4 个字体按钮自动接入既有的完整链路：

```
用户点击按钮 (index.html #lyric-font-grid)
  → setLyricFont(key)                              [07-fx/03-cover-picker-fonts.js:120]
  → fx.lyricFont = key
  → refreshCurrentLyricStyle()                     重绘 Canvas 蒙版纹理
  → saveLyricLayout()                              持久化到 localStorage + 磁盘
  → pushDesktopLyricsState(true)                   推送到桌面悬浮层
```

具体复用的既有函数：
- `lyricFontCss()` / `lyricFontStackForKey()` —— Canvas 2D `ctx.font` 赋值（蒙版纹理生成）
- `updateLyricFontControls()` —— 遍历 `#lyric-font-grid button` 同步 active 态（新按钮自动纳入）
- `desktopLyricsPayload().fontFamily` —— 推送字体栈到桌面层
- 全屏歌词特效 `16-fullscreen-lyric-fx.js` 复用 `makeLyricMask`，自动继承新字体

## 扩展/替换字体（开发指南）

### 替换本地打包的字体
1. 用新字体替换 `public/fonts/MaShanZheng.woff2`（或新增文件）。
2. 修改 `public/index.html` 和 `public/desktop-lyrics.html` 里 `@font-face` 的 `font-family` 名称和 `src` 路径。
3. 修改 `05-lyrics-fonts-texture.js` 的 `lyricFontStackForKey()` 对应分支的字体栈首项。

### 新增更多书法字体（走 CDN）
1. 在 `public/index.html` 的 Google Fonts `<link>` URL 末尾追加 `&family=字体名`。
2. 在 `desktop-lyrics.html` 的 `<link>` 同步追加。
3. 在 `builtinLyricFontKeyPattern()` 正则加入新键。
4. 在 `lyricFontStackForKey()` 加对应 if 分支。
5. 在 `index.html` 的 `#lyric-font-grid` 加 `<button data-font="新键">显示名</button>`。
6. （可选）在 `index.css` 加 `.fx-font-grid button[data-font="新键"]` 预览样式。

### 字体子集化（减小本地字体体积）
当前 `MaShanZheng.woff2`（3.1MB）是完整字符集。若需进一步压缩，可用 `fonttools` 按歌词常用字做子集：
```bash
pyftsubset MaShanZheng.ttf \
  --text-file=常用字表.txt \
  --output-format=woff2 \
  --output-file=MaShanZheng.woff2
```

## 验证清单
- [x] 视觉控制台 → 歌词 → 歌词字体网格出现 4 个新按钮，按钮文字以对应书法字体预览
- [x] 依次点击 4 款字体，歌词区文字立即变为对应毛笔效果
- [x] 切换后刷新应用，字体选择被持久化
- [x] 开启「桌面悬浮歌词」切换字体，桌面层文字同步变化
- [x] 离线情况下毛笔行楷（本地打包）仍可用
