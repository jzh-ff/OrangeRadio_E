/* =========================================================================
   OrangeSea · 涂鸦墙（Graffiti Wall · 暗夜墨光）
   满屏涂鸦歌词模式：一句歌词用行草书法大字铺满屏幕，逐字/逐词蹦出。
   照抄 film-radio 范式：body.graffiti + localStorage + 四层叠加覆盖层。
   完全盖住 3D 场景（无镜头、无粒子），只展示歌词。

   四层氛围：L0 模糊封面 / L0.5 暗化遮罩 / L1 双光晕呼吸 / L2 墨光粒子 / L3 歌词。
   多语言排版：分词渲染（拉丁词不可拆行 + 固定词距 + CJK 逐字 + 标点缩小）；
   入场动画池：8 种 data-anim 每句稳定随机，静态错位与入场动效解耦。
   ========================================================================= */

var GRAFFITI_STORE_KEY = 'orangesea-graffiti-v1';
var graffitiMode = readBooleanPreference(GRAFFITI_STORE_KEY, false);
var graffitiRafId = 0;
var graffitiLastLineIdx = -99;
var graffitiCurrentLine = null;
var graffitiChars = [];          /* [{ el, reveal }] reveal=相对行开始的秒数 */
var graffitiLineStartT = 0;
var graffitiPrevQuality = null;
var graffitiObserver = null;
var graffitiLyricsObserverToken = 0;
var graffitiResizeTimer = 0;

/* 粒子状态 */
var graffitiParticles = [];
var graffitiParticleSprite = null;   /* 离屏预渲染光点精灵，避免每帧 createRadialGradient */
var graffitiCanvasCtx = null;
var graffitiCanvasW = 0;
var graffitiCanvasH = 0;
var graffitiBassEnergy = 0;       /* 低频能量 0~1，驱动粒子亮度 */
var graffitiLastFontKey = '';     /* 字体/颜色变化检测（选择器实时同步） */
var graffitiLastColor = '';

/* ---------- 切换 ---------- */
function applyGraffitiMode(on, opts) {
  opts = opts || {};
  graffitiMode = !!on;
  /* 三方双向互斥：进入涂鸦墙时先退出胶片电台与风格电台（Genre Mode） */
  if (graffitiMode && typeof filmRadioMode !== 'undefined' && filmRadioMode && typeof applyFilmRadioMode === 'function') {
    applyFilmRadioMode(false, { save: true });
  }
  if (graffitiMode && typeof genreMode !== 'undefined' && genreMode && typeof applyGenreMode === 'function') {
    applyGenreMode(false, { save: true });
  }
  document.body.classList.toggle('graffiti', graffitiMode);
  var overlay = document.getElementById('graffiti-overlay');
  if (overlay) overlay.setAttribute('aria-hidden', graffitiMode ? 'false' : 'true');
  if (opts.save) saveBooleanPreference(GRAFFITI_STORE_KEY, graffitiMode);
  if (graffitiMode) {
    startGraffiti();
    /* 3D 场景已被覆盖层盖住：临时切 eco 质量档让出帧预算 */
    if (typeof fx !== 'undefined' && fx && graffitiPrevQuality === null) {
      graffitiPrevQuality = fx.performanceQuality || 'balanced';
      fx.performanceQuality = 'eco';
    }
  } else {
    stopGraffiti();
    if (graffitiPrevQuality !== null && typeof fx !== 'undefined' && fx) {
      fx.performanceQuality = graffitiPrevQuality;
      graffitiPrevQuality = null;
    }
  }
  if (typeof refreshPresetGrid === 'function') refreshPresetGrid();
  if (opts.toast) showToast(graffitiMode ? '涂鸦墙已开启' : '已切回标准模式');
  if (opts.animate && window.gsap) {
    /* 无独立按钮，卡片动画由 refreshPresetGrid 处理 */
  }
}

function toggleGraffitiMode() {
  applyGraffitiMode(!graffitiMode, { save: true, toast: true });
}

/* ---------- 启动 / 停止 ---------- */
function startGraffiti() {
  syncGraffitiCover();
  syncGraffitiStyle();
  initGraffitiParticles();
  graffitiLastLineIdx = -99;     /* 强制主循环首帧渲染当前行 */
  startGraffitiObserver();
  startGraffitiLoop();
}

function stopGraffiti() {
  stopGraffitiLoop();
  stopGraffitiObserver();
  graffitiLastLineIdx = -99;
  graffitiCurrentLine = null;
  graffitiChars = [];
  graffitiParticles = [];
  clearGraffitiLine();
  if (graffitiCanvasCtx && graffitiCanvasW && graffitiCanvasH) {
    graffitiCanvasCtx.clearRect(0, 0, graffitiCanvasW, graffitiCanvasH);
  }
}

