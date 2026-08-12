/* =========================================================================
   OrangeSea · 胶片电台（Film Radio · 暗房放映 Darkroom Cinema）
   切换逻辑 + 状态同步（MutationObserver 零侵入）+ 歌词渲染 + 频谱驱动
   + 拍立得封面同步 + 装饰性胶片参数（日期戳/ISO/光圈/帧编号）。
   照抄 diy-mode 范式：body.film-radio + localStorage + html.film-radio-preload。
   ========================================================================= */

var FILM_RADIO_STORE_KEY = 'orangesea-film-radio-v1';
var filmRadioMode = readBooleanPreference(FILM_RADIO_STORE_KEY, false);
var filmRadioObserver = null;
var filmRadioLyricsObserverToken = 0;
var filmRadioLastLyricIdx = -99;
var filmRadioRafId = 0;
var filmRadioSpectrumBuilt = false;
var filmRadioSeekDragging = false;
/* 进入胶片电台时临时降载 3D 渲染（覆盖层已盖住 3D 场景），
   把帧预算让给歌词行切换动画；退出时恢复原质量档（不写入存档） */
var filmRadioPrevQuality = null;

/* ---------- 切换 ---------- */
function syncFilmRadioButton() {
  var btn = document.getElementById('film-radio-btn');
  if (!btn) return;
  btn.classList.toggle('on', filmRadioMode);
  btn.setAttribute('aria-pressed', filmRadioMode ? 'true' : 'false');
  btn.title = filmRadioMode ? '退出胶片电台' : '胶片电台';
  btn.setAttribute('aria-label', btn.title);
}

function applyFilmRadioMode(on, opts) {
  opts = opts || {};
  filmRadioMode = !!on;
  // 双向互斥：进入胶片电台时先退出涂鸦墙（满屏涂鸦歌词）
  if (filmRadioMode && typeof graffitiMode !== 'undefined' && graffitiMode && typeof applyGraffitiMode === 'function') {
    applyGraffitiMode(false, { save: true });
  }
  document.documentElement.classList.toggle('film-radio-preload', filmRadioMode);
  document.body.classList.toggle('film-radio', filmRadioMode);
  var overlay = document.getElementById('film-radio-overlay');
  if (overlay) overlay.setAttribute('aria-hidden', filmRadioMode ? 'false' : 'true');
  syncFilmRadioButton();
  if (opts.save) saveBooleanPreference(FILM_RADIO_STORE_KEY, filmRadioMode);
  if (filmRadioMode) {
    startFilmRadio();
    // 3D 场景已被覆盖层盖住：临时切 eco 质量档，负载高时 3D 自动跳帧让路
    if (typeof fx !== 'undefined' && fx && filmRadioPrevQuality === null) {
      filmRadioPrevQuality = fx.performanceQuality || 'balanced';
      fx.performanceQuality = 'eco';
    }
  } else {
    stopFilmRadio();
    if (filmRadioPrevQuality !== null && typeof fx !== 'undefined' && fx) {
      fx.performanceQuality = filmRadioPrevQuality;
      filmRadioPrevQuality = null;
    }
  }
  // DIY 控制台的视觉预设卡片与本模式联动（卡片在 07-fx 模块构建）
  if (typeof refreshPresetGrid === 'function') refreshPresetGrid();
  if (opts.toast) showToast(filmRadioMode ? '胶片电台已开启' : '已切回标准模式');
  if (opts.animate && window.gsap) {
    var btn = document.getElementById('film-radio-btn');
    if (btn) window.gsap.fromTo(btn, { scale: 0.9 }, { scale: 1, duration: 0.34, ease: 'back.out(1.8)', overwrite: true });
  }
}

function toggleFilmRadioMode() {
  applyFilmRadioMode(!filmRadioMode, { save: true, toast: true, animate: true });
}

/* ---------- 启动 / 停止 ---------- */
function startFilmRadio() {
  ensureFilmRadioSpectrum();
  syncFilmRadioCover();
  syncFilmRadioMeta();
  syncFilmRadioProgress();
  syncFilmRadioPlayState();
  updateFilmRadioStamp();
  renderFilmRadioLyrics();
  startFilmRadioObserver();
  startFilmRadioLoop();
}

