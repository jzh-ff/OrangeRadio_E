// ============================================================
//  睡眠定时器（20-sleep-timer）
//  ------------------------------------------------------------
//  底部控制条时钟按钮 → 弹层选 15/30/60/90 分钟或「当前曲目结束」；
//  到点暂停播放并 toast 提示。倒计时显示在弹层与按钮 title。
//  纯前端实现，状态为会话级（不持久化）。
// ============================================================

var sleepTimerState = {
  mode: 'off',        // 'off' | 'minutes' | 'track-end'
  minutes: 0,         // minutes 模式的总分钟数
  endsAt: 0,          // minutes 模式的结束时间戳
  timeoutId: 0,       // minutes 模式到点定时器
  tickId: 0,          // 倒计时 UI 刷新 interval
  endedHook: null,    // track-end 模式的事件钩子
};

function sleepTimerActive() {
  return sleepTimerState.mode !== 'off';
}

function formatSleepTimerRemaining(ms) {
  ms = Math.max(0, Math.round(ms / 1000) * 1000);
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return (m > 0 ? m + ':' : '') + (s < 10 ? '0' : '') + s;
}

function refreshSleepTimerUi() {
  const btn = document.getElementById('sleep-timer-btn');
  const countdown = document.getElementById('sleep-timer-countdown');
  if (sleepTimerState.mode === 'off') {
    if (btn) btn.title = '睡眠定时器';
    if (countdown) countdown.textContent = '';
    return;
  }
  if (sleepTimerState.mode === 'track-end') {
    if (btn) btn.title = '睡眠定时器：当前曲目结束后暂停';
    if (countdown) countdown.textContent = '当前曲目结束后暂停';
    return;
  }
  const remain = sleepTimerState.endsAt - Date.now();
  const text = formatSleepTimerRemaining(remain);
  if (btn) btn.title = '睡眠定时器：剩余 ' + text;
  if (countdown) countdown.textContent = '剩余 ' + text;
}

function toggleSleepTimerPanel(event) {
  if (event && event.stopPropagation) event.stopPropagation();
  const panel = document.getElementById('sleep-timer-popover');
  if (!panel) return;
  const willShow = panel.style.display === 'none';
  panel.style.display = willShow ? 'block' : 'none';
  if (willShow) refreshSleepTimerUi();
}

function closeSleepTimerPanel() {
  const panel = document.getElementById('sleep-timer-popover');
  if (panel) panel.style.display = 'none';
}

/* 到点动作：确保暂停（若已在暂停则只收尾） */
function fireSleepTimerPause(reason) {
  clearSleepTimerClock();
  sleepTimerState.mode = 'off';
  sleepTimerState.minutes = 0;
  sleepTimerState.endsAt = 0;
  refreshSleepTimerUi();
  try {
    if (audio && !audio.paused && typeof fadeOutAndPauseAudio === 'function') {
      if (typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting && typeof resetCuefieldAutoMix === 'function') {
        resetCuefieldAutoMix('sleep-timer');
      }
      if (
        typeof albumGaplessState !== 'undefined'
        && albumGaplessState
        && albumGaplessState.preload
        && (albumGaplessState.preload.mixPending || albumGaplessState.preload.mixStarted)
        && typeof clearAlbumGaplessPreload === 'function'
      ) clearAlbumGaplessPreload('sleep-timer');
      fadeOutAndPauseAudio();
      playing = false;
      if (typeof setPlayIcon === 'function') setPlayIcon(false);
      if (typeof hideLoading === 'function') hideLoading();
      if (typeof safePlaybackStep === 'function') safePlaybackStep('listen-stats-pause', function () {
        if (typeof updateListenStatsTick === 'function') updateListenStatsTick(true);
      });
    }
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[SleepTimer] pause failed:', e && e.message);
  }
  if (typeof showToast === 'function') showToast(reason === 'track-end' ? '当前曲目已结束，播放已暂停' : '睡眠定时器已到点，播放已暂停');
  closeSleepTimerPanel();
}

function clearSleepTimerClock() {
  if (sleepTimerState.timeoutId) { clearTimeout(sleepTimerState.timeoutId); sleepTimerState.timeoutId = 0; }
  if (sleepTimerState.tickId) { clearInterval(sleepTimerState.tickId); sleepTimerState.tickId = 0; }
  if (sleepTimerState.endedHook) {
    if (audio && typeof audio.removeEventListener === 'function') audio.removeEventListener('ended', sleepTimerState.endedHook);
    sleepTimerState.endedHook = null;
  }
}

function setSleepTimerMinutes(minutes) {
  minutes = Math.max(1, Number(minutes) || 15);
  clearSleepTimerClock();
  sleepTimerState.mode = 'minutes';
  sleepTimerState.minutes = minutes;
  sleepTimerState.endsAt = Date.now() + minutes * 60 * 1000;
  sleepTimerState.timeoutId = setTimeout(function () { fireSleepTimerPause('minutes'); }, minutes * 60 * 1000);
  sleepTimerState.tickId = setInterval(refreshSleepTimerUi, 1000);
  refreshSleepTimerUi();
  closeSleepTimerPanel();
  if (typeof showToast === 'function') showToast('睡眠定时器：' + minutes + ' 分钟后暂停播放');
}

function setSleepTimerTrackEnd() {
  clearSleepTimerClock();
  sleepTimerState.mode = 'track-end';
  sleepTimerState.endedHook = function () { fireSleepTimerPause('track-end'); };
  if (audio && typeof audio.addEventListener === 'function') audio.addEventListener('ended', sleepTimerState.endedHook);
  refreshSleepTimerUi();
  closeSleepTimerPanel();
  if (typeof showToast === 'function') showToast('睡眠定时器：当前曲目结束后暂停播放');
}

function cancelSleepTimer() {
  clearSleepTimerClock();
  sleepTimerState.mode = 'off';
  refreshSleepTimerUi();
  closeSleepTimerPanel();
}

/* 绑定弹层选项 */
(function bindSleepTimerControls() {
  const panel = document.getElementById('sleep-timer-popover');
  if (!panel) return;
  panel.querySelectorAll('.sleep-timer-opt').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const minutes = btn.getAttribute('data-minutes');
      const trackEnd = btn.getAttribute('data-track-end');
      if (trackEnd) setSleepTimerTrackEnd();
      else setSleepTimerMinutes(minutes);
    });
  });
  const cancelBtn = document.getElementById('sleep-timer-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', cancelSleepTimer);
})();
