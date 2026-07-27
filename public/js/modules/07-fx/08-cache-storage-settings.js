function mineradioCacheStorageNode(id) {
  return document.getElementById(id);
}

function formatOrangeSeaCacheBytes(value) {
  var bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return bytes + ' B';
  var units = ['KB', 'MB', 'GB', 'TB'];
  var index = -1;
  do {
    bytes /= 1024;
    index += 1;
  } while (bytes >= 1024 && index < units.length - 1);
  return (bytes >= 100 || index === 0 ? bytes.toFixed(0) : bytes.toFixed(1)) + ' ' + units[index];
}

function setOrangeSeaCacheStorageText(id, value) {
  var node = mineradioCacheStorageNode(id);
  if (node) node.textContent = value == null || value === '' ? '—' : String(value);
}

function applyOrangeSeaCacheSettings(snapshot) {
  if (!snapshot || !snapshot.ok) {
    setOrangeSeaCacheStorageText('cache-storage-total', '读取失败');
    setOrangeSeaCacheStorageText('cache-storage-note', snapshot && snapshot.error ? ('缓存设置不可用：' + snapshot.error) : '缓存设置不可用');
    return;
  }
  var settings = snapshot.settings || {};
  var usage = snapshot.usage || {};
  setOrangeSeaCacheStorageText('cache-storage-root', settings.rootPath);
  setOrangeSeaCacheStorageText('cache-storage-total', '已占用 ' + formatOrangeSeaCacheBytes(usage.totalManagedBytes));
  setOrangeSeaCacheStorageText('cache-storage-lyrics-path', settings.lyricsPath);
  setOrangeSeaCacheStorageText('cache-storage-lyrics-size', formatOrangeSeaCacheBytes(usage.lyricsBytes));
  setOrangeSeaCacheStorageText('cache-storage-chromium-path', settings.activeChromiumPath || settings.chromiumPath);
  setOrangeSeaCacheStorageText('cache-storage-chromium-size', formatOrangeSeaCacheBytes(usage.chromiumBytes));
  setOrangeSeaCacheStorageText('cache-storage-beatmaps-path', settings.activeBeatmapsPath || settings.beatmapsPath);
  setOrangeSeaCacheStorageText('cache-storage-beatmaps-size', formatOrangeSeaCacheBytes(usage.beatmapsBytes));
  setOrangeSeaCacheStorageText('cache-storage-updates-path', settings.activeUpdatesPath || settings.updatesPath);
  setOrangeSeaCacheStorageText('cache-storage-updates-size', formatOrangeSeaCacheBytes(usage.updatesBytes));
  setOrangeSeaCacheStorageText('cache-storage-wallpaper-path', settings.activeWallpaperEnginePath || settings.wallpaperEnginePath);
  setOrangeSeaCacheStorageText('cache-storage-wallpaper-size', formatOrangeSeaCacheBytes(usage.wallpaperEngineBytes));
  setOrangeSeaCacheStorageText('cache-storage-userdata-path', settings.userDataPath || '系统安全数据目录');
  setOrangeSeaCacheStorageText('cache-storage-userdata-size', formatOrangeSeaCacheBytes(usage.userDataBytes));
  var restartButton = mineradioCacheStorageNode('cache-storage-restart');
  if (restartButton) restartButton.hidden = !settings.restartRequired;
  setOrangeSeaCacheStorageText(
    'cache-storage-note',
    settings.restartRequired
      ? '歌词缓存已切换；封面、网络、音频分片、节奏分析、WE 静音场景与更新缓存将在重启后改用新目录。'
      : '歌词缓存立即生效；封面、网络、音频分片、节奏分析、WE 静音场景与更新缓存已使用此目录。'
  );
}

function refreshOrangeSeaCacheSettings() {
  if (!window.desktopWindow || typeof window.desktopWindow.getCacheSettings !== 'function') {
    applyOrangeSeaCacheSettings({ ok: false, error: '仅桌面版支持本地缓存路径设置' });
    return Promise.resolve();
  }
  setOrangeSeaCacheStorageText('cache-storage-total', '正在统计...');
  return window.desktopWindow.getCacheSettings().then(applyOrangeSeaCacheSettings).catch(function (error) {
    applyOrangeSeaCacheSettings({ ok: false, error: error && error.message || '读取失败' });
  });
}

function chooseOrangeSeaCacheRoot() {
  if (!window.desktopWindow || typeof window.desktopWindow.chooseCacheDirectory !== 'function') return;
  window.desktopWindow.chooseCacheDirectory().then(function (choice) {
    if (!choice || !choice.ok || choice.canceled || !choice.rootPath) return;
    return window.desktopWindow.setCacheSettings({ rootPath: choice.rootPath });
  }).then(function (snapshot) {
    if (snapshot) applyOrangeSeaCacheSettings(snapshot);
  }).catch(function (error) {
    applyOrangeSeaCacheSettings({ ok: false, error: error && error.message || '保存失败' });
  });
}

function restartOrangeSeaForCachePath() {
  if (!window.desktopWindow || typeof window.desktopWindow.restartApp !== 'function') return;
  window.desktopWindow.restartApp();
}

setTimeout(refreshOrangeSeaCacheSettings, 450);
