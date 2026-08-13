/* =========================================================================
   OrangeSea · 风格电台（Genre Mode · 风格视觉驱动）
   根据当前歌曲的音乐风格（genre）自动切换整套视觉主题的全屏覆盖层。
   照抄 film-radio / graffiti 范式：body.genre-mode + localStorage +
   html.genre-mode-preload + 进入时临时降 eco 质量档 + 预设网格特殊卡片。

   风格来源：inferGenreFamily(song)（02-visual/16-genre-resolve.js）
     本地 ID3 genre → 播客 category → 关键词推断 → default
   主题表：GENRE_THEMES（02-visual/17-genre-themes.js），CSS 变量下发。

   手动锁定：顶部族群芯片选择器，锁定时不再跟随切歌自动换主题。
   ========================================================================= */

var GENRE_MODE_STORE_KEY = 'orangesea-genre-mode-v1';
var GENRE_LOCK_STORE_KEY = 'orangesea-genre-lock-v1';
var genreMode = readBooleanPreference(GENRE_MODE_STORE_KEY, false);
var genreLock = 'auto';
try { genreLock = localStorage.getItem(GENRE_LOCK_STORE_KEY) || 'auto'; } catch (e) { genreLock = 'auto'; }
if (genreLock !== 'auto' && (typeof GENRE_FAMILIES === 'undefined' || GENRE_FAMILIES.indexOf(genreLock) === -1)) genreLock = 'auto';

var genreObserver = null;
var genreLyricsObserverToken = 0;
var genreLastLyricIdx = -99;
var genreRafId = 0;
var genreSpectrumBuilt = false;
var genreSeekDragging = false;
var genreModePrevQuality = null;
var genreActiveFamily = '';      /* 当前已应用的族群（空 = 尚未应用） */
var genreActiveReact = null;     /* 当前族群的律动参数（theme.react） */
var genreActiveViz = 'bars';     /* 当前族群的可视化形态（theme.viz：bars/ring/wave/staff） */
var genreSpectrumVals = null;    /* bars 频谱条平滑状态（Float32Array，lerp 惯性） */
/* CSS 变量写入节流：变化小于阈值不重复 setProperty */
var genreCssBass = -1;
var genreCssEnergy = -1;
var genreCssBeat = -1;
/* viz 形态共享状态 */
var genreVizCtx = null;
var genreVizCanvasW = 0;
var genreVizCanvasH = 0;
var genreVizColorCache = { accent: '#a9b8c8', accent2: '#7f8ea0', glow: 'rgba(169,184,200,0.13)' };
var genreVizColorTick = 0;
var genreRingVals = null;        /* ring 形态：56 根辐射条平滑状态 */
var genreWaveSmooth = null;      /* wave 形态：采样点平滑状态 */
var genreWavePhase = 0;          /* wave 形态：无信号时的静态正弦相位 */
var genreStaffDots = null;       /* staff 形态：12 个光点平滑状态 */

/* ---------- 切换 ---------- */
function applyGenreMode(on, opts) {
  opts = opts || {};
  genreMode = !!on;
  // 三方双向互斥：进入风格电台时先退出胶片电台 / 涂鸦墙
  if (genreMode && typeof filmRadioMode !== 'undefined' && filmRadioMode && typeof applyFilmRadioMode === 'function') {
    applyFilmRadioMode(false, { save: true });
  }
  if (genreMode && typeof graffitiMode !== 'undefined' && graffitiMode && typeof applyGraffitiMode === 'function') {
    applyGraffitiMode(false, { save: true });
  }
  document.documentElement.classList.toggle('genre-mode-preload', genreMode);
  document.body.classList.toggle('genre-mode', genreMode);
  var overlay = document.getElementById('genre-overlay');
  if (overlay) overlay.setAttribute('aria-hidden', genreMode ? 'false' : 'true');
  if (opts.save) saveBooleanPreference(GENRE_MODE_STORE_KEY, genreMode);
  if (genreMode) {
    startGenreMode();
    // 3D 场景已被覆盖层盖住：临时切 eco 质量档，负载高时 3D 自动跳帧让路
    if (typeof fx !== 'undefined' && fx && genreModePrevQuality === null) {
      genreModePrevQuality = fx.performanceQuality || 'balanced';
      fx.performanceQuality = 'eco';
    }
  } else {
    stopGenreMode();
    if (genreModePrevQuality !== null && typeof fx !== 'undefined' && fx) {
      fx.performanceQuality = genreModePrevQuality;
      genreModePrevQuality = null;
    }
  }
  // DIY 控制台的视觉预设卡片与本模式联动（卡片在 07-fx 模块构建）
  if (typeof refreshPresetGrid === 'function') refreshPresetGrid();
  if (opts.toast) showToast(genreMode ? '风格电台已开启' : '已切回标准模式');
}

