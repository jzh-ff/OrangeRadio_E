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
  ensureGenreSpectrum();
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
  if (typeof applyGenreTheme === 'function') applyGenreTheme(family);
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

/* ---------- 频谱条 ---------- */
function ensureGenreSpectrum() {
  if (genreSpectrumBuilt) {
    tickGenreSpectrum();
    return;
  }
  var container = document.getElementById('gm-spectrum');
  if (!container) return;
  container.innerHTML = '';
  for (var i = 0; i < 48; i++) {
    var bar = document.createElement('div');
    bar.className = 'gm-spectrum-bar';
    container.appendChild(bar);
  }
  genreSpectrumBuilt = true;
}

function tickGenreSpectrum() {
  if (!genreMode || !genreSpectrumBuilt) return;
  var bars = document.querySelectorAll('#gm-spectrum .gm-spectrum-bar');
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
function startGenreLoop() {
  stopGenreLoop();
  var lastTick = 0;
  function frame(now) {
    if (!genreMode) return;
    if (now - lastTick > 33) {
      lastTick = now;
      tickGenreLyrics();
      tickGenreSpectrum();
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
    applyGenreTheme(genreLock !== 'auto' ? genreLock : 'default');
    genreActiveFamily = genreLock !== 'auto' ? genreLock : 'default';
  }
  // 模式变量在本模块执行时才从存储读取。统一在这里提交完整 DOM 状态，
  // 避免仅残留 html.genre-mode-preload。
  applyGenreMode(genreMode, { save: false });
}

// 延迟到 DOM 就绪后初始化（本模块在 index-loader 末尾加载，DOM 已就绪）
scheduleUiWarmTask ? scheduleUiWarmTask(initGenreMode, 320) : setTimeout(initGenreMode, 320);