function stopFilmRadio() {
  stopFilmRadioObserver();
  stopFilmRadioLoop();
  filmRadioLastLyricIdx = -99;
}

/* ---------- 状态同步（MutationObserver 监听标准控件，零侵入） ---------- */
function startFilmRadioObserver() {
  stopFilmRadioObserver();
  filmRadioObserver = new MutationObserver(function () {
    syncFilmRadioCover();
    syncFilmRadioMeta();
    syncFilmRadioProgress();
    syncFilmRadioPlayState();
  });
  var targets = [
    'control-cover', 'control-title-text', 'control-artist',
    'progress-fill', 'play-icon', 'time-display'
  ];
  targets.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) filmRadioObserver.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
  });
}

function stopFilmRadioObserver() {
  if (filmRadioObserver) {
    filmRadioObserver.disconnect();
    filmRadioObserver = null;
  }
}

/* 封面：从 #control-cover 的 background-image 同步到拍立得影像内层 */
function syncFilmRadioCover() {
  var src = document.getElementById('control-cover');
  var cover = document.querySelector('#fr-cover .fr-cover-img');
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

/* 标题/歌手（标题变化时同步刷新装饰性胶片戳记） */
function syncFilmRadioMeta() {
  var titleEl = document.getElementById('control-title-text');
  var artistEl = document.getElementById('control-artist');
  var frTitle = document.getElementById('fr-title');
  var frArtist = document.getElementById('fr-artist');
  var prevTitle = frTitle ? frTitle.textContent : '';
  if (frTitle && titleEl) frTitle.textContent = titleEl.textContent || '未在播放';
  if (frArtist && artistEl) frArtist.textContent = artistEl.textContent || '';
  /* 切歌：标题变了就重生成戳记 */
  if (frTitle && frTitle.textContent !== prevTitle) updateFilmRadioStamp();
}

/* 进度 + 时间 */
function syncFilmRadioProgress() {
  var fill = document.getElementById('progress-fill');
  var time = document.getElementById('time-display');
  var frFill = document.getElementById('fr-progress-fill');
  var frTime = document.getElementById('fr-time');
  if (frFill && fill) {
    var w = fill.style.width || '0%';
    frFill.style.width = w;
  }
  if (frTime && time) frTime.textContent = time.textContent || '0:00 / 0:00';
}

/* 播放状态：播放/暂停图标 + 封面停顿态 + 喜欢态
   （旧版驱动黑胶唱片旋转，现黑胶已移除，仅保留图标与封面停顿态钩子） */
function syncFilmRadioPlayState() {
  var frPlay = document.getElementById('fr-play');
  if (frPlay) {
    // Read the media element directly; SVG markup is presentation, not playback state.
    var isPlaying = !!(audio && audio.src && !audio.paused && !audio.ended);
    frPlay.innerHTML = isPlaying
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    frPlay.classList.toggle('is-playing', isPlaying);
    var cover = document.getElementById('fr-cover');
    if (cover) cover.classList.toggle('is-paused', !isPlaying);
  }
  var heart = document.getElementById('heart-btn');
  var frHeart = document.getElementById('fr-heart');
  if (frHeart && heart) frHeart.classList.toggle('liked', heart.classList.contains('liked'));
}

/* ---------- 装饰性胶片参数（日期戳 / ISO / 光圈 / 帧编号） ----------
   纯装饰：用当前曲目信息生成稳定的"胶片机身印记"，让拍立得有真实冲洗感。
   失败静默 —— 任何元素缺失都不影响播放。 */
var FILM_RADIO_ISO_TABLE = ['100', '200', '400', '800', '1600'];
var FILM_RADIO_APERTURE_TABLE = ['f/1.8', 'f/2.0', 'f/2.8', 'f/4', 'f/5.6'];
var FILM_RADIO_SHUTTER_TABLE = ['1/30s', '1/60s', '1/125s', '1/250s', '1/500s'];

/* 简易字符串 hash → 稳定整数（同一首歌每次生成相同参数） */
function frHashStr(s) {
  var h = 5381;
  s = String(s == null ? '' : s);
  for (var i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function updateFilmRadioStamp() {
  try {
    /* 拍立得底部戳记：日期 · 帧编号（基于歌名 hash 稳定） */
    var stamp = document.getElementById('fr-stamp');
    if (stamp) {
      var titleEl = document.getElementById('control-title-text');
      var title = (titleEl && titleEl.textContent) || '';
      var d = new Date();
      var ymd = d.getFullYear() + '·' + String(d.getMonth() + 1).padStart(2, '0') + '·' + String(d.getDate()).padStart(2, '0');
      var frameNo = (frHashStr(title) % 36) + 1;  /* 1-36，胶卷帧数 */
      stamp.textContent = ymd + '  FRAME ' + String(frameNo).padStart(2, '0');
    }
    /* 右侧数据戳：ISO · 光圈 · 快门（同一首歌稳定） */
    var data = document.getElementById('fr-data');
    if (data) {
      var t = (document.getElementById('control-title-text') && document.getElementById('control-title-text').textContent) || '';
      var h = frHashStr(t || 'orangesea');
      var iso = FILM_RADIO_ISO_TABLE[h % FILM_RADIO_ISO_TABLE.length];
      var apt = FILM_RADIO_APERTURE_TABLE[(h >> 3) % FILM_RADIO_APERTURE_TABLE.length];
      var sh = FILM_RADIO_SHUTTER_TABLE[(h >> 6) % FILM_RADIO_SHUTTER_TABLE.length];
      data.textContent = 'ISO ' + iso + '  ·  ' + apt + '  ·  ' + sh;
    }
  } catch (e) { /* 装饰失败不影响播放 */ }
}

/* ---------- 歌词渲染 ---------- */
function renderFilmRadioLyrics() {
  var container = document.getElementById('fr-lyrics');
  if (!container) return;
  if (!lyricsLines || !lyricsLines.length) {
    container.innerHTML = '<div class="fr-lyrics-empty">暂无歌词</div>';
    filmRadioLastLyricIdx = -99;
    return;
  }
  // 过滤纯占位 fallback
  var hasReal = lyricsLines.some(function (l) { return !l.fallback; });
  if (!hasReal) {
    container.innerHTML = '<div class="fr-lyrics-empty">暂无歌词</div>';
    filmRadioLastLyricIdx = -99;
    return;
  }
  var html = lyricsLines.map(function (line, i) {
    var cls = 'fr-lyric-row' + (line.fallback ? ' fallback' : '');
    var text = line.text || '';
    if (line.translation) text += '<span class="fr-lyric-trans">' + escapeFrHtml(line.translation) + '</span>';
    return '<div class="' + cls + '" data-idx="' + i + '">' + escapeFrHtml(line.text || '') + (line.translation ? '<br><span style="font-size:.82em;opacity:.7">' + escapeFrHtml(line.translation) + '</span>' : '') + '</div>';
  }).join('');
  container.innerHTML = html;
  filmRadioLastLyricIdx = -99;
}

function escapeFrHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function tickFilmRadioLyrics() {
  if (!filmRadioMode) return;
  if (!lyricsLines || !lyricsLines.length) return;
  var container = document.getElementById('fr-lyrics');
  if (!container) return;
  var idx;
  try {
    idx = findStageLyricIndexAtTime(getAdjustedLyricPlaybackTime(audio.currentTime));
  } catch (e) {
    return;
  }
  if (idx < 0) idx = -1;
  if (idx === filmRadioLastLyricIdx) return;
  filmRadioLastLyricIdx = idx;
  var rows = container.querySelectorAll('.fr-lyric-row');
  for (var i = 0; i < rows.length; i++) {
    rows[i].classList.toggle('active', i === idx);
  }
  // 滚动当前行居中：小步（≤2 行高）瞬时定位，避免 smooth 滚动动画
  // 与行的缩放/颜色过渡同时进行造成切换卡顿；大步（切歌等）才用平滑跟随。
  if (idx >= 0 && idx < rows.length) {
    var active = rows[idx];
    var target = active.offsetTop - container.clientHeight / 2 + active.clientHeight / 2;
    var step = Math.abs(target - container.scrollTop);
    container.scrollTo({ top: target, behavior: step < 96 ? 'auto' : 'smooth' });
  }
}

/* 监听 lyricsLines 变化重渲染（通过轮询 token，因 lyricsLines 是普通数组无事件） */
function watchFilmRadioLyricsChange() {
  var token = ++filmRadioLyricsObserverToken;
  var lastLen = -1;
  function check() {
    if (token !== filmRadioLyricsObserverToken || !filmRadioMode) return;
    var len = (lyricsLines && lyricsLines.length) || 0;
    if (len !== lastLen) {
      lastLen = len;
      renderFilmRadioLyrics();
    }
    setTimeout(check, 600);
  }
  check();
}

/* ---------- 频谱条 ---------- */
function ensureFilmRadioSpectrum() {
  if (filmRadioSpectrumBuilt) {
    tickFilmRadioSpectrum();
    return;
  }
  var container = document.getElementById('fr-spectrum');
  if (!container) return;
  container.innerHTML = '';
  for (var i = 0; i < 24; i++) {
    var bar = document.createElement('div');
    bar.className = 'fr-spectrum-bar';
    container.appendChild(bar);
  }
  filmRadioSpectrumBuilt = true;
}

function tickFilmRadioSpectrum() {
  if (!filmRadioMode || !filmRadioSpectrumBuilt) return;
  var bars = document.querySelectorAll('#fr-spectrum .fr-spectrum-bar');
  if (!bars.length) return;
  var data = frequencyData;
  var n = bars.length;
  // 对数映射：低频密集，取 bin 1..256（约 0-5.5kHz）
  for (var i = 0; i < n; i++) {
    var norm = i / (n - 1);
    var bin = Math.max(1, Math.floor(Math.pow(norm, 1.6) * 240 + 2));
    var v = (data && data[bin] ? data[bin] : 0) / 255;
    var scale = 0.1 + v * 0.9;
    bars[i].style.transform = 'scaleY(' + scale.toFixed(3) + ')';
  }
}

/* ---------- 主循环（rAF，节流到约 30fps） ---------- */
function startFilmRadioLoop() {
  stopFilmRadioLoop();
  var lastTick = 0;
  function frame(now) {
    if (!filmRadioMode) return;
    if (now - lastTick > 33) {
      lastTick = now;
      tickFilmRadioLyrics();
      tickFilmRadioSpectrum();
      syncFilmRadioProgress(); // 进度条高频更新
    }
    filmRadioRafId = requestAnimationFrame(frame);
  }
  filmRadioRafId = requestAnimationFrame(frame);
  watchFilmRadioLyricsChange();
}

function stopFilmRadioLoop() {
  if (filmRadioRafId) {
    cancelAnimationFrame(filmRadioRafId);
    filmRadioRafId = 0;
  }
  filmRadioLyricsObserverToken++; // 终止歌词轮询
}

/* ---------- 进度条拖动 seek ---------- */
function initFilmRadioProgressSeek() {
  var bar = document.getElementById('fr-progress');
  if (!bar || bar.dataset.frBound) return;
  bar.dataset.frBound = '1';

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
    filmRadioSeekDragging = true;
    bar.classList.add('dragging');
    bar.setPointerCapture(e.pointerId);
    var p = getPercent(e.clientX);
    var fill = document.getElementById('fr-progress-fill');
    if (fill) fill.style.width = (p * 100) + '%';
    e.preventDefault();
  });
  bar.addEventListener('pointermove', function (e) {
    if (!filmRadioSeekDragging) return;
    var p = getPercent(e.clientX);
    var fill = document.getElementById('fr-progress-fill');
    if (fill) fill.style.width = (p * 100) + '%';
  });
  bar.addEventListener('pointerup', function (e) {
    if (!filmRadioSeekDragging) return;
    filmRadioSeekDragging = false;
    bar.classList.remove('dragging');
    var p = getPercent(e.clientX);
    seekTo(p);
    try { bar.releasePointerCapture(e.pointerId); } catch (err) { }
  });
}

/* ---------- 启动绑定 ---------- */
function initFilmRadio() {
  // 进度条拖动
  initFilmRadioProgressSeek();
  // 模式变量在本模块执行时才从存储读取。统一在这里提交完整 DOM 状态，
  // 避免仅残留 html.film-radio-preload，导致标准底栏与胶片播放器同时不可见。
  applyFilmRadioMode(filmRadioMode, { save: false });
}

// 延迟到 DOM 就绪后初始化（本模块在 index-loader 末尾加载，DOM 已就绪）
scheduleUiWarmTask ? scheduleUiWarmTask(initFilmRadio, 300) : setTimeout(initFilmRadio, 300);
