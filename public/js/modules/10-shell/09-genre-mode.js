/* =========================================================================
   OrangeSea · 风格世界模式
   仅负责模式生命周期、HUD、世界罗盘和显式同步；帧推进由主循环统一调度。
   ========================================================================= */

var GENRE_MODE_STORE_KEY = 'orangesea-genre-mode-v1';
var GENRE_LOCK_STORE_KEY = 'orangesea-genre-lock-v1';
var GENRE_WORLD_IDS = [
  'electronic', 'rock-metal', 'hiphop', 'prism',
  'folk', 'classical', 'jazz-soul', 'ambient'
];
var GENRE_LEGACY_LOCK_WORLDS = {
  electronic: 'electronic',
  rock: 'rock-metal',
  metal: 'rock-metal',
  hiphop: 'hiphop',
  pop: 'prism',
  anime: 'prism',
  default: 'prism',
  folk: 'folk',
  classical: 'classical',
  jazz: 'jazz-soul',
  soul: 'jazz-soul',
  ambient: 'ambient'
};
var GENRE_PROFILE_SOURCE_LABELS = {
  genre: '标签识别',
  category: '分类识别',
  keyword: '关键词推断',
  legacy: '旧画像迁移',
  default: '综合回退'
};

var genreMode = typeof readBooleanPreference === 'function'
  ? readBooleanPreference(GENRE_MODE_STORE_KEY, false)
  : false;
// 模块加载时只捕获一次启动意图。film 的较早 warm init 可能因互斥写回
// genreMode=false；genre init 仍须兑现 preload 已选择的 genre 优先级。
var genreModeStartupRequested = genreMode;
var genreLock = 'auto';
try {
  genreLock = localStorage.getItem(GENRE_LOCK_STORE_KEY) || 'auto';
} catch (err) {
  genreLock = 'auto';
}
genreLock = migrateGenreWorldLock(genreLock);

var genreActiveWorldId = '';
var genreActiveProfile = null;
var genreLastTrackSignature = '';
var genreHudLastActivity = 0;
var genreHudLastPointerActivity = -Infinity;
var genreHudDimDelay = 4000;
var genreModeBindingsReady = false;

function migrateGenreWorldLock(value) {
  value = typeof value === 'string' ? value.trim() : 'auto';
  if (value === 'auto') return 'auto';
  if (GENRE_WORLD_IDS.indexOf(value) !== -1) return value;
  var migrated = GENRE_LEGACY_LOCK_WORLDS[value] || 'auto';
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GENRE_LOCK_STORE_KEY, migrated);
    }
  } catch (err) {}
  return migrated;
}

function genreModeSong() {
  return typeof currentCoverSong === 'function' ? currentCoverSong() : null;
}

function genreModeProfile(song) {
  if (typeof resolveGenreProfile === 'function') return resolveGenreProfile(song);
  return { family: 'default', world: 'prism', source: 'default', confidence: 0.15 };
}

function genreModeTrackSignature(song, profile) {
  if (!song) return 'none';
  var base;
  if (typeof genreProfileSignature === 'function') {
    try { base = genreProfileSignature(song); } catch (err) {}
  }
  if (!base) {
    base = JSON.stringify([
      song.provider, song.platform, song.source,
      song.id, song.songId, song.trackId, song.rid, song.mid, song.hash,
      song.localPath, song.path, song.url,
      song.genre, song.category, song.radioCategory,
      song.artist, song.name, song.album
    ]);
  }
  return base + '|' + [
    profile.family, profile.world, profile.source, profile.confidence
  ].join('|');
}

function genreModeWorldRecord(worldId) {
  return typeof getGenreWorld === 'function' ? getGenreWorld(worldId) : null;
}

function genreModeContext(song, profile, record) {
  return {
    track: song,
    profile: profile,
    world: record,
    lyricStyle: record && record.lyricStyle,
    reducedMotion: genreModePrefersReducedMotion()
  };
}

function genreModePrefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    return false;
  }
}

