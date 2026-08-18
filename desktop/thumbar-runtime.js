'use strict';

// 任务栏缩略图工具栏（Thumbnail Toolbar）：鼠标悬停任务栏图标时在预览缩略图下
// 显示 上一首 | 播放/暂停 | 下一首 三个按钮。
//
// 点击动作复用 mineradio-global-hotkey 通道（与全局快捷键/迷你播放器同链路），
// 渲染进程 06-hotkeys.js → executeHotkeyAction 已有完整处理，播放执行路径零改动。
// 播放状态由渲染进程经 mineradio-playback-state 上报（仅在状态翻转时发送）。

const path = require('path');
const { ipcMain, nativeImage } = require('electron');

const ASSET_DIR = path.join(__dirname, 'assets', 'thumbar');
const DEBUG = !!process.env.MINERADIO_DEBUG_THUMBAR;

let _getMainWindow = null;
let _ipcRegistered = false;

const state = {
  playing: false,          // 最近一次上报的播放状态
  appliedPlaying: null,    // 已设置到窗口上的按钮状态（null = 尚未设置过）
};

const iconCache = new Map();
function loadIcon(name) {
  if (!iconCache.has(name)) {
    iconCache.set(name, nativeImage.createFromPath(path.join(ASSET_DIR, `${name}.png`)));
  }
  return iconCache.get(name);
}

function sendHotkeyAction(action) {
  const win = _getMainWindow && _getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('mineradio-global-hotkey', { action });
}

function applyThumbarButtons({ force = false } = {}) {
  if (process.platform !== 'win32') return;
  const win = _getMainWindow && _getMainWindow();
  if (!win || win.isDestroyed()) return;
  // 状态未变不重设：频繁调用会重建按钮、丢失悬停态
  if (!force && state.appliedPlaying === state.playing) return;
  const playing = state.playing;
  try {
    win.setThumbarButtons([
      { tooltip: '上一首', icon: loadIcon('prev'), click: () => sendHotkeyAction('prevTrack') },
      { tooltip: playing ? '暂停' : '播放', icon: loadIcon(playing ? 'pause' : 'play'), click: () => sendHotkeyAction('togglePlay') },
      { tooltip: '下一首', icon: loadIcon('next'), click: () => sendHotkeyAction('nextTrack') },
    ]);
    state.appliedPlaying = playing;
    if (DEBUG) console.log(`[Thumbar] buttons applied (playing=${playing})`);
  } catch (error) {
    // 透明窗口 / 全屏等场景下系统可能拒绝，不致命
    console.warn('[Thumbar] setThumbarButtons failed:', error && error.message || error);
  }
}

function registerThumbarIpc() {
  if (_ipcRegistered) return;
  _ipcRegistered = true;
  ipcMain.on('mineradio-playback-state', (_event, payload) => {
    const playing = !!(payload && payload.playing);
    if (DEBUG) console.log(`[Thumbar] playback-state report (playing=${playing})`);
    if (playing !== state.playing) {
      state.playing = playing;
      applyThumbarButtons();
    }
  });
}

// explorer.exe 重启后 Windows 会清空缩略图按钮，也用于窗口重载后的首次设置
function reapplyThumbar() {
  applyThumbarButtons({ force: true });
}

function setMainWindowGetter(getter) {
  _getMainWindow = typeof getter === 'function' ? getter : null;
}

module.exports = {
  setMainWindowGetter,
  registerThumbarIpc,
  reapplyThumbar,
};
