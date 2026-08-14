// ============================================================

document.body.classList.add('splash-active');
var splashAnimating = true;
var splashTimer = null;
var reduceSplashMotion = false;
var splashReadyToEnter = false;
var splashPosterCaptured = false;
var splashVideoControlsBound = false;
var splashVideoObjectUrl = '';
var splashPosterObjectUrl = '';
var SPLASH_VIDEO_DB_NAME = 'orangesea-splash-video-v1';
var SPLASH_VIDEO_STORE = 'media';
var SPLASH_VIDEO_BLOB_ID = 'splash-bg-video';
var SPLASH_VIDEO_META_KEY = 'orangesea-splash-video-meta-v1';
var SPLASH_VIDEO_MAX_BYTES = 300 * 1024 * 1024;
var SPLASH_VIDEO_DEFAULT_SRC = 'assets/splash/splash.mp4';
var SPLASH_VIDEO_DEFAULT_POSTER = 'assets/splash/splash-poster.jpg';
var splashVideoDbPromise = null;

function splashNotify(message) {
  if (typeof showToast === 'function') showToast(message);
  else console.info('[SplashVideo]', message);
}

function splashIsMp4File(file) {
  if (!file || !/\.mp4$/i.test(String(file.name || ''))) return false;
  var type = String(file.type || '').toLowerCase();
  return !type || type === 'video/mp4';
}

function splashReadVideoMeta() {
  try {
    var meta = JSON.parse(localStorage.getItem(SPLASH_VIDEO_META_KEY) || 'null');
    if (!meta || meta.version !== 1 || !/\.mp4$/i.test(String(meta.name || ''))) return null;
    if (meta.type && String(meta.type).toLowerCase() !== 'video/mp4') return null;
    return meta;
  } catch (_error) {
    return null;
  }
}