function setGenreModeDom(on) {
  if (typeof document === 'undefined') return;
  if (document.documentElement) {
    document.documentElement.classList.toggle('genre-mode-preload', !!on);
  }
  if (document.body) document.body.classList.toggle('genre-mode', !!on);
  var overlay = document.getElementById('genre-overlay');
  if (overlay) overlay.setAttribute('aria-hidden', on ? 'false' : 'true');
}

function rollbackGenreModeEntry(previousFilmMode, previousGraffitiMode, opts) {
  genreMode = false;
  setGenreModeDom(false);
  if (typeof resetGenreWorldAdaptiveQuality === 'function') {
    resetGenreWorldAdaptiveQuality();
  }
  if (typeof cancelGenreWorldTransition === 'function') cancelGenreWorldTransition();
  if (typeof stopGenreWorldEngine === 'function') stopGenreWorldEngine();
  if (typeof clearGenreWorldLyrics === 'function') clearGenreWorldLyrics();
  genreActiveWorldId = '';
  genreActiveProfile = null;
  genreLastTrackSignature = '';
  closeGenreModeCompass();
  var failedHud = typeof document !== 'undefined'
    ? document.getElementById('gm-hud')
    : null;
  if (failedHud) failedHud.classList.remove('is-dimmed', 'is-locked');
  if (typeof saveBooleanPreference === 'function') {
    saveBooleanPreference(GENRE_MODE_STORE_KEY, false);
  } else {
    try { localStorage.setItem(GENRE_MODE_STORE_KEY, 'false'); } catch (err) {}
  }
  if (previousFilmMode && typeof applyFilmRadioMode === 'function') {
    applyFilmRadioMode(true, { save: true });
  }
  if (previousGraffitiMode && typeof applyGraffitiMode === 'function') {
    applyGraffitiMode(true, { save: true });
  }
  if (typeof refreshPresetGrid === 'function') refreshPresetGrid();
  if (opts.toast && typeof showToast === 'function') showToast('风格世界启动失败');
  return false;
}

function applyGenreMode(on, opts) {
  opts = opts || {};
  on = !!on;
  var previousFilmMode = typeof filmRadioMode !== 'undefined' && !!filmRadioMode;
  var previousGraffitiMode = typeof graffitiMode !== 'undefined' && !!graffitiMode;
  if (on && typeof filmRadioMode !== 'undefined' && filmRadioMode &&
    typeof applyFilmRadioMode === 'function') {
    applyFilmRadioMode(false, { save: true });
  }
  if (on && typeof graffitiMode !== 'undefined' && graffitiMode &&
    typeof applyGraffitiMode === 'function') {
    applyGraffitiMode(false, { save: true });
  }

  if (on) {
    var song = genreModeSong();
    var engineStarted = typeof startGenreWorldEngine === 'function' &&
      startGenreWorldEngine({ track: song });
    if (!engineStarted) {
      return rollbackGenreModeEntry(previousFilmMode, previousGraffitiMode, opts);
    }
    genreMode = true;
    setGenreModeDom(true);
    if (opts.save && typeof saveBooleanPreference === 'function') {
      saveBooleanPreference(GENRE_MODE_STORE_KEY, true);
    }
    genreLastTrackSignature = '';
    var initialWorldReady = syncGenreModeTrack(true, { initial: true });
    if (initialWorldReady === false) {
      return rollbackGenreModeEntry(previousFilmMode, previousGraffitiMode, opts);
    }
    if (typeof syncGenreWorldAdaptiveQuality === 'function') {
      syncGenreWorldAdaptiveQuality(true);
    }
    syncGenreModeHud(true);
    noteGenreHudActivity();
  } else {
    genreMode = false;
    setGenreModeDom(false);
    if (opts.save && typeof saveBooleanPreference === 'function') {
      saveBooleanPreference(GENRE_MODE_STORE_KEY, false);
    }
    if (typeof resetGenreWorldAdaptiveQuality === 'function') {
      resetGenreWorldAdaptiveQuality();
    }
    if (typeof cancelGenreWorldTransition === 'function') cancelGenreWorldTransition();
    if (typeof stopGenreWorldEngine === 'function') stopGenreWorldEngine();
    if (typeof clearGenreWorldLyrics === 'function') clearGenreWorldLyrics();
    genreActiveWorldId = '';
    genreActiveProfile = null;
    genreLastTrackSignature = '';
    closeGenreModeCompass();
    var hud = typeof document !== 'undefined' ? document.getElementById('gm-hud') : null;
    if (hud) hud.classList.remove('is-dimmed', 'is-locked');
  }

  if (typeof refreshPresetGrid === 'function') refreshPresetGrid();
  if (opts.toast && typeof showToast === 'function') {
    showToast(genreMode ? '风格世界已开启' : '已切回标准模式');
  }
  return genreMode;
}

