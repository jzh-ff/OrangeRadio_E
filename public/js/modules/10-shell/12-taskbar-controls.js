/* =========================================================================
   OrangeSea · 任务栏缩略图工具栏状态上报（主窗口侧）
   低频轮询播放状态（audio.paused），仅在播放/暂停翻转时上报主进程，
   由 thumbar-runtime 更新任务栏预览的 播放/暂停 按钮图标。
   ========================================================================= */

var taskbarControlsTimer = 0;
var taskbarLastPlaying = null;

function getTaskbarApi() {
  return (typeof window !== 'undefined' && window.desktopWindow) ? window.desktopWindow : null;
}

function collectTaskbarPlayingState() {
  // audio 元素在初始化/首次播放前不存在，此时退回全局 playing 变量
  if (typeof audio !== 'undefined' && audio) return !audio.paused;
  if (typeof playing !== 'undefined') return !!playing;
  return null;
}

function taskbarControlsTick() {
  var api = getTaskbarApi();
  if (!api || typeof api.sendPlaybackState !== 'function') return;
  var isPlaying = collectTaskbarPlayingState();
  if (isPlaying === null) return;
  if (isPlaying === taskbarLastPlaying) return;
  taskbarLastPlaying = isPlaying;
  try {
    api.sendPlaybackState({ playing: isPlaying });
  } catch (e) { }
}

function startTaskbarControlsLoop() {
  stopTaskbarControlsLoop();
  taskbarControlsTimer = setInterval(taskbarControlsTick, 1000);
  taskbarControlsTick();
}

function stopTaskbarControlsLoop() {
  if (taskbarControlsTimer) { clearInterval(taskbarControlsTimer); taskbarControlsTimer = 0; }
}

/* 延迟启动：等待 audio 元素与 preload API 就绪（tick 内部自愈，未就绪下一轮重试） */
setTimeout(startTaskbarControlsLoop, 1200);