function toggleGenreMode() {
  applyGenreMode(!genreMode, { save: true, toast: true });
}

/* ---------- 启动 / 停止 ---------- */
function startGenreMode() {
  ensureGenreViz();
  ensureGenreChips();
  syncGenreCover();
  syncGenreMeta();
  syncGenreProgress();
  syncGenrePlayState();
  renderGenreLyrics();
  syncGenreThemeFromSong(true);
  startGenreObserver();
  startGenreLoop();
}

function stopGenreMode() {
  stopGenreObserver();
  stopGenreLoop();
  genreLastLyricIdx = -99;
}

/* ---------- 状态同步（MutationObserver 监听标准控件，零侵入） ---------- */
function startGenreObserver() {
  stopGenreObserver();
  genreObserver = new MutationObserver(function () {
    syncGenreCover();
    syncGenreMeta();
    syncGenreProgress();
    syncGenrePlayState();
  });
  var targets = [
    'control-cover', 'control-title-text', 'control-artist',
    'progress-fill', 'play-icon', 'time-display'
  ];
  targets.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) genreObserver.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
  });
}

function stopGenreObserver() {
  if (genreObserver) {
    genreObserver.disconnect();
    genreObserver = null;
  }
}

/* 封面：从 #control-cover 的 background-image 同步 */
function syncGenreCover() {
  var src = document.getElementById('control-cover');
  var cover = document.querySelector('#gm-cover .gm-cover-img');
  if (!src || !cover) return;
  var bg = src.style.backgroundImage || '';
  if (bg) {
    cover.style.backgroundImage = bg;
    cover.classList.remove('cover-empty');
  } else {
    cover.style.backgroundImage = '';
    cover.classList.add('cover-empty');
  }
}

/* 标题/歌手（标题变化 = 切歌，触发主题跟随） */
function syncGenreMeta() {
  var titleEl = document.getElementById('control-title-text');
  var artistEl = document.getElementById('control-artist');
  var gmTitle = document.getElementById('gm-title');
  var gmArtist = document.getElementById('gm-artist');
  var prevTitle = gmTitle ? gmTitle.textContent : '';
  if (gmTitle && titleEl) gmTitle.textContent = titleEl.textContent || '未在播放';
  if (gmArtist && artistEl) gmArtist.textContent = artistEl.textContent || '';
  if (gmTitle && gmTitle.textContent !== prevTitle) {
    syncGenreThemeFromSong(false);
    syncGenreTag();
  }
}

/* 原始 genre 文本小标签（有则显示，无则隐藏） */
function syncGenreTag() {
  var tag = document.getElementById('gm-genre-tag');
  if (!tag) return;
  var song = typeof currentCoverSong === 'function' ? currentCoverSong() : null;
  var raw = song && song.genre ? String(song.genre) : '';
  tag.textContent = raw;
  tag.style.display = raw ? '' : 'none';
}

/* 进度 + 时间 */
function syncGenreProgress() {
  var fill = document.getElementById('progress-fill');
  var time = document.getElementById('time-display');
  var gmFill = document.getElementById('gm-progress-fill');
  var gmTime = document.getElementById('gm-time');
  if (gmFill && fill) gmFill.style.width = fill.style.width || '0%';
  if (gmTime && time) gmTime.textContent = time.textContent || '0:00 / 0:00';
}

