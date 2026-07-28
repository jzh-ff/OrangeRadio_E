/* =========================================================================
   OrangeSea · 迷你播放器窗口（Mini Player）
   独立置顶小窗：封面 + 歌名/歌手 + 播放控制 + 进度。
   照抄 desktopLyricsWindow 模式：frame:false + transparent + alwaysOnTop + IPC 双向通信。
   控制动作复用全局快捷键系统（executeHotkeyAction）。
   ========================================================================= */

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let miniPlayerWindow = null;
let miniPlayerEnabled = false;
let miniPlayerBounds = null;  // 记忆上次位置

const MINI_PLAYER_WIDTH = 320;
const MINI_PLAYER_HEIGHT = 96;

function miniPlayerUrl(htmlFile) {
  const port = (typeof mainServerPort !== 'undefined') ? mainServerPort : 3000;
  return `http://127.0.0.1:${port}/${htmlFile}`;
}

function getDefaultMiniPlayerBounds() {
  if (miniPlayerBounds) return miniPlayerBounds;
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  // 默认放在右下角
  return {
    x: workArea.x + workArea.width - MINI_PLAYER_WIDTH - 24,
    y: workArea.y + workArea.height - MINI_PLAYER_HEIGHT - 24,
    width: MINI_PLAYER_WIDTH,
    height: MINI_PLAYER_HEIGHT,
  };
}

function createMiniPlayerWindow() {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    return miniPlayerWindow;
  }
  const bounds = getDefaultMiniPlayerBounds();
  miniPlayerWindow = new BrowserWindow({
    ...bounds,
    minWidth: 280,
    minHeight: 88,
    maxWidth: 480,
    maxHeight: 140,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: true,
    movable: true,
    focusable: true,
    skipTaskbar: true,
    show: false,
    title: 'OrangeSea Mini Player',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  try {
    miniPlayerWindow.setAlwaysOnTop(true, 'screen-saver');
    miniPlayerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) {
    console.warn('Mini player topmost setup skipped:', e.message);
  }
  miniPlayerWindow.once('ready-to-show', () => {
    if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return;
    miniPlayerWindow.showInactive();
  });
  miniPlayerWindow.on('moved', () => {
    if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return;
    miniPlayerBounds = miniPlayerWindow.getBounds();
  });
  miniPlayerWindow.on('resized', () => {
    if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return;
    miniPlayerBounds = miniPlayerWindow.getBounds();
  });
  miniPlayerWindow.on('closed', () => {
    miniPlayerWindow = null;
    miniPlayerEnabled = false;
    broadcastMiniPlayerEnabledState(false);
  });
  miniPlayerWindow.loadURL(miniPlayerUrl('mini-player.html')).catch((e) =>
    console.warn('Mini player load failed:', e.message)
  );
  return miniPlayerWindow;
}

function closeMiniPlayerWindow() {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.close();
  }
  miniPlayerWindow = null;
  miniPlayerEnabled = false;
}

function setMiniPlayerEnabled(enabled) {
  miniPlayerEnabled = !!enabled;
  if (enabled) {
    createMiniPlayerWindow();
  } else {
    closeMiniPlayerWindow();
  }
  broadcastMiniPlayerEnabledState(miniPlayerEnabled);
}

function broadcastMiniPlayerEnabledState(enabled) {
  // 通知主窗口迷你播放器开关状态
  const win = (typeof mainWindow !== 'undefined') ? mainWindow : null;
  if (win && !win.isDestroyed()) {
    win.webContents.send('mineradio-mini-player-enabled-state', { enabled });
  }
}

function sendMiniPlayerState(payload) {
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return;
  miniPlayerWindow.webContents.send('mineradio-mini-player-state', payload || {});
}

function forwardMiniPlayerAction(action) {
  // 转发到主窗口，复用全局快捷键系统的 action 机制
  const win = (typeof mainWindow !== 'undefined') ? mainWindow : null;
  if (win && !win.isDestroyed()) {
    win.webContents.send('mineradio-global-hotkey', { action });
  }
}

function isMiniPlayerEnabled() {
  return miniPlayerEnabled;
}

function isMiniPlayerAlive() {
  return !!(miniPlayerWindow && !miniPlayerWindow.isDestroyed());
}

/* ---------- IPC handlers（照抄 desktop-lyrics 模式） ---------- */
function registerMiniPlayerIpc() {
  ipcMain.handle('mineradio-mini-player-set-enabled', async (_event, enabled) => {
    try {
      setMiniPlayerEnabled(!!enabled);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || 'MINI_PLAYER_FAILED' };
    }
  });

  ipcMain.handle('mineradio-mini-player-get-enabled', async () => {
    return { ok: true, enabled: miniPlayerEnabled };
  });

  // 迷你播放器 → 主进程 → 主窗口（控制动作）
  ipcMain.on('mineradio-mini-player-action', (_event, action) => {
    const act = String(action || '').slice(0, 48);
    if (act) forwardMiniPlayerAction(act);
  });

  // 主窗口 → 主进程 → 迷你播放器（状态推送）
  ipcMain.on('mineradio-mini-player-update', (_event, payload) => {
    sendMiniPlayerState(payload || {});
  });
}

module.exports = {
  createMiniPlayerWindow,
  closeMiniPlayerWindow,
  setMiniPlayerEnabled,
  sendMiniPlayerState,
  isMiniPlayerEnabled,
  isMiniPlayerAlive,
  registerMiniPlayerIpc,
};
