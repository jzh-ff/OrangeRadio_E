/* =========================================================================
   OrangeSea · 涂鸦墙（Graffiti Wall · 暗夜墨光）
   满屏涂鸦歌词模式：一句歌词用行草书法大字铺满屏幕，逐字蹦出。
   照抄 film-radio 范式：body.graffiti + localStorage + 四层叠加覆盖层。
   完全盖住 3D 场景（无镜头、无粒子），只展示歌词。

   四层氛围：L0 模糊封面 / L0.5 暗化遮罩 / L1 双光晕呼吸 / L2 墨光粒子 / L3 歌词。
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
  /* 双向互斥：进入涂鸦墙时先退出胶片电台 */
  if (graffitiMode && typeof filmRadioMode !== 'undefined' && filmRadioMode && typeof applyFilmRadioMode === 'function') {
    applyFilmRadioMode(false, { save: true });
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
  var lo = 32;
  var hi = Math.round(window.innerHeight * 0.46);  /* 上限 ≈ 半屏高 */
  /* 二分收敛 */
  container.style.fontSize = hi + 'px';
  var guard = 0;
  while (hi - lo > 3 && guard < 40) {
    guard++;
    var mid = (lo + hi) >> 1;
    container.style.fontSize = mid + 'px';
    if (container.scrollHeight <= maxH) {
      lo = mid;       /* 还能更大 */
    } else {
      hi = mid;
    }
  }
  container.style.fontSize = lo + 'px';
  return lo;
}

/* ---------- 涂鸦随机种子（稳定不闪烁） ---------- */
function graffitiCharSeed(lineIdx, charIdx, salt) {
  var s = (((lineIdx + 1) * 131 + (charIdx + 1) * 911 + (salt || 0) * 53) % 1000);
  return (s < 0 ? s + 1000 : s) / 1000;  /* 0~1 */
}

/* ---------- 逐字揭示时间表 ----------
   YRC：按每个 word 的真实时序（word.t / word.d），字内均分；
   LRC：在该行 duration 前 70% 内均分。 */
function computeGraffitiReveals(line, charCount) {
  var reveals = new Array(charCount).fill(-1);
  if (line && line.words && line.words.length) {
    /* w.t 是绝对时间（parseYrcText 里 absStartMs/1000），需减去行首 line.t
       转为行内相对偏移，与 tickGraffitiLyrics 里 elapsed（相对行首）对齐 */
    var lineT = line.t || 0;
    var c0, c1, wt, wd, frac, ci;
    for (var wi = 0; wi < line.words.length; wi++) {
      var w = line.words[wi];
      if (!w) continue;
      c0 = (w.c0 != null) ? w.c0 : 0;
      c1 = (w.c1 != null) ? w.c1 : c0;
      wt = w.t || 0;
      wd = w.d || 0;
      if (c1 <= c0) c1 = c0 + 1;
      for (ci = c0; ci < c1 && ci < charCount; ci++) {
        frac = (c1 > c0) ? (ci - c0) / (c1 - c0) : 0;
        reveals[ci] = Math.max(0, wt - lineT) + frac * Math.min(wd, 0.55);
      }
    }
    /* 兜底：未被 word 覆盖的字符用累计推进 */
    var fallback = 0.2;
    for (var k = 0; k < charCount; k++) {
      if (reveals[k] < 0) {
        reveals[k] = fallback;
        fallback += 0.25;
      }
    }
  } else {
    var dur = (line && line.duration) ? Math.min(line.duration, 6) : 2.4;
    var span = dur * 0.7;
    for (var n = 0; n < charCount; n++) {
      reveals[n] = (charCount > 1) ? (n / (charCount - 1)) * span : 0;
    }
  }
  return reveals;
}

/* ---------- 渲染一行歌词 ---------- */
function renderGraffitiLine(line, lineIdx) {
  var container = document.getElementById('graffiti-line');
  if (!container) return;
  var text = (line && line.text) || '';
  if (!text || !text.trim()) {
    container.innerHTML = '<div class="graffiti-empty">· · ·</div>';
    graffitiChars = [];
    graffitiCurrentLine = null;
    return;
  }
  /* 拆字（按 Unicode 码点，正确处理中文） */
  var chars = Array.from(text);
  var reveals = computeGraffitiReveals(line, chars.length);
  /* 构建 DOM：每个字一个 span，带稳定随机旋转/偏移 */
  var html = '';
  for (var i = 0; i < chars.length; i++) {
    var c = chars[i];
    var seed = graffitiCharSeed(lineIdx, i, 0);
    var rot = (seed - 0.5) * 16;          /* ±8° */
    var seed2 = graffitiCharSeed(lineIdx, i, 7);
    var dy = (seed2 - 0.5) * 0.10;        /* ±0.05em */
    /* 保留空白字符原样（不包裹 span，避免 inline-block 折叠空格） */
    if (/\s/.test(c)) {
      html += '<span class="graffiti-space"> </span>';
      continue;
    }
    html += '<span class="graffiti-char" data-i="' + i + '" style="' +
      '--gw-rot:' + rot.toFixed(2) + 'deg;' +
      '--gw-dy:' + dy.toFixed(3) + 'em;">' +
      escapeGraffitiHtml(c) + '</span>';
  }
  container.style.fontSize = '';   /* 清旧值，测量时重设 */
  container.innerHTML = html;
  /* 先在无入场动画状态下测量字号，避免二分改 fontSize 与入场动画叠加造成闪烁 */
  fitGraffitiFontSize(container);
  /* 字号定下后再触发行入场动画 */
  container.classList.remove('is-entering');
  void container.offsetWidth;
  container.classList.add('is-entering');
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
  if (container) container.innerHTML = '';
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