/* ---------- 封面 / 样式同步 ---------- */
function syncGraffitiCover() {
  var src = document.getElementById('control-cover');
  var cover = document.getElementById('graffiti-cover');
  if (!src || !cover) return;
  /* 优先读 inline style，兜底用 computed style（部分场景封面由 CSS 而非 inline 设置） */
  var bg = src.style.backgroundImage || '';
  if (!bg || bg === 'none') bg = getComputedStyle(src).backgroundImage || '';
  if (bg && bg !== 'none') {
    if (cover.style.backgroundImage !== bg) cover.style.backgroundImage = bg;
    cover.classList.remove('cover-empty');
  } else {
    cover.classList.add('cover-empty');
  }
}

/* 跟随用户字体/颜色选择（复用全局 fx.lyricFont / fx.lyricColor） */
function syncGraffitiStyle() {
  var overlay = document.getElementById('graffiti-overlay');
  if (!overlay) return;
  var fontKey = (typeof fx !== 'undefined' && fx && fx.lyricFont) ? fx.lyricFont : 'liucao';
  /* 默认用行草体；非书法字体也允许（用户自选） */
  var stack = (typeof lyricFontStackForKey === 'function')
    ? lyricFontStackForKey(fontKey)
    : '"Liu Jian Mao Cao","STCaoshu","KaiTi",cursive';
  overlay.style.setProperty('--gw-font', stack);
  var color = (typeof fx !== 'undefined' && fx && fx.lyricColor) ? fx.lyricColor : '#d7d2c4';
  overlay.style.setProperty('--gw-ink', color);
  overlay.style.setProperty('--gw-glow', graffitiHexToGlow(color));
  graffitiLastFontKey = fontKey;
  graffitiLastColor = color;
}

/* 检测用户在字体/颜色选择器里的变更，实时同步（无需退出重进） */
function checkGraffitiStyleChange() {
  if (!graffitiMode) return;
  var fontKey = (typeof fx !== 'undefined' && fx && fx.lyricFont) ? fx.lyricFont : 'liucao';
  var color = (typeof fx !== 'undefined' && fx && fx.lyricColor) ? fx.lyricColor : '#d7d2c4';
  if (fontKey !== graffitiLastFontKey || color !== graffitiLastColor) {
    syncGraffitiStyle();
    graffitiLastLineIdx = -99;   /* 字体变了，字号需重测 */
  }
}

function graffitiHexToGlow(hex) {
  var m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return 'rgba(215,210,196,0.34)';
  var r = parseInt(m[1].slice(0, 2), 16);
  var g = parseInt(m[1].slice(2, 4), 16);
  var b = parseInt(m[1].slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',0.36)';
}

/* ---------- 状态同步（MutationObserver 监听封面变化） ---------- */
function startGraffitiObserver() {
  stopGraffitiObserver();
  graffitiObserver = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var target = mutations[i].target;
      var id = target.id || (target.parentElement && target.parentElement.id) || '';
      if (id === 'control-cover') {
        syncGraffitiCover();
      } else if (id === 'control-title-text') {
        /* 切歌：标题变化 → 重算封面/样式 + 强制重渲染当前行 */
        syncGraffitiCover();
        syncGraffitiStyle();
        graffitiLastLineIdx = -99;
      }
    }
  });
  var cover = document.getElementById('control-cover');
  if (cover) graffitiObserver.observe(cover, { attributes: true, attributeFilter: ['style'] });
  var title = document.getElementById('control-title-text');
  if (title) graffitiObserver.observe(title, { characterData: true, childList: true, subtree: true });
}

function stopGraffitiObserver() {
  if (graffitiObserver) {
    graffitiObserver.disconnect();
    graffitiObserver = null;
  }
}

/* ---------- 字号自适应（自然换行铺满） ----------
   把整句填入容器（opacity:0 占位），二分查找让总高度 ≤ 可视区 74% 的最大字号。
   flex-wrap 会自动换行：短句一行巨字，长句 2~3 行。 */