function splashOpenVideoDb() {
  if (splashVideoDbPromise) return splashVideoDbPromise;
  splashVideoDbPromise = new Promise(function (resolve, reject) {
    if (!window.indexedDB) {
      reject(new Error('INDEXEDDB_UNAVAILABLE'));
      return;
    }
    var request = window.indexedDB.open(SPLASH_VIDEO_DB_NAME, 1);
    request.onupgradeneeded = function () {
      var db = request.result;
      if (!db.objectStoreNames.contains(SPLASH_VIDEO_STORE)) {
        db.createObjectStore(SPLASH_VIDEO_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () {
      splashVideoDbPromise = null;
      reject(request.error || new Error('SPLASH_VIDEO_DB_OPEN_FAILED'));
    };
  });
  return splashVideoDbPromise;
}

async function splashPutVideoBlob(blob, poster, meta) {
  var db = await splashOpenVideoDb();
  return new Promise(function (resolve, reject) {
    var transaction = db.transaction(SPLASH_VIDEO_STORE, 'readwrite');
    transaction.objectStore(SPLASH_VIDEO_STORE).put({
      id: SPLASH_VIDEO_BLOB_ID,
      blob: blob,
      poster: poster || null,
      meta: meta,
    });
    transaction.oncomplete = function () { resolve(); };
    transaction.onerror = function () { reject(transaction.error || new Error('SPLASH_VIDEO_SAVE_FAILED')); };
    transaction.onabort = function () { reject(transaction.error || new Error('SPLASH_VIDEO_SAVE_ABORTED')); };
  });
}

async function splashGetVideoBlob() {
  var db = await splashOpenVideoDb();
  return new Promise(function (resolve, reject) {
    var transaction = db.transaction(SPLASH_VIDEO_STORE, 'readonly');
    var request = transaction.objectStore(SPLASH_VIDEO_STORE).get(SPLASH_VIDEO_BLOB_ID);
    request.onsuccess = function () { resolve(request.result || null); };
    request.onerror = function () { reject(request.error || new Error('SPLASH_VIDEO_READ_FAILED')); };
  });
}

async function splashDeleteVideoBlob() {
  var db = await splashOpenVideoDb();
  return new Promise(function (resolve, reject) {
    var transaction = db.transaction(SPLASH_VIDEO_STORE, 'readwrite');
    transaction.objectStore(SPLASH_VIDEO_STORE).delete(SPLASH_VIDEO_BLOB_ID);
    transaction.oncomplete = function () { resolve(); };
    transaction.onerror = function () { reject(transaction.error || new Error('SPLASH_VIDEO_DELETE_FAILED')); };
    transaction.onabort = function () { reject(transaction.error || new Error('SPLASH_VIDEO_DELETE_ABORTED')); };
  });
}

function splashRenderVideoActions() {
  var meta = splashReadVideoMeta();
  var label = document.getElementById('splash-video-value');
  var clearBtn = document.getElementById('splash-video-clear-btn');
  if (label) label.textContent = meta && meta.name ? meta.name : '默认内置视频';
  if (clearBtn) clearBtn.disabled = !meta;
}

function extractSplashPosterBlob(file) {
  return new Promise(function (resolve) {
    var url = URL.createObjectURL(file);
    var video = document.createElement('video');
    var done = false;
    function finish(blob) {
      if (done) return;
      done = true;
      try { URL.revokeObjectURL(url); } catch (_error) { }
      resolve(blob || null);
    }
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.addEventListener('loadeddata', function () {
      try {
        var size = Math.min(video.videoWidth, video.videoHeight);
        if (!size) { finish(null); return; }
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d');
        if (!ctx) { finish(null); return; }
        ctx.drawImage(video, Math.floor((video.videoWidth - size) / 2), Math.floor((video.videoHeight - size) / 2), size, size, 0, 0, size, size);
        if (canvas.toBlob) canvas.toBlob(function (blob) { finish(blob); }, 'image/jpeg', 0.86);
        else finish(null);
      } catch (_error) {
        finish(null);
      }
    });
    video.addEventListener('error', function () { finish(null); });
    setTimeout(function () { finish(null); }, 4000);
    video.src = url;
  });
}

function openSplashVideoPicker() {
  var input = document.getElementById('splash-video-input');
  if (input) input.click();
}

async function handleSplashVideoFile(file) {
  if (!splashIsMp4File(file)) {
    splashNotify('这里只能选择 .mp4 文件');
    return;
  }
  if (Number(file.size) > SPLASH_VIDEO_MAX_BYTES) {
    splashNotify('MP4 不能超过 300 MB');
    return;
  }
  var meta = {
    version: 1,
    name: String(file.name || 'splash.mp4'),
    type: 'video/mp4',
    size: Number(file.size) || 0,
    savedAt: Date.now(),
  };
  try {
    var poster = await extractSplashPosterBlob(file);
    await splashPutVideoBlob(file, poster, meta);
    localStorage.setItem(SPLASH_VIDEO_META_KEY, JSON.stringify(meta));
    splashRenderVideoActions();
    splashNotify('启动页视频已保存，下次启动生效');
  } catch (error) {
    console.warn('[SplashVideoSave]', error);
    splashNotify('启动页视频保存失败');
  }
}

async function clearSplashVideo() {
  localStorage.removeItem(SPLASH_VIDEO_META_KEY);
  splashRenderVideoActions();
  try {
    await splashDeleteVideoBlob();
  } catch (error) {
    console.warn('[SplashVideoDelete]', error);
  }
  splashNotify('已恢复默认启动页视频，下次启动生效');
}

function bindSplashVideoControls() {
  if (splashVideoControlsBound) return;
  splashVideoControlsBound = true;
  var input = document.getElementById('splash-video-input');
  if (input) {
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      if (file) handleSplashVideoFile(file);
    });
  }
  splashRenderVideoActions();
}

function releaseStartupFastSkipPreload() {
  if (!document.documentElement.classList.contains('startup-fast-skip-preload')) return false;
  document.body.classList.add('startup-fast-skip-revealing');
  // This gate hides the whole renderer (including the player console) before
  // the fast-skip splash is released. Full desktop mode briefly hides and
  // reparents the Chromium HWND; waiting for another rAF here can therefore
  // leave the gate latched forever while only the native desktop controller is
  // visible. Release the gate synchronously, then keep only the cosmetic reveal
  // class on a timer.
  document.documentElement.classList.remove('startup-fast-skip-preload');
  setTimeout(function () { document.body.classList.remove('startup-fast-skip-revealing'); }, 520);
  return true;
}

function captureSplashAlbumFrame() {
  var video = document.getElementById('splash-video');
  var img = document.getElementById('splash-album-art');
  if (!video || !img || splashPosterCaptured) return;
  if (!video.videoWidth || !video.videoHeight) return;
  try {
    var size = Math.min(video.videoWidth, video.videoHeight);
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var sx = Math.floor((video.videoWidth - size) / 2);
    var sy = Math.floor((video.videoHeight - size) / 2);
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    img.src = canvas.toDataURL('image/jpeg', 0.86);
    splashPosterCaptured = true;
  } catch (e) { }
}

function releaseSplashObjectUrls() {
  if (splashVideoObjectUrl) {
    try { URL.revokeObjectURL(splashVideoObjectUrl); } catch (e) { }
    splashVideoObjectUrl = '';
  }
  if (splashPosterObjectUrl) {
    try { URL.revokeObjectURL(splashPosterObjectUrl); } catch (e) { }
    splashPosterObjectUrl = '';
  }
}

function stopSplashVideo() {
  var video = document.getElementById('splash-video');
  if (video) {
    try { video.pause(); } catch (e) { }
    try {
      video.removeAttribute('src');
      video.load();
    } catch (e) { }
  }
  releaseSplashObjectUrls();
}

function playSplashVideo() {
  var video = document.getElementById('splash-video');
  if (!video) return;
  if (reduceSplashMotion) {
    try { video.pause(); } catch (e) { }
    return;
  }
  var playPromise = video.play();
  if (playPromise && playPromise.catch) playPromise.catch(function () { });
}

async function applySplashVideoSource() {
  var video = document.getElementById('splash-video');
  var img = document.getElementById('splash-album-art');
  if (!video) return;
  var meta = splashReadVideoMeta();
  var record = null;
  if (meta) {
    try { record = await splashGetVideoBlob(); } catch (error) {
      console.warn('[SplashVideoRead]', error);
    }
  }
  splashPosterCaptured = false;
  releaseSplashObjectUrls();
  if (record && record.blob) {
    splashVideoObjectUrl = URL.createObjectURL(record.blob);
    video.src = splashVideoObjectUrl;
    if (record.poster) {
      splashPosterObjectUrl = URL.createObjectURL(record.poster);
      video.poster = splashPosterObjectUrl;
      if (img) img.src = splashPosterObjectUrl;
    }
  } else {
    if (meta) localStorage.removeItem(SPLASH_VIDEO_META_KEY);
    video.src = SPLASH_VIDEO_DEFAULT_SRC;
    video.poster = SPLASH_VIDEO_DEFAULT_POSTER;
    if (img) img.src = SPLASH_VIDEO_DEFAULT_POSTER;
  }
  playSplashVideo();
}

function initSplashVideo() {
  var video = document.getElementById('splash-video');
  if (!video) return;
  video.addEventListener('loadeddata', function () {
    captureSplashAlbumFrame();
    playSplashVideo();
  });
  video.addEventListener('seeked', captureSplashAlbumFrame);
  video.addEventListener('error', function () {
    if (!video.getAttribute('src') || video.getAttribute('src') === SPLASH_VIDEO_DEFAULT_SRC) return;
    localStorage.removeItem(SPLASH_VIDEO_META_KEY);
    splashRenderVideoActions();
    releaseSplashObjectUrls();
    video.src = SPLASH_VIDEO_DEFAULT_SRC;
    video.poster = SPLASH_VIDEO_DEFAULT_POSTER;
    var img = document.getElementById('splash-album-art');
    if (img) img.src = SPLASH_VIDEO_DEFAULT_POSTER;
    playSplashVideo();
  });
  applySplashVideoSource();
}

function finishSplashReveal(forceLoad, opts) {
  opts = opts || {};
  markAppPerf('home-revealed');
  // Never make the renderer's visibility depend on the next animation frame.
  // The desktop HWND may already be in its native handoff at this point.
  releaseStartupFastSkipPreload();
  requestAnimationFrame(function () {
    var homeShown = updateEmptyHomeVisibility({ forceLoad: forceLoad !== false });
    if (!homeShown && shouldForceEmptyHomeAfterSplash()) {
      homeSuppressed = false;
      homeForcedOpen = true;
      homeShown = updateEmptyHomeVisibility({ forceLoad: forceLoad !== false });
    }
    requestAnimationFrame(function () {
      markStartupHomeReadyForAutoplay(opts.reason || 'splash', opts.fastSkip ? 240 : 100);
      var guideStarted = maybeRunStartupVisualGuide('splash');
      if (!guideStarted && !hasAnyPlatformLogin()) maybeRunStartupLoginGuide('splash');
      else if (!guideStarted && !homeShown) maybeRunStartupLoginGuide('splash');
      setTimeout(maybeShowUploadTipOnce, 5200);
    });
  });
}

function dismissSplash(opts) {
  opts = opts || {};
  var s = document.getElementById('splash');
  if (!s || s.classList.contains('hide') || s.classList.contains('exiting')) return;
  var instant = !!opts.instant;
  markAppPerf(instant ? 'splash-skip' : 'splash-dismiss');
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  splashReadyToEnter = false;
  s.classList.remove('ready');
  stopSplashVideo();
  if (instant) {
    s.classList.add('hide');
    s.style.display = 'none';
    splashAnimating = false;
    document.body.classList.remove('splash-active');
    document.body.classList.remove('splash-revealing');
    revealIdleParticles(0, 520);
    finishSplashReveal(true, { fastSkip: true, reason: 'fast-skip' });
    return;
  }
  if (typeof shouldUseIdleWallpaperPreview === 'function'
    ? shouldUseIdleWallpaperPreview(true)
    : (typeof shouldShowEmptyHomeAfterSplash === 'function' && shouldShowEmptyHomeAfterSplash())) {
    activateHomeWallpaperPreview();
  }
  revealIdleParticles(0, reduceSplashMotion ? 520 : 920);
  document.body.classList.add('splash-revealing');
  s.classList.add('exiting');

  var content = s.querySelector('.splash-content');
  if (content) {
    content.style.transition = 'opacity 360ms cubic-bezier(.22,1,.36,1), transform 520ms cubic-bezier(.22,1,.36,1)';
    content.style.opacity = '0';
    content.style.transform = 'translateY(-10px) scale(.992)';
  }

  setTimeout(function () {
    s.classList.add('hide');
    splashAnimating = false;
    document.body.classList.remove('splash-active');
    document.body.classList.remove('splash-revealing');
    if (s && s.parentNode) s.style.display = 'none';
    finishSplashReveal(true, { reason: 'splash-dismiss' });
  }, 620);
}

function markSplashReadyToEnter() {
  var s = document.getElementById('splash');
  if (!s || s.classList.contains('hide') || s.classList.contains('exiting')) return;
  markAppPerf('splash-ready');
  splashReadyToEnter = true;
  splashTimer = null;
  s.classList.add('ready');
}

function bindSplashEnterFlow() {
  var s = document.getElementById('splash');
  if (!s) return;
  markAppPerf('dom-content-loaded');
  reduceSplashMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reduceSplashMotion) s.classList.add('reduce-motion');
  bindSplashVideoControls();
  if (startupFastSkipPreference) {
    dismissSplash({ instant: true });
    return;
  }
  prewarmHomeWallpaperPreview();
  initSplashVideo();
  markSplashReadyToEnter();
  function requestSplashEnter(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (splashReadyToEnter) dismissSplash();
  }
  var playBtn = document.getElementById('splash-play-btn');
  if (playBtn) playBtn.addEventListener('click', requestSplashEnter);
  document.addEventListener('keydown', function (e) {
    if (!document.body.classList.contains('splash-active')) return;
    if (e.key === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      requestSplashEnter(e);
    }
  });
}

// index-loader 异步注入时 DOM 可能已就绪：事件监听会错过，需按 readyState 直接执行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindSplashEnterFlow);
} else {
  bindSplashEnterFlow();
}