/* 播放状态：仅维护封面停顿态（播放控制在底部控制栏） */
function syncGenrePlayState() {
  var isPlaying = !!(audio && audio.src && !audio.paused && !audio.ended);
  var cover = document.getElementById('gm-cover');
  if (cover) cover.classList.toggle('is-paused', !isPlaying);
}

/* ---------- 主题跟随 / 手动锁定 ---------- */
function syncGenreThemeFromSong(force) {
  var family;
  if (genreLock !== 'auto') {
    family = genreLock;
  } else {
    var song = typeof currentCoverSong === 'function' ? currentCoverSong() : null;
    family = song && typeof inferGenreFamily === 'function' ? inferGenreFamily(song) : 'default';
  }
  if (!force && family === genreActiveFamily) return;
  genreActiveFamily = family;
  var theme = typeof applyGenreTheme === 'function' ? applyGenreTheme(family) : null;
  genreActiveReact = (theme && theme.react) || (typeof GENRE_REACT_DEFAULT !== 'undefined' ? GENRE_REACT_DEFAULT : null);
  genreActiveViz = (theme && theme.viz) || 'bars';
  refreshGenreVizColors(true);
  /* 切族瞬间：光晕脉冲仪式感（CSS animation，重触发 reflow） */
  var overlay = document.getElementById('genre-overlay');
  if (overlay && genreMode) {
    overlay.classList.remove('gm-theme-switch');
    void overlay.offsetWidth;
    overlay.classList.add('gm-theme-switch');
  }
  syncGenreBadge();
  syncGenreChipsActive();
}

function syncGenreBadge() {
  var badge = document.getElementById('gm-badge');
  if (!badge) return;
  var label = typeof genreFamilyLabel === 'function' ? genreFamilyLabel(genreActiveFamily || 'default') : '综合';
  badge.textContent = 'GENRE · ' + label;
}

/* ---------- 族群芯片选择器 ---------- */
function ensureGenreChips() {
  var el = document.getElementById('gm-chips');
  if (!el || el.dataset.gmBuilt) { syncGenreChipsActive(); return; }
  el.dataset.gmBuilt = '1';
  var html = '<button type="button" class="gm-chip" data-family="auto">自动</button>';
  if (typeof GENRE_FAMILIES !== 'undefined') {
    GENRE_FAMILIES.forEach(function (f) {
      html += '<button type="button" class="gm-chip" data-family="' + f + '">' +
        (typeof genreFamilyLabel === 'function' ? genreFamilyLabel(f) : f) + '</button>';
    });
  }
  el.innerHTML = html;
  el.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.gm-chip') : null;
    if (!btn) return;
    var family = btn.getAttribute('data-family') || 'auto';
    if (typeof GENRE_FAMILIES !== 'undefined' && family !== 'auto' && GENRE_FAMILIES.indexOf(family) === -1) return;
    genreLock = family;
    try { localStorage.setItem(GENRE_LOCK_STORE_KEY, genreLock); } catch (err) { }
    genreActiveFamily = ''; /* 强制重应用 */
    syncGenreThemeFromSong(true);
    showToast(family === 'auto' ? '风格：自动跟随歌曲' : '风格锁定：' + (typeof genreFamilyLabel === 'function' ? genreFamilyLabel(family) : family));
  });
  syncGenreChipsActive();
}

function syncGenreChipsActive() {
  var el = document.getElementById('gm-chips');
  if (!el) return;
  var chips = el.querySelectorAll('.gm-chip');
  for (var i = 0; i < chips.length; i++) {
    var family = chips[i].getAttribute('data-family');
    // 自动模式：高亮当前跟随到的族群；锁定模式：高亮锁定项
    var active = genreLock === 'auto'
      ? (family === 'auto' || family === genreActiveFamily)
      : family === genreLock;
    chips[i].classList.toggle('active', !!active);
    chips[i].classList.toggle('followed', genreLock === 'auto' && family === genreActiveFamily);
  }
}