function fitGraffitiFontSize(container) {
  if (!container) return;
  var maxH = (window.innerHeight - 124) * 0.74;   /* 减控制栏后的可视区高度 */
  var maxW = container.clientWidth || Math.round(window.innerWidth * 0.84);
  var lo = 32;
  var hi = Math.round(window.innerHeight * 0.46);  /* 上限 ≈ 半屏高 */
  /* 测量期间以 is-measuring 中和入场独立属性：scale/translate 与 transform 一样
     计入祖先 scrollable overflow，未点亮字符的初始态（rise 的 0.72em 位移、
     zoom 的 1.85 倍放大等）会撑大 scrollHeight/scrollWidth 读数导致字号偏小 */
  container.classList.add('is-measuring');
  /* 二分收敛：高度不超限，且单个不可拆长词（德文复合词等）不横向溢出 */
  container.style.fontSize = hi + 'px';
  var guard = 0;
  while (hi - lo > 3 && guard < 40) {
    guard++;
    var mid = (lo + hi) >> 1;
    container.style.fontSize = mid + 'px';
    if (container.scrollHeight <= maxH && container.scrollWidth <= maxW + 2) {
      lo = mid;       /* 还能更大 */
    } else {
      hi = mid;
    }
  }
  container.style.fontSize = lo + 'px';
  container.classList.remove('is-measuring');
  return lo;
}

/* ---------- 涂鸦随机种子（稳定不闪烁） ---------- */
function graffitiCharSeed(lineIdx, charIdx, salt) {
  var s = (((lineIdx + 1) * 131 + (charIdx + 1) * 911 + (salt || 0) * 53) % 1000);
  return (s < 0 ? s + 1000 : s) / 1000;  /* 0~1 */
}

/* ---------- 多语言分词（tokenize） ----------
   把一行歌词拆成排版 token，解决拉丁文"词"结构丢失问题：
     word  —— 连续拉丁/西里尔/希腊字母数字（含词内撇号连字符），整词不可拆行；
     char  —— CJK 逐字（中文/假名/谚文音节）及 emoji 等其他码点；
     punct —— 全/半角标点（缩小、不旋转）；
     space —— 空白折叠为固定宽度词距占位，与字体空格度量脱钩。
   每个字符带全局码点索引 i，与 reveals 时间表对齐。 */
var GRAFFITI_PUNCT_CHARS = '，。、！？：；·「」『』（）《》【】〈〉“”‘’¡¿!?.,;:\'"()[]%&@#~～‐‑‒–—―';
var GRAFFITI_LATIN_CORE_RE = /^[A-Za-z0-9]$/;
var GRAFFITI_DIGIT_RE = /^\d$/;

/* grapheme 分簇器：ZWJ emoji（👨‍👩‍👧）、国旗（🇨🇳）、组合重音（é 的 NFD 分解式 e+́）
   等整簇作为一个显示单元，避免按码点劈开渲染成碎片。
   Intl.Segmenter 不可用时 heads 恒等，退化为逐码点行为。 */
