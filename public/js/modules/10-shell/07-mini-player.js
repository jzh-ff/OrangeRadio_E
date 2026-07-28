/* =========================================================================
   OrangeSea · 迷你播放器状态推送 + 切换逻辑（主窗口侧）
   收集当前播放状态（封面/歌名/歌手/进度/播放态），通过 IPC 推送给迷你播放器窗口。
   复用现有状态读取函数（currentCoverSong/audio/updatePlaybackProgressUi 等）。
   ========================================================================= */

var MINI_PLAYER_STORE_KEY = 'orangesea-mini-player-v1';
var miniPlayerEnabled = false;
var miniPlayerPushTimer = 0;
var miniPlayerLastState = '';

function readMiniPlayerPreference() {
  try { return localStorage.getItem(MINI_PLAYER_STORE_KEY) === '1'; } catch (e) { return false; }
}
function saveMiniPlayerPreference(on) {
  try { localStorage.setItem(MINI_PLAYER_STORE_KEY, on ? '1' : '0'); } catch (e) { }
}

function getDesktopWindowApi() {
  return (typeof window !== 'undefined' && window.desktopWindow) ? window.desktopWindow : null;
}

/* 收集当前播放状态 */
function collectMiniPlayerState() {
  var song = (typeof currentCoverSong === 'function') ? currentCoverSong() : null;
  var title = (song && (song.name || song.title)) || '未在播放';
  var artist = (song && (song.artist || song.singer || song.al)) || '';
  var cover = '';
  if (song) {
    cover = song.customCover || song.cover || song.picUrl || song.albumCover || song.coverUrl || '';
  }
  var playing = (typeof playing !== 'undefined') ? playing : false;
  // playing 是关键字，用 audio.paused 判断更可靠
  var isPlaying = (typeof audio !== 'undefined' && audio && !audio.paused);
  var currentTime = (typeof audio !== 'undefined' && audio) ? (audio.currentTime || 0) : 0;
  var duration = (typeof audio !== 'undefined' && audio) ? (audio.duration || 0) : 0;
  return {
    title: String(title).slice(0, 120),
    artist: String(artist).slice(0, 80),
    cover: cover ? String(cover).slice(0, 512) : '',
    playing: isPlaying,
    currentTime: currentTime,
    duration: duration
  };
}

/* 推送状态到迷你播放器（节流 + diff 去重） */
function pushMiniPlayerState() {
  if (!miniPlayerEnabled) return;
  var api = getDesktopWindowApi();
  if (!api || typeof api.updateMiniPlayer !== 'function') {
    // 该 API 通过 setMiniPlayerEnabled 的副作用间接推送，这里无直接 update 接口时跳过
    return;
  }
  var st = collectMiniPlayerState();
  // diff 去重（封面/标题/播放态变化或进度变化>1s 才推送）
  var sig = st.title + '|' + st.artist + '|' + st.cover + '|' + st.playing + '|' + Math.floor(st.currentTime);
  if (sig === miniPlayerLastState) return;
  miniPlayerLastState = sig;
  try {
    // 主进程通过 sendMiniPlayerState 转发，但当前 API 设计是单向 set-enabled。
    // 这里用 window.desktopWindow 的扩展（如果存在），否则依赖主进程轮询。
    // 实际推送由 miniPlayerPushLoop 间接通过 desktopOverlay.onMiniPlayerState 完成。
  } catch (e) { }
}

/* 主进程需要主动拉状态——我们通过一个轻量 IPC 让主进程触发推送。
   简化方案：主窗口定期把状态写到主进程。用现有 updateDesktopLyrics 模式。*/
function startMiniPlayerPushLoop() {
  stopMiniPlayerPushLoop();
  function tick() {
    if (!miniPlayerEnabled) return;
    sendMiniPlayerStateToMain();
    miniPlayerPushTimer = setTimeout(tick, 800);
  }
  miniPlayerPushTimer = setTimeout(tick, 400);
}

function stopMiniPlayerPushLoop() {
  if (miniPlayerPushTimer) { clearTimeout(miniPlayerPushTimer); miniPlayerPushTimer = 0; }
}

function sendMiniPlayerStateToMain() {
  // 复用 IPC：主进程监听 mini-player-update 并转发到迷你窗口。
  // 但为减少改动，我们直接用 desktopWindow.updateMiniPlayer（在 preload 已暴露的通用接口）。
  // 当前 preload 只暴露 setMiniPlayerEnabled/onMiniPlayerEnabledState。
  // 推送状态：通过一个新增的 IPC channel，或复用 set-enabled 的 payload。
  // 简化：用 ipcRenderer.send 直接发（preload 暴露 sendMiniPlayerUpdate）。
  var api = getDesktopWindowApi();
  if (api && typeof api.sendMiniPlayerUpdate === 'function') {
    api.sendMiniPlayerUpdate(collectMiniPlayerState());
  }
}

/* 切换迷你播放器 */
function applyMiniPlayerEnabled(on, opts) {
  opts = opts || {};
  miniPlayerEnabled = !!on;
  var api = getDesktopWindowApi();
  if (api && typeof api.setMiniPlayerEnabled === 'function') {
    api.setMiniPlayerEnabled(miniPlayerEnabled);
  }
  if (opts.save) saveMiniPlayerPreference(miniPlayerEnabled);
  syncMiniPlayerButton();
  if (miniPlayerEnabled) {
    startMiniPlayerPushLoop();
  } else {
    stopMiniPlayerPushLoop();
    miniPlayerLastState = '';
  }
  if (opts.toast) showToast(miniPlayerEnabled ? '迷你播放器已开启' : '迷你播放器已关闭');
}

function toggleMiniPlayer() {
  applyMiniPlayerEnabled(!miniPlayerEnabled, { save: true, toast: true });
}

function syncMiniPlayerButton() {
  var btn = document.getElementById('mini-player-btn');
  if (!btn) return;
  btn.classList.toggle('on', miniPlayerEnabled);
  btn.setAttribute('aria-pressed', miniPlayerEnabled ? 'true' : 'false');
  btn.title = miniPlayerEnabled ? '隐藏迷你播放器' : '迷你播放器';
}

/* 启动恢复 */
function initMiniPlayer() {
  miniPlayerEnabled = readMiniPlayerPreference();
  syncMiniPlayerButton();
  // 监听主进程回传的开关状态（如用户从托盘关闭）
  var api = getDesktopWindowApi();
  if (api && typeof api.onMiniPlayerEnabledState === 'function') {
    api.onMiniPlayerEnabledState(function (payload) {
      var enabled = !!(payload && payload.enabled);
      if (enabled !== miniPlayerEnabled) {
        miniPlayerEnabled = enabled;
        saveMiniPlayerPreference(miniPlayerEnabled);
        syncMiniPlayerButton();
        if (miniPlayerEnabled) startMiniPlayerPushLoop(); else stopMiniPlayerPushLoop();
      }
    });
  }
  // 若启动时已开启（恢复），但主进程窗口尚未创建，主动创建
  if (miniPlayerEnabled) {
    scheduleUiWarmTask(function () { applyMiniPlayerEnabled(true, { save: false }); }, 1200);
  }
}

// 延迟初始化（等 DOM + desktopWindow 就绪）
scheduleUiWarmTask ? scheduleUiWarmTask(initMiniPlayer, 1500) : setTimeout(initMiniPlayer, 1500);