/* ---------- 歌词渲染（单行模式：只维护标题下的当前行） ---------- */
function renderGenreLyrics() {
  var nowLine = document.getElementById('gm-now-line');
  if (!nowLine) return;
  var hasReal = lyricsLines && lyricsLines.length && lyricsLines.some(function (l) { return !l.fallback; });
  nowLine.textContent = hasReal ? '—' : '暂无歌词';
  nowLine.classList.add('empty');
  genreLastLyricIdx = -99;
}

function tickGenreLyrics() {
  if (!genreMode) return;
  if (!lyricsLines || !lyricsLines.length) return;
  var nowLine = document.getElementById('gm-now-line');
  if (!nowLine) return;
  var idx;
  try {
    idx = findStageLyricIndexAtTime(getAdjustedLyricPlaybackTime(audio.currentTime));
  } catch (e) {
    return;
  }
  if (idx < 0) idx = -1;
  if (idx === genreLastLyricIdx) return;
  genreLastLyricIdx = idx;
  if (idx >= 0 && lyricsLines[idx] && lyricsLines[idx].text) {
    nowLine.textContent = lyricsLines[idx].text;
    nowLine.classList.remove('empty');
    nowLine.title = lyricsLines[idx].text;
  } else {
    nowLine.textContent = '—';
    nowLine.classList.add('empty');
    nowLine.title = '';
  }
}

/* 监听 lyricsLines 变化重渲染（轮询 token，因 lyricsLines 是普通数组无事件） */
function watchGenreLyricsChange() {
  var token = ++genreLyricsObserverToken;
  var lastLen = -1;
  function check() {
    if (token !== genreLyricsObserverToken || !genreMode) return;
    var len = (lyricsLines && lyricsLines.length) || 0;
    if (len !== lastLen) {
      lastLen = len;
      renderGenreLyrics();
    }
    setTimeout(check, 600);
  }
  check();
}

/* ---------- 可视化形态（viz） ----------
   每族一种表现方式：
     bars   柱状频谱（嘻哈/摇滚/金属/流行/动漫/综合）—— DOM 48 条
     ring   封面外圈环形辐射频谱（电子）—— DOM 56 条绕封面旋转
     wave   柔和波形线（民谣/爵士/灵魂乐/氛围）—— canvas 时域双线
     staff  五线谱上跳动的光点（古典）—— canvas 12 光点
   共用：族群 react 参数（boost/smooth）与 frequencyData/timeDomainData。 */

function ensureGenreViz() {
  ensureGenreBars();
  ensureGenreCanvas();
  ensureGenreRing();
}

/* ---------- bars：柱状频谱 ---------- */
function ensureGenreBars() {
  if (genreSpectrumBuilt) return;
  var container = document.getElementById('gm-spectrum');
  if (!container) return;
  container.innerHTML = '';
  for (var i = 0; i < 48; i++) {
    var bar = document.createElement('div');
    bar.className = 'gm-spectrum-bar';
    container.appendChild(bar);
  }
  genreSpectrumVals = new Float32Array(48);
  genreSpectrumBuilt = true;
}

function tickGenreBars() {
  if (!genreSpectrumBuilt) return;
  var bars = document.querySelectorAll('#gm-spectrum .gm-spectrum-bar');
  if (!bars.length) return;
  var data = frequencyData;
  var n = bars.length;
  var react = genreActiveReact || (typeof GENRE_REACT_DEFAULT !== 'undefined' ? GENRE_REACT_DEFAULT : { spectrumBoost: 1, spectrumSmooth: 0.55 });
  var boost = react.spectrumBoost || 1;
  /* 平滑惯性：越大越柔（lerp 系数 = 1 - smooth） */
  var lerpK = Math.max(0.08, Math.min(1, 1 - (react.spectrumSmooth != null ? react.spectrumSmooth : 0.55)));
  if (!genreSpectrumVals || genreSpectrumVals.length !== n) genreSpectrumVals = new Float32Array(n);
  // 对数映射：低频密集，取 bin 1..256（约 0-5.5kHz）
  for (var i = 0; i < n; i++) {
    var norm = i / (n - 1);
    var bin = Math.max(1, Math.floor(Math.pow(norm, 1.6) * 240 + 2));
    var v = (data && data[bin] ? data[bin] : 0) / 255;
    var target = 0.1 + Math.min(1, v * boost) * 0.9;
    var cur = genreSpectrumVals[i] + (target - genreSpectrumVals[i]) * lerpK;
    genreSpectrumVals[i] = cur;
    bars[i].style.transform = 'scaleY(' + cur.toFixed(3) + ')';
  }
}