var graffitiGraphemeSegmenter = (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function')
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

function graffitiIsWordLetter(ch, cp) {
  if (GRAFFITI_LATIN_CORE_RE.test(ch)) return true;
  return (cp >= 0x00c0 && cp <= 0x024f) ||   /* 拉丁补充/扩展（é ñ ü…） */
    (cp >= 0x1e00 && cp <= 0x1eff) ||         /* 拉丁扩展附加（越南语等） */
    (cp >= 0x0400 && cp <= 0x052f) ||         /* 西里尔（俄语等） */
    (cp >= 0x0370 && cp <= 0x03ff);           /* 希腊 */
}

/* 码点索引 → 簇首码点索引映射（簇内非首码点渲染时并入簇首单元） */
function graffitiClusterHeads(text, chars) {
  var heads = new Array(chars.length);
  for (var i = 0; i < chars.length; i++) heads[i] = i;
  if (!graffitiGraphemeSegmenter || !text) return heads;
  /* segmenter 的 index 是 UTF-16 code unit 偏移，先建 code unit→码点映射 */
  var cuToCp = new Array(text.length + 1);
  var cu = 0;
  for (var ci = 0; ci < chars.length; ci++) {
    for (var k = 0; k < chars[ci].length; k++) cuToCp[cu + k] = ci;
    cu += chars[ci].length;
  }
  cuToCp[text.length] = chars.length;
  var segs = graffitiGraphemeSegmenter.segment(text);
  var cuPos = 0;
  while (cuPos < text.length) {
    var s = segs.containing(cuPos);
    if (!s) break;
    var endCu = s.index + s.segment.length;
    if (endCu <= cuPos) break;                 /* 防御死循环 */
    var headCp = cuToCp[s.index];
    for (var cu2 = s.index; cu2 < endCu && cu2 <= text.length; cu2++) {
      heads[cuToCp[cu2]] = headCp;
    }
    cuPos = endCu;
  }
  return heads;
}

function tokenizeGraffitiText(text) {
  text = String(text || '');
  var chars = Array.from(text);
  var heads = graffitiClusterHeads(text, chars);
  var tokens = [];
  var curWord = null;
  function flushWord() {
    if (curWord) { tokens.push(curWord); curWord = null; }
  }
  for (var i = 0; i < chars.length; i++) {
    if (heads[i] !== i) continue;              /* 簇内非首码点：并入簇首单元 */
    var nextHead = i + 1;
    while (nextHead < chars.length && heads[nextHead] === i) nextHead++;
    var ch = chars[i];
    var clusterText = (nextHead === i + 1) ? ch : chars.slice(i, nextHead).join('');
    if (/\s/.test(ch)) {
      flushWord();
      /* 连续/前导空白折叠为一个词距占位（line.text 已折叠单空格，防御多余空白） */
      if (tokens.length && tokens[tokens.length - 1].type !== 'space') {
        tokens.push({ type: 'space' });
      }
      continue;
    }
    var cp = ch.codePointAt(0);
    /* 撇号/连字符：前接或后接词字母时算词内（don't / 'n' / well-known），
       否则按标点（引号）或普通字符处理 */
    var isJoiner = (ch === "'" || ch === '’' || ch === '-' || ch === '‐');
    var nextIsLetter = nextHead < chars.length &&
      graffitiIsWordLetter(chars[nextHead], chars[nextHead].codePointAt(0));
    /* 小数点：两侧皆数字时入词（3.14 不断词） */
    var isDecimalDot = ch === '.' && curWord && nextHead < chars.length &&
      GRAFFITI_DIGIT_RE.test(curWord.chars[curWord.chars.length - 1].c) &&
      GRAFFITI_DIGIT_RE.test(chars[nextHead]);
    if (graffitiIsWordLetter(ch, cp) || isDecimalDot || (isJoiner && (curWord || nextIsLetter))) {
      if (!curWord) curWord = { type: 'word', chars: [] };
      curWord.chars.push({ c: clusterText, i: i });
      continue;
    }
    flushWord();
    if (GRAFFITI_PUNCT_CHARS.indexOf(ch) >= 0) {
      tokens.push({ type: 'punct', chars: [{ c: clusterText, i: i }] });
    } else {
      tokens.push({ type: 'char', chars: [{ c: clusterText, i: i }] });
    }
  }
  flushWord();
  return tokens;
}

/* ---------- 入场动画池（每句随机，data-anim 驱动 CSS 变量组） ----------
   静态涂鸦错位留在 transform（--gw-rot/--gw-dy，恒定不参与动画）；
   入场动效用 CSS 独立属性 translate/scale/rotate/filter（Chromium 104+），
   由 [data-anim] 上的 --gw-f* 变量组驱动；旧浏览器自动降级为淡入。 */
var GRAFFITI_ANIMS = ['pop', 'rise', 'drop', 'ink', 'spin', 'zoom', 'slide', 'flash'];
var GRAFFITI_ANIM_BASE_DUR = {
  pop: 0.46, rise: 0.55, drop: 0.50, ink: 0.62,
  spin: 0.55, zoom: 0.50, slide: 0.48, flash: 0.14
};

function pickGraffitiAnim(lineIdx) {
  var s = graffitiCharSeed(lineIdx, 0, 99);
  return GRAFFITI_ANIMS[Math.floor(s * GRAFFITI_ANIMS.length) % GRAFFITI_ANIMS.length];
}

/* ---------- 逐字揭示时间表 ----------
   YRC：按每个 word 的真实时序（word.t / word.d），字内均分；
   LRC：在该行 duration 前 70% 内均分，加稳定抖动去机械感（单调不减）。
   opts.groupByWord：拉丁词整词同刻蹦出（YRC 用真实词时序，LRC 按词均分）。

   注意：YRC 的 w.c0/c1 是 UTF-16 code unit 索引（parseYrcText 用 fullText.length
   累计），而渲染拆字按 Unicode 码点——emoji 等 BMP 外字符会让两边错位。
   这里建 code unit → 码点索引映射表统一换算。 */
function computeGraffitiReveals(line, text, opts) {
  opts = opts || {};
  var chars = Array.from(String(text || ''));
  var charCount = chars.length;
  var reveals = new Array(charCount).fill(-1);
  if (!charCount) return reveals;
  /* code unit 偏移 → 码点索引：cuToChar[cu] = cu 处开始的码点序号；
     词边界是半开区间尾，恰落在下一码点起始，映射即得码点半开区间 */
  var cuToChar = new Array(text.length + 1);
  var cu = 0;
  for (var ci = 0; ci < charCount; ci++) {
    var cpLen = chars[ci].length;   /* BMP 内 1，代理对 2 */
    for (var k = 0; k < cpLen; k++) cuToChar[cu + k] = ci;
    cu += cpLen;
  }
  cuToChar[text.length] = charCount;
  var lineIdx = opts.lineIdx || 0;
  var groupByWord = !!opts.groupByWord;
  if (line && line.words && line.words.length) {
    /* w.t 是绝对时间（parseYrcText 里 absStartMs/1000），需减去行首 line.t
       转为行内相对偏移，与 tickGraffitiLyrics 里 elapsed（相对行首）对齐 */
    var lineT = line.t || 0;
    for (var wi = 0; wi < line.words.length; wi++) {
      var w = line.words[wi];
      if (!w) continue;
      var cu0 = Math.max(0, Math.min(text.length, (w.c0 != null) ? w.c0 : 0));
      var cu1 = Math.max(0, Math.min(text.length, (w.c1 != null) ? w.c1 : cu0));
      var c0 = cuToChar[cu0] || 0;
      var c1 = cuToChar[cu1];
      if (c1 == null) c1 = charCount;
      if (c1 <= c0) c1 = c0 + 1;   /* 防御：YRC 把代理对劈开等异常区间 */
      var base = Math.max(0, (w.t || 0) - lineT);
      var wd = w.d || 0;
      for (var ci2 = c0; ci2 < c1 && ci2 < charCount; ci2++) {
        if (groupByWord) {
          reveals[ci2] = base;                 /* 整词同刻蹦出 */
        } else {
          var frac = (c1 > c0) ? (ci2 - c0) / (c1 - c0) : 0;
          reveals[ci2] = base + frac * Math.min(wd, 0.55);
        }
      }
    }
    /* 兜底：未被 word 覆盖的字符用累计推进 */
    var fallback = 0.2;
    for (var f = 0; f < charCount; f++) {
      if (reveals[f] < 0) {
        reveals[f] = fallback;
        fallback += 0.25;
      }
    }
  } else if (groupByWord && opts.tokens && opts.tokens.length) {
    /* LRC 词粒度：word 各为一个单元，裸 char 各为一个单元，punct 跟随前一单元 */
    var durG = (line && line.duration) ? Math.min(line.duration, 6) : 2.4;
    var spanG = durG * 0.7;
    var units = [];
    for (var ti = 0; ti < opts.tokens.length; ti++) {
      var tk = opts.tokens[ti];
      if (tk.type === 'space') continue;
      if (tk.type === 'punct' && units.length) {
        units[units.length - 1].chars = units[units.length - 1].chars.concat(tk.chars);
      } else {
        units.push({ chars: tk.chars.slice() });
      }
    }
    var prevU = 0;
    for (var u = 0; u < units.length; u++) {
      var rtU = (units.length > 1) ? (u / (units.length - 1)) * spanG : 0;
      rtU += (graffitiCharSeed(lineIdx, u, 55) - 0.5) * 0.08;
      if (rtU < prevU) rtU = prevU;
      prevU = rtU;
      rtU = Math.max(0, rtU);
      for (var uc = 0; uc < units[u].chars.length; uc++) {
        var gi = units[u].chars[uc].i;
        if (gi < charCount) reveals[gi] = rtU;
      }
    }
  } else {
    var dur = (line && line.duration) ? Math.min(line.duration, 6) : 2.4;
    var span = dur * 0.7;
    var prev = 0;
    for (var n = 0; n < charCount; n++) {
      var rt = (charCount > 1) ? (n / (charCount - 1)) * span : 0;
      rt += (graffitiCharSeed(lineIdx, n, 55) - 0.5) * 0.08;   /* 稳定抖动 */
      if (rt < prev) rt = prev;                                /* 单调不减 */
      prev = rt;
      reveals[n] = Math.max(0, rt);
    }
  }
  return reveals;
}

/* ---------- 渲染一行歌词 ---------- */
function buildGraffitiCharHtml(ch, charIdx, lineIdx, anim, baseDur, isPunct) {
  var seed = graffitiCharSeed(lineIdx, charIdx, 0);
  var rot = isPunct ? 0 : (seed - 0.5) * 16;          /* ±8°，标点不旋转 */
  var seed2 = graffitiCharSeed(lineIdx, charIdx, 7);
  var dy = isPunct ? 0 : (seed2 - 0.5) * 0.10;        /* ±0.05em */
  /* 过渡时长以动画基准值为中心 ±18% 抖动（flash 等快动画保持干脆） */
  var durSeed = graffitiCharSeed(lineIdx, charIdx, 21);
  var dur = baseDur * (0.82 + durSeed * 0.36);
  var style =
    '--gw-rot:' + rot.toFixed(2) + 'deg;' +
    '--gw-dy:' + dy.toFixed(3) + 'em;' +
    '--gw-dur:' + dur.toFixed(2) + 's;';
  /* 方向类动画的逐字随机（仅对应动画输出变量，其余动画不引用不生效） */
  if (anim === 'spin') {
    var fr = (graffitiCharSeed(lineIdx, charIdx, 33) - 0.5) * 220;   /* ±110° */
    style += '--gw-fr:' + fr.toFixed(1) + 'deg;';
  } else if (anim === 'slide') {
    var dirSeed = graffitiCharSeed(lineIdx, charIdx, 41);
    var fx = (dirSeed > 0.5 ? 1 : -1) * (0.45 + graffitiCharSeed(lineIdx, charIdx, 47) * 0.45);
    style += '--gw-fx:' + fx.toFixed(2) + 'em;';
  }
  return '<span class="graffiti-char' + (isPunct ? ' graffiti-char--punct' : '') +
    '" data-i="' + charIdx + '" aria-hidden="true" style="' + style + '">' +
    escapeGraffitiHtml(ch) + '</span>';
}

function renderGraffitiLine(line, lineIdx) {
  var container = document.getElementById('graffiti-line');
  if (!container) return;
  var text = (line && line.text) || '';
  if (!text || !text.trim()) {
    container.innerHTML = '<div class="graffiti-empty">· · ·</div>';
    container.removeAttribute('data-anim');
    container.removeAttribute('role');
    container.removeAttribute('aria-label');
    container.style.fontSize = '';
    graffitiChars = [];
    graffitiCurrentLine = null;
    return;
  }
  var tokens = tokenizeGraffitiText(text);
  var anim = pickGraffitiAnim(lineIdx);
  /* 拉丁行 50% 概率整词粒度蹦出（YRC 用真实词时序，LRC 按词均分）；CJK 行恒逐字 */
  var hasWord = false;
  for (var t0 = 0; t0 < tokens.length; t0++) {
    if (tokens[t0].type === 'word') { hasWord = true; break; }
  }
  var groupByWord = hasWord && graffitiCharSeed(lineIdx, 0, 123) < 0.5;
  var reveals = computeGraffitiReveals(line, text, {
    lineIdx: lineIdx, tokens: tokens, groupByWord: groupByWord
  });
  var baseDur = GRAFFITI_ANIM_BASE_DUR[anim] || 0.46;
  /* 构建 DOM：word 外层包裹成不可拆单元，space 为固定词距占位 */
  var html = '';
  for (var ti = 0; ti < tokens.length; ti++) {
    var tk = tokens[ti];
    if (tk.type === 'space') {
      html += '<span class="graffiti-space" aria-hidden="true"></span>';
      continue;
    }
    if (tk.type === 'word') html += '<span class="graffiti-word">';
    for (var tci = 0; tci < tk.chars.length; tci++) {
      html += buildGraffitiCharHtml(tk.chars[tci].c, tk.chars[tci].i, lineIdx, anim, baseDur, tk.type === 'punct');
    }
    if (tk.type === 'word') html += '</span>';
  }
  container.setAttribute('data-anim', anim);
  /* 整句给屏幕阅读器，逐字 span 已 aria-hidden（避免逐字朗读） */
  container.setAttribute('role', 'text');
  container.setAttribute('aria-label', text);
  container.style.fontSize = '';   /* 清旧值，测量时重设 */
  container.innerHTML = html;
  /* 二分测量字号（is-measuring 中和入场独立属性，避免初始位移/缩放污染读数） */
  fitGraffitiFontSize(container);
  /* 登记字符元素 + reveal 时间 */
  var spans = container.querySelectorAll('.graffiti-char');
  graffitiChars = [];
  for (var j = 0; j < spans.length; j++) {
    var dataI = parseInt(spans[j].getAttribute('data-i'), 10);
    graffitiChars.push({ el: spans[j], reveal: reveals[dataI] != null ? reveals[dataI] : 0 });
  }
  graffitiLineStartT = line.t;
  graffitiCurrentLine = line;
}

function clearGraffitiLine() {
  var container = document.getElementById('graffiti-line');
  if (container) {
    container.innerHTML = '';
    container.removeAttribute('data-anim');
    container.removeAttribute('role');
    container.removeAttribute('aria-label');
    container.style.fontSize = '';
  }
  graffitiChars = [];
  graffitiCurrentLine = null;
}

function escapeGraffitiHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ---------- 歌词主循环（逐字揭示 + 切行） ---------- */
function tickGraffitiLyrics() {
  if (!lyricsLines || !lyricsLines.length) {
    /* 无歌词：显示提示（仅一次，用 -98 标记避免每帧操作 DOM） */
    if (graffitiLastLineIdx !== -98) {
      clearGraffitiLine();
      var emptyBox = document.getElementById('graffiti-line');
      if (emptyBox) emptyBox.innerHTML = '<div class="graffiti-empty">· · ·</div>';
      graffitiLastLineIdx = -98;
    }
    return;
  }
  if (graffitiLastLineIdx === -98) graffitiLastLineIdx = -99; /* 歌词恢复：重置以便渲染 */
  /* 缓存播放时间，复用给 idx 查找与 elapsed 计算（避免每帧两次调用） */
  var nowTime;
  try {
    nowTime = getAdjustedLyricPlaybackTime(audio.currentTime);
  } catch (e) {
    return;
  }
  var idx;
  try {
    idx = findStageLyricIndexAtTime(nowTime);
  } catch (e) {
    return;
  }
  if (idx < 0) idx = -1;
  if (idx !== graffitiLastLineIdx) {
    graffitiLastLineIdx = idx;
    if (idx >= 0 && idx < lyricsLines.length) {
      renderGraffitiLine(lyricsLines[idx], idx);
    } else {
      clearGraffitiLine();
    }
    return;   /* 切行帧不揭示，下一帧开始逐字蹦出 */
  }
  /* 逐字揭示：根据行内已过时间点亮各字 */
  if (!graffitiChars.length || !graffitiCurrentLine) return;
  var elapsed = nowTime - graffitiLineStartT;
  for (var i = 0; i < graffitiChars.length; i++) {
    var c = graffitiChars[i];
    if (!c.el) continue;
    var shown = c.el.classList.contains('is-shown');
    if (!shown && elapsed >= c.reveal) {
      c.el.classList.add('is-shown');
    } else if (shown && elapsed < c.reveal - 0.5) {
      /* seek 倒退较多：重置以便重新蹦出 */
      c.el.classList.remove('is-shown');
    }
  }
}

/* ---------- 墨光粒子 ---------- */
function initGraffitiParticles() {
  var canvas = document.getElementById('graffiti-canvas');
  if (!canvas) return;
  graffitiCanvasCtx = canvas.getContext('2d');
  resizeGraffitiCanvas();
  if (!graffitiParticleSprite) buildGraffitiParticleSprite();
  graffitiParticles = [];
  var count = 30;
  for (var i = 0; i < count; i++) {
    graffitiParticles.push(makeGraffitiParticle(true));
  }
}

/* 离屏预渲染光点精灵：初始化时构造一次，运行时用 globalAlpha + drawImage 复用，
   避免每帧 30 次 createRadialGradient（Canvas 2D 里较重的 API） */
function buildGraffitiParticleSprite() {
  var size = 64;
  var s = document.createElement('canvas');
  s.width = s.height = size;
  var sctx = s.getContext('2d');
  var g = sctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(224,228,242,1)');
  g.addColorStop(0.5, 'rgba(200,210,235,0.4)');
  g.addColorStop(1, 'rgba(200,210,235,0)');
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, size, size);
  graffitiParticleSprite = s;
}