function toggleGenreMode() {
  return applyGenreMode(!genreMode, { save: true, toast: true });
}

function setGenreWorldLock(value) {
  value = migrateGenreWorldLock(value);
  if (value !== 'auto' && GENRE_WORLD_IDS.indexOf(value) === -1) return false;
  genreLock = value;
  try { localStorage.setItem(GENRE_LOCK_STORE_KEY, genreLock); } catch (err) {}
  genreLastTrackSignature = '';
  if (genreMode) syncGenreModeTrack(true);
  syncGenreModeHud(true);
  noteGenreHudActivity();
  if (typeof showToast === 'function') {
    var record = value === 'auto' ? null : genreModeWorldRecord(value);
    showToast(value === 'auto'
      ? '世界罗盘：自动跟随'
      : '世界已锁定：' + (record ? record.designName : value));
  }
  return true;
}

function syncGenreModeTrack(force, opts) {
  opts = opts || {};
  var song = genreModeSong();
  var profile = genreModeProfile(song);
  var targetWorldId = genreLock === 'auto' ? profile.world : genreLock;
  if (GENRE_WORLD_IDS.indexOf(targetWorldId) === -1) targetWorldId = 'prism';
  var signature = genreModeTrackSignature(song, profile) + '|lock:' + genreLock;
  if (!force && signature === genreLastTrackSignature) return false;

  genreLastTrackSignature = signature;
  genreActiveProfile = profile;
  var record = genreModeWorldRecord(targetWorldId);
  if (genreMode && typeof requestGenreWorldTransition === 'function') {
    var requested = requestGenreWorldTransition(
      targetWorldId,
      genreModeContext(song, profile, record),
      { initial: !!opts.initial, reducedMotion: genreModePrefersReducedMotion() }
    );
    if (!requested) {
      commitGenreModeWorldResult(
        targetWorldId,
        genreActiveWorldId || targetWorldId,
        true,
        genreModeContext(song, profile, record)
      );
    }
    if (opts.initial) return !!requested;
  } else {
    commitGenreModeWorldResult(
      targetWorldId,
      targetWorldId,
      false,
      genreModeContext(song, profile, record)
    );
  }
  return true;
}

function commitGenreModeWorldResult(targetWorldId, actualWorldId, failed, ctx) {
  actualWorldId = GENRE_WORLD_IDS.indexOf(actualWorldId) !== -1
    ? actualWorldId
    : (genreActiveWorldId || 'prism');
  genreActiveWorldId = actualWorldId;
  if (ctx && ctx.profile) genreActiveProfile = ctx.profile;
  var record = genreModeWorldRecord(actualWorldId);
  var overlay = typeof document !== 'undefined'
    ? document.getElementById('genre-overlay')
    : null;
  if (overlay) {
    overlay.dataset.world = actualWorldId;
    overlay.dataset.targetWorld = targetWorldId || actualWorldId;
    overlay.dataset.worldFailed = failed ? 'true' : 'false';
    overlay.dataset.lock = genreLock === 'auto' ? 'auto' : 'locked';
    overlay.dataset.lyricStyle = record && record.lyricStyle ? record.lyricStyle : '';
    if (record && overlay.style && typeof overlay.style.setProperty === 'function') {
      overlay.style.setProperty('--gm-accent', record.accent);
      overlay.style.setProperty('--gm-palette-a', record.palette[0]);
      overlay.style.setProperty('--gm-palette-b', record.palette[1]);
    }
  }
  syncGenreModeHud(true);
  return actualWorldId;
}