/* ---------- ring：封面外圈环形辐射频谱 ---------- */
var GENRE_RING_BAR_COUNT = 56;
function ensureGenreRing() {
  var wrap = document.getElementById('gm-ring-bars');
  if (wrap) return wrap;
  var stage = document.querySelector('#genre-overlay .gm-cover-stage');
  if (!stage) return null;
  wrap = document.createElement('div');
  wrap.id = 'gm-ring-bars';
  wrap.className = 'gm-ring-bars';
  for (var i = 0; i < GENRE_RING_BAR_COUNT; i++) {
    var bar = document.createElement('div');
    bar.className = 'gm-ring-bar';
    wrap.appendChild(bar);
  }
  stage.appendChild(wrap);
  genreRingVals = new Float32Array(GENRE_RING_BAR_COUNT);
  return wrap;
}

function tickGenreRing() {
  var wrap = ensureGenreRing();
  if (!wrap || !genreRingVals) return;
  var cover = document.getElementById('gm-cover');
  if (!cover || !cover.offsetWidth) return;
  /* 条以顶部为锚（transform-origin:50% 0）从外圈向圆心生长：
     起始半径 = 封面半径 + 间距 + 最大条长，保证最长时不触碰封面 */
  var radius = cover.offsetWidth / 2 + 12 + 42;
  var data = frequencyData;
  var react = genreActiveReact || (typeof GENRE_REACT_DEFAULT !== 'undefined' ? GENRE_REACT_DEFAULT : { spectrumBoost: 1.3, spectrumSmooth: 0.35 });
  var boost = react.spectrumBoost || 1;
  var lerpK = Math.max(0.1, Math.min(1, 1 - (react.spectrumSmooth != null ? react.spectrumSmooth : 0.35)));
  var bars = wrap.children;
  var n = bars.length;
  for (var i = 0; i < n; i++) {
    var norm = i / (n - 1);
    // ring 以低频段为主（bin 1..122），外圈能量集中在鼓点/贝斯
    var bin = Math.max(1, Math.floor(Math.pow(norm, 1.5) * 120 + 2));
    var v = (data && data[bin] ? data[bin] : 0) / 255;
    var target = 0.22 + Math.min(1, v * boost) * 1.15;
    var cur = genreRingVals[i] + (target - genreRingVals[i]) * lerpK;
    genreRingVals[i] = cur;
    var deg = (i / n) * 360;
    bars[i].style.transform = 'rotate(' + deg.toFixed(1) + 'deg) translateY(' + (-radius).toFixed(1) + 'px) scaleY(' + cur.toFixed(3) + ')';
  }
}

/* ---------- canvas 共享：上下文 / 颜色缓存 ---------- */
function ensureGenreCanvas() {
  var canvas = document.getElementById('gm-viz-canvas');
  if (!canvas) return null;
  var w = canvas.offsetWidth, h = canvas.offsetHeight;
  if (!w || !h) return null;
  var dpr = Math.min(1.5, window.devicePixelRatio || 1);
  if (genreVizCanvasW !== w || genreVizCanvasH !== h || !genreVizCtx) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    genreVizCanvasW = w;
    genreVizCanvasH = h;
    genreVizCtx = canvas.getContext('2d');
    genreVizCtx._dpr = dpr;
  }
  return genreVizCtx;
}