function makeGraffitiParticle(initial) {
  return {
    x: Math.random() * graffitiCanvasW,
    y: initial ? Math.random() * graffitiCanvasH : graffitiCanvasH + 24,
    r: 0.7 + Math.random() * 2.3,
    vy: -(0.06 + Math.random() * 0.20),    /* 慢速上浮 px/ms 系数 */
    vx: (Math.random() - 0.5) * 0.10,
    ta: 0.20 + Math.random() * 0.45,        /* 目标透明度 */
    life: initial ? Math.random() * 6000 : 0,
    maxLife: 6500 + Math.random() * 9000
  };
}

function resizeGraffitiCanvas() {
  var canvas = document.getElementById('graffiti-canvas');
  if (!canvas || !graffitiCanvasCtx) return;
  var rect = canvas.getBoundingClientRect();
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor((rect.width || window.innerWidth) * dpr));
  canvas.height = Math.max(1, Math.floor((rect.height || (window.innerHeight - 124)) * dpr));
  graffitiCanvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  graffitiCanvasW = rect.width || window.innerWidth;
  graffitiCanvasH = rect.height || (window.innerHeight - 124);
}

function tickGraffitiParticles(dt) {
  if (!graffitiCanvasCtx || !graffitiParticles.length) return;
  /* 读取低频能量驱动粒子亮度 */
  graffitiBassEnergy = 0;
  if (typeof frequencyData !== 'undefined' && frequencyData && frequencyData.length) {
    var sum = 0;
    var n = Math.min(8, frequencyData.length - 1);
    for (var b = 1; b <= n; b++) sum += frequencyData[b];
    graffitiBassEnergy = (sum / n) / 255;
  }
  var ctx = graffitiCanvasCtx;
  ctx.clearRect(0, 0, graffitiCanvasW, graffitiCanvasH);
  if (!graffitiParticleSprite) return;
  ctx.globalCompositeOperation = 'lighter';
  var brightness = 0.7 + graffitiBassEnergy * 0.6;
  var sprite = graffitiParticleSprite;
  for (var i = 0; i < graffitiParticles.length; i++) {
    var p = graffitiParticles[i];
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.life >= p.maxLife || p.y < -24 || p.x < -24 || p.x > graffitiCanvasW + 24) {
      graffitiParticles[i] = makeGraffitiParticle(false);
      continue;
    }
    var lifeRatio = p.life / p.maxLife;
    var fade = Math.sin(Math.min(1, Math.max(0, lifeRatio)) * Math.PI);  /* 0→1→0 */
    var a = p.ta * fade * brightness;
    if (a <= 0.01) continue;
    var halo = p.r * 4.5;
    ctx.globalAlpha = a;
    ctx.drawImage(sprite, p.x - halo, p.y - halo, halo * 2, halo * 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------- 歌词数据变化轮询（lyricsLines 是普通数组无事件） ---------- */
function watchGraffitiLyricsChange() {
  var token = ++graffitiLyricsObserverToken;
  var lastLen = -1;
  function check() {
    if (token !== graffitiLyricsObserverToken || !graffitiMode) return;
    var len = (lyricsLines && lyricsLines.length) || 0;
    if (len !== lastLen) {
      lastLen = len;
      graffitiLastLineIdx = -99;  /* 强制重渲染当前行 */
    }
    setTimeout(check, 600);
  }
  check();
}

/* ---------- 主循环（rAF） ---------- */
function startGraffitiLoop() {
  stopGraffitiLoop();
  var last = performance.now();
  var lastLyricTick = 0;
  var lastCoverSync = 0;
  function frame(now) {
    if (!graffitiMode) return;
    var dt = now - last;
    last = now;
    if (dt > 200) dt = 16;   /* 切后台归来防跳变 */
    /* 封面定期同步（~1.5s 一次，兜底 MutationObserver 可能漏掉的封面变化/时序差异） */
    if (now - lastCoverSync > 1500) {
      lastCoverSync = now;
      syncGraffitiCover();
    }
    /* 歌词/样式节流到 ~30fps（逐字 transition 0.38s 足够流畅）；粒子保持 60fps 平滑 */
    if (now - lastLyricTick > 33) {
      lastLyricTick = now;
      checkGraffitiStyleChange();
      tickGraffitiLyrics();
    }
    tickGraffitiParticles(dt);
    graffitiRafId = requestAnimationFrame(frame);
  }
  graffitiRafId = requestAnimationFrame(frame);
  watchGraffitiLyricsChange();
}

function stopGraffitiLoop() {
  if (graffitiRafId) {
    cancelAnimationFrame(graffitiRafId);
    graffitiRafId = 0;
  }
  graffitiLyricsObserverToken++;
}

/* ---------- resize ---------- */
function onGraffitiResize() {
  if (!graffitiMode) return;
  resizeGraffitiCanvas();
  if (graffitiCurrentLine) {
    var container = document.getElementById('graffiti-line');
    if (container && container.querySelector('.graffiti-char')) {
      fitGraffitiFontSize(container);
    }
  }
}

/* ---------- 启动绑定 ---------- */
function initGraffiti() {
  applyGraffitiMode(graffitiMode, { save: false });
  window.addEventListener('resize', function () {
    clearTimeout(graffitiResizeTimer);
    graffitiResizeTimer = setTimeout(onGraffitiResize, 180);
  });
}

/* 延迟到 DOM 就绪后初始化（本模块在 index-loader 末尾加载，DOM 已就绪） */
scheduleUiWarmTask ? scheduleUiWarmTask(initGraffiti, 300) : setTimeout(initGraffiti, 300);