function genreModeFormatTime(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  var minutes = Math.floor(seconds / 60);
  var remainder = Math.floor(seconds % 60);
  return minutes + ':' + (remainder < 10 ? '0' : '') + remainder;
}

function genreModeDuration(song) {
  var duration = typeof audio !== 'undefined' && audio ? Number(audio.duration) : 0;
  if (isFinite(duration) && duration > 0) return duration;
  if (typeof getPlaybackDurationSeconds === 'function') {
    duration = Number(getPlaybackDurationSeconds());
    if (isFinite(duration) && duration > 0) return duration;
  }
  if (song) {
    duration = Number(song.duration || song.durationSec || 0);
    if (duration > 10000) duration /= 1000;
  }
  return isFinite(duration) && duration > 0 ? duration : 0;
}

function syncGenreModeHud(force) {
  if (typeof document === 'undefined') return false;
  var song = genreModeSong() || {};
  var profile = genreActiveProfile || genreModeProfile(song);
  var worldId = genreActiveWorldId ||
    (genreLock === 'auto' ? profile.world : genreLock);
  var record = genreModeWorldRecord(worldId) || {
    designName: worldId || '棱镜梦乐园',
    englishName: 'Prism Dreamland'
  };
  var setText = function (id, value) {
    var element = document.getElementById(id);
    if (element && (force || element.textContent !== value)) element.textContent = value;
  };
  setText('gm-world-name', record.designName || record.label || worldId);
  setText('gm-world-english', record.englishName || worldId);
  setText('gm-title', song.name || song.title || '未在播放');
  setText('gm-artist', song.artist || song.author || '');
  setText('gm-lock-state', genreLock === 'auto' ? '自动巡航' : '手动锁定');
  var confidence = Math.round((Number(profile.confidence) || 0) * 100);
  setText('gm-profile-source', genreLock === 'auto'
    ? (GENRE_PROFILE_SOURCE_LABELS[profile.source] || profile.source || '综合回退') + ' · ' + confidence + '%'
    : '罗盘指定 · 100%');

  var current = typeof audio !== 'undefined' && audio ? Number(audio.currentTime) || 0 : 0;
  var duration = genreModeDuration(song);
  var percent = duration > 0 ? Math.max(0, Math.min(100, current / duration * 100)) : 0;
  var fill = document.getElementById('gm-progress-fill');
  if (fill) fill.style.width = (Math.round(percent * 100) / 100) + '%';
  var timeText = genreModeFormatTime(current) + ' / ' + genreModeFormatTime(duration);
  setText('gm-time', timeText);
  var progress = document.getElementById('gm-progress');
  if (progress) {
    progress.setAttribute('aria-valuenow', String(Math.round(percent)));
    progress.setAttribute('aria-valuetext', timeText);
  }

  var hud = document.getElementById('gm-hud');
  if (hud) hud.classList.toggle('is-locked', genreLock !== 'auto');
  var compass = document.getElementById('gm-compass');
  if (compass && typeof compass.querySelectorAll === 'function') {
    var buttons = compass.querySelectorAll('[data-world]');
    for (var i = 0; i < buttons.length; i++) {
      var active = buttons[i].dataset.world === worldId;
      buttons[i].classList.toggle('is-active', active);
      buttons[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }
  return true;
}

function noteGenreHudActivity(now) {
  genreHudLastActivity = isFinite(Number(now))
    ? Number(now)
    : (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  var hud = typeof document !== 'undefined' ? document.getElementById('gm-hud') : null;
  if (hud) hud.classList.remove('is-dimmed');
}

function updateGenreHudVisibility(now) {
  if (!genreMode || typeof document === 'undefined') return false;
  now = Number(now);
  if (!isFinite(now)) return false;
  var hud = document.getElementById('gm-hud');
  if (!hud) return false;
  hud.classList.toggle('is-dimmed', now - genreHudLastActivity > genreHudDimDelay);
  return true;
}

function closeGenreModeCompass() {
  if (typeof document === 'undefined') return;
  var overlay = document.getElementById('genre-overlay');
  var expand = document.getElementById('gm-hud-expand');
  if (overlay) overlay.classList.remove('is-compass-open');
  if (expand) expand.setAttribute('aria-expanded', 'false');
}

function bindGenreModeUi() {
  if (genreModeBindingsReady || typeof document === 'undefined') return;
  genreModeBindingsReady = true;
  var compass = document.getElementById('gm-compass');
  if (compass) compass.addEventListener('click', function (event) {
    var button = event.target && event.target.closest
      ? event.target.closest('[data-world]')
      : null;
    if (button && button.dataset.world) {
      setGenreWorldLock(button.dataset.world);
      closeGenreModeCompass();
    }
  });
  var toggle = document.getElementById('gm-compass-toggle');
  if (toggle) toggle.addEventListener('click', function () {
    setGenreWorldLock(genreLock === 'auto' ? (genreActiveWorldId || 'prism') : 'auto');
  });
  var expand = document.getElementById('gm-hud-expand');
  if (expand) expand.addEventListener('click', function () {
    var overlay = document.getElementById('genre-overlay');
    var expanded = overlay ? !overlay.classList.contains('is-compass-open') : false;
    if (overlay) overlay.classList.toggle('is-compass-open', expanded);
    expand.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    noteGenreHudActivity();
  });
  var progress = document.getElementById('gm-progress');
  if (progress) {
    progress.addEventListener('pointerdown', function (event) {
      var rect = progress.getBoundingClientRect();
      var percent = rect.width > 0
        ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
        : 0;
      var duration = genreModeDuration(genreModeSong());
      if (duration > 0 && typeof audio !== 'undefined' && audio) {
        try { audio.currentTime = percent * duration; } catch (err) {}
      }
      syncGenreModeHud(true);
      noteGenreHudActivity();
      if (event.preventDefault) event.preventDefault();
    });
    progress.addEventListener('keydown', function (event) {
      var duration = genreModeDuration(genreModeSong());
      if (!duration || typeof audio === 'undefined' || !audio) return;
      var current = Number(audio.currentTime) || 0;
      var next = current;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - 5;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + 5;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = duration;
      else return;
      try { audio.currentTime = Math.max(0, Math.min(duration, next)); } catch (err) {}
      syncGenreModeHud(true);
      noteGenreHudActivity();
      if (event.preventDefault) event.preventDefault();
    });
  }
  var overlay = document.getElementById('genre-overlay');
  if (overlay) overlay.addEventListener('pointerdown', function () { noteGenreHudActivity(); });
  document.addEventListener('pointermove', function (event) {
    var now = event && isFinite(Number(event.timeStamp))
      ? Number(event.timeStamp)
      : (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    if (now - genreHudLastPointerActivity < 100) return;
    genreHudLastPointerActivity = now;
    noteGenreHudActivity(now);
  });
  document.addEventListener('keydown', function () { noteGenreHudActivity(); });
}

function initGenreMode() {
  bindGenreModeUi();
  syncGenreModeHud(true);
  var startupRequested = genreModeStartupRequested;
  genreModeStartupRequested = false;
  applyGenreMode(startupRequested || genreMode, { save: startupRequested });
}

if (typeof scheduleUiWarmTask === 'function') scheduleUiWarmTask(initGenreMode, 320);
else if (typeof document !== 'undefined' && document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGenreMode);
} else {
  initGenreMode();
}