/* canvas 不吃 CSS transition，主题色每 15 tick（~0.5s）读一次已够顺滑 */
function refreshGenreVizColors(force) {
  if (!force && (++genreVizColorTick % 15) !== 0) return;
  var overlay = document.getElementById('genre-overlay');
  if (!overlay) return;
  var cs = getComputedStyle(overlay);
  var accent = cs.getPropertyValue('--gm-accent').trim();
  var accent2 = cs.getPropertyValue('--gm-accent-2').trim();
  var glow = cs.getPropertyValue('--gm-glow').trim();
  if (accent) genreVizColorCache.accent = accent;
  if (accent2) genreVizColorCache.accent2 = accent2;
  if (glow) genreVizColorCache.glow = glow;
}

/* ---------- wave：柔和波形线（时域双线） ---------- */
var GENRE_WAVE_POINTS = 96;
function tickGenreWave() {
  var ctx = ensureGenreCanvas();
  if (!ctx) return;
  var w = genreVizCanvasW, h = genreVizCanvasH;
  ctx.setTransform(ctx._dpr, 0, 0, ctx._dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  refreshGenreVizColors(false);
  var td = (typeof timeDomainData !== 'undefined') ? timeDomainData : null;
  var react = genreActiveReact || (typeof GENRE_REACT_DEFAULT !== 'undefined' ? GENRE_REACT_DEFAULT : { spectrumBoost: 1, spectrumSmooth: 0.7 });
  var boost = react.spectrumBoost || 1;
  var lerpK = Math.max(0.06, Math.min(1, 1 - (react.spectrumSmooth != null ? react.spectrumSmooth : 0.7)));
  if (!genreWaveSmooth || genreWaveSmooth.length !== GENRE_WAVE_POINTS) genreWaveSmooth = new Float32Array(GENRE_WAVE_POINTS);
  genreWavePhase += 0.014 + (typeof bass !== 'undefined' ? bass : 0) * 0.022;
  var n = GENRE_WAVE_POINTS;
  for (var i = 0; i < n; i++) {
    var raw;
    if (td && td.length) {
      raw = (td[Math.floor((i / (n - 1)) * (td.length - 1))] - 128) / 128;
    } else {
      raw = 0;
    }
    /* 无信号时的平缓呼吸正弦（有信号时被真实波形盖住） */
    raw += Math.sin(genreWavePhase + i * 0.22) * 0.05;
    genreWaveSmooth[i] += (raw - genreWaveSmooth[i]) * lerpK;
  }
  var mid = h / 2;
  var amp = h * 0.36 * boost;
  drawGenreWaveLine(ctx, w, mid, amp, 1, genreVizColorCache.accent, 2, 0.92);
  drawGenreWaveLine(ctx, w, mid, amp * 0.55, -1, genreVizColorCache.accent2, 1.2, 0.32);
}

function drawGenreWaveLine(ctx, w, mid, amp, mirror, color, width, alpha) {
  var n = GENRE_WAVE_POINTS;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  /* 中点二次贝塞尔平滑：折线 → 连续波形 */
  var prevX = 0;
  var prevY = mid + genreWaveSmooth[0] * amp * mirror;
  ctx.moveTo(prevX, prevY);
  for (var i = 1; i < n; i++) {
    var x = (i / (n - 1)) * w;
    var y = mid + genreWaveSmooth[i] * amp * mirror;
    var cx = (prevX + x) / 2;
    var cy = (prevY + y) / 2;
    ctx.quadraticCurveTo(prevX, prevY, cx, cy);
    prevX = x;
    prevY = y;
  }
  ctx.lineTo(prevX, prevY);
  ctx.stroke();
  ctx.restore();
}

/* ---------- staff：五线谱上跳动的光点 ---------- */
var GENRE_STAFF_DOT_COUNT = 12;
function tickGenreStaff() {
  var ctx = ensureGenreCanvas();
  if (!ctx) return;
  var w = genreVizCanvasW, h = genreVizCanvasH;
  ctx.setTransform(ctx._dpr, 0, 0, ctx._dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  refreshGenreVizColors(false);
  var data = frequencyData;
  var react = genreActiveReact || (typeof GENRE_REACT_DEFAULT !== 'undefined' ? GENRE_REACT_DEFAULT : { spectrumBoost: 0.7, spectrumSmooth: 0.8 });
  var boost = react.spectrumBoost || 1;
  var lerpK = Math.max(0.05, Math.min(1, 1 - (react.spectrumSmooth != null ? react.spectrumSmooth : 0.8)));
  if (!genreStaffDots || genreStaffDots.length !== GENRE_STAFF_DOT_COUNT) {
    genreStaffDots = [];
    for (var d = 0; d < GENRE_STAFF_DOT_COUNT; d++) genreStaffDots.push({ y: 0.5, v: 0 });
  }
  /* 五条谱线 */
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = genreVizColorCache.accent;
  ctx.lineWidth = 1;
  var lineTop = h * 0.18, lineGap = h * 0.13;
  ctx.beginPath();
  for (var li = 0; li < 5; li++) {
    var ly = lineTop + li * lineGap;
    ctx.moveTo(w * 0.04, ly);
    ctx.lineTo(w * 0.96, ly);
  }
  ctx.stroke();
  ctx.restore();
  /* 光点：低频在低音线（下），高频在高音线（上），克制的跳动 */
  var floorY = lineTop + 4 * lineGap + h * 0.1;   /* 静止时落在谱面下方 */
  var range = h * 0.58;
  for (var i = 0; i < GENRE_STAFF_DOT_COUNT; i++) {
    var norm = i / (GENRE_STAFF_DOT_COUNT - 1);
    var bin = Math.max(1, Math.floor(Math.pow(norm, 1.5) * 200 + 2));
    var v = (data && data[bin] ? data[bin] : 0) / 255;
    v = Math.min(1, v * boost);
    var dot = genreStaffDots[i];
    dot.v += (v - dot.v) * lerpK;
    var targetY = floorY - dot.v * range;
    dot.y += (targetY - dot.y) * lerpK;
    var x = w * 0.06 + norm * w * 0.88;
    var r = 1.6 + dot.v * 3.4;
    ctx.save();
    ctx.globalAlpha = 0.55 + dot.v * 0.45;
    ctx.fillStyle = genreVizColorCache.accent;
    ctx.shadowColor = genreVizColorCache.accent;
    ctx.shadowBlur = 6 + dot.v * 10;
    ctx.beginPath();
    ctx.arc(x, dot.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ---------- viz 分发 ---------- */
function tickGenreViz() {
  if (!genreMode) return;
  var viz = genreActiveViz || 'bars';
  if (viz === 'ring') { tickGenreRing(); return; }
  if (viz === 'wave') { tickGenreWave(); return; }
  if (viz === 'staff') { tickGenreStaff(); return; }
  tickGenreBars();
}

/* ---------- 音频反应层（律动性格） ----------
   每帧读主循环全局 bass/audioEnergy/beatPulse（暂停时自动衰减到 0，
   无需额外暂停处理），按族群 react 参数缩放后写 CSS 变量：
     --gm-bass    → 封面光晕半径/缩放、频谱辉光
     --gm-energy  → 背景光晕呼吸
     --gm-beat    → 节拍 punch（封面缩放 / 徽章微闪）
   写入阈值节流：变化 < 0.004 不重复 setProperty。 */
function tickGenreReactive() {
  if (!genreMode) return;
  var overlay = document.getElementById('genre-overlay');
  if (!overlay) return;
  var react = genreActiveReact || (typeof GENRE_REACT_DEFAULT !== 'undefined' ? GENRE_REACT_DEFAULT : null);
  if (!react) return;
  var b = (typeof bass !== 'undefined' ? bass : 0) * (react.coverPulse || 0);
  var e = (typeof audioEnergy !== 'undefined' ? audioEnergy : 0) * (react.bgReact || 0);
  var p = (typeof beatPulse !== 'undefined' ? beatPulse : 0) * (react.beatPunch || 0);
  if (Math.abs(b - genreCssBass) > 0.004) {
    genreCssBass = b;
    overlay.style.setProperty('--gm-bass', b.toFixed(3));
  }
  if (Math.abs(e - genreCssEnergy) > 0.004) {
    genreCssEnergy = e;
    overlay.style.setProperty('--gm-energy', e.toFixed(3));
  }
  if (Math.abs(p - genreCssBeat) > 0.004) {
    genreCssBeat = p;
    overlay.style.setProperty('--gm-beat', p.toFixed(3));
  }
}

/* ---------- 主循环（rAF，节流到约 30fps） ---------- */
function startGenreLoop() {
  stopGenreLoop();
  var lastTick = 0;
  function frame(now) {
    if (!genreMode) return;
    if (now - lastTick > 33) {
      lastTick = now;
      tickGenreLyrics();
      tickGenreViz();
      tickGenreReactive();
      syncGenreProgress(); // 进度条高频更新
    }
    genreRafId = requestAnimationFrame(frame);
  }
  genreRafId = requestAnimationFrame(frame);
  watchGenreLyricsChange();
}

function stopGenreLoop() {
  if (genreRafId) {
    cancelAnimationFrame(genreRafId);
    genreRafId = 0;
  }
  genreLyricsObserverToken++; // 终止歌词轮询
}

/* ---------- 进度条拖动 seek ---------- */
function initGenreProgressSeek() {
  var bar = document.getElementById('gm-progress');
  if (!bar || bar.dataset.gmBound) return;
  bar.dataset.gmBound = '1';

  function getPercent(clientX) {
    var rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }
  function seekTo(percent) {
    var dur = getPlaybackDurationSeconds ? getPlaybackDurationSeconds() : (audio.duration || 0);
    if (!dur) return;
    try { audio.currentTime = percent * dur; } catch (e) { }
  }

  bar.addEventListener('pointerdown', function (e) {
    genreSeekDragging = true;
    bar.classList.add('dragging');
    bar.setPointerCapture(e.pointerId);
    var p = getPercent(e.clientX);
    var fill = document.getElementById('gm-progress-fill');
    if (fill) fill.style.width = (p * 100) + '%';
    e.preventDefault();
  });
  bar.addEventListener('pointermove', function (e) {
    if (!genreSeekDragging) return;
    var p = getPercent(e.clientX);
    var fill = document.getElementById('gm-progress-fill');
    if (fill) fill.style.width = (p * 100) + '%';
  });
  bar.addEventListener('pointerup', function (e) {
    if (!genreSeekDragging) return;
    genreSeekDragging = false;
    bar.classList.remove('dragging');
    var p = getPercent(e.clientX);
    seekTo(p);
    try { bar.releasePointerCapture(e.pointerId); } catch (err) { }
  });
}

/* ---------- 启动绑定 ---------- */
function initGenreMode() {
  // 进度条拖动
  initGenreProgressSeek();
  // 预置主题（锁定时用锁定族，否则 default），避免首次开启时主题闪变
  if (typeof applyGenreTheme === 'function') {
    var theme = applyGenreTheme(genreLock !== 'auto' ? genreLock : 'default');
    genreActiveReact = (theme && theme.react) || (typeof GENRE_REACT_DEFAULT !== 'undefined' ? GENRE_REACT_DEFAULT : null);
    genreActiveViz = (theme && theme.viz) || 'bars';
    genreActiveFamily = genreLock !== 'auto' ? genreLock : 'default';
    refreshGenreVizColors(true);
  }
  // 模式变量在本模块执行时才从存储读取。统一在这里提交完整 DOM 状态，
  // 避免仅残留 html.genre-mode-preload。
  applyGenreMode(genreMode, { save: false });
}

// 延迟到 DOM 就绪后初始化（本模块在 index-loader 末尾加载，DOM 已就绪）
scheduleUiWarmTask ? scheduleUiWarmTask(initGenreMode, 320) : setTimeout(initGenreMode, 320);
