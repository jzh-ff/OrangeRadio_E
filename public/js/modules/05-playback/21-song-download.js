// ============================================================
//  歌曲下载（21-song-download）
//  ------------------------------------------------------------
//  底部控制条下载按钮：把当前歌曲经 /api/download 下载到
//  SONG_DOWNLOAD_DIR（默认 D:\OrangeSeaCache\downloads），
//  轮询 /api/download/status 显示结果。
//  仅白名单平台（网易云/QQ/酷狗/汽水），播客/本地/Spotify 不支持。
// ============================================================

var SONG_DOWNLOAD_ALLOWED = ['netease', 'qq', 'kugou', 'qishui'];

function songDownloadPlatform(song) {
  return String(song && (song.platform || song.provider || song.source) || '').toLowerCase();
}

function downloadCurrentSong() {
  var song = typeof currentCoverSong === 'function'
    ? currentCoverSong()
    : (playQueue && playQueue[currentIdx] || null);
  if (!song) { showToast('先播放或选择一首歌'); return; }
  if (song.type === 'podcast' || song.source === 'podcast' || song.radioName) {
    showToast('播客暂不支持下载');
    return;
  }
  var platform = songDownloadPlatform(song);
  if (SONG_DOWNLOAD_ALLOWED.indexOf(platform) < 0) {
    showToast(platform === 'local' ? '本地歌曲无需下载' : '该平台暂不支持下载（支持：网易云/QQ/酷狗/汽水）');
    return;
  }
  try {
    fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song: song, quality: song.playbackQuality || '' }),
    }).then(function (resp) { return resp.json(); }).then(function (job) {
      if (!job || !job.ok || !job.id) {
        showToast('下载启动失败：' + ((job && (job.message || job.error)) || '未知错误'));
        return;
      }
      showToast('开始下载：' + (song.name || '') + ' …');
      pollSongDownloadStatus(job.id, song);
    }).catch(function (err) {
      showToast('下载请求失败：' + (err && err.message || '网络错误'));
    });
  } catch (e) {
    showToast('下载请求失败：' + (e && e.message || '未知错误'));
  }
}

function pollSongDownloadStatus(jobId, song) {
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    fetch('/api/download/status?id=' + encodeURIComponent(jobId)).then(function (resp) { return resp.json(); }).then(function (job) {
      if (!job || !job.ok) {
        clearInterval(timer);
        showToast('下载状态查询失败');
        return;
      }
      if (job.status === 'ready') {
        clearInterval(timer);
        var hasLyric = job.meta && job.meta.hasLyric;
        showToast('下载完成：' + (song.name || '') + (hasLyric ? '（含歌词，已保存到下载目录）' : '（已保存到下载目录）'));
      } else if (job.status === 'error') {
        clearInterval(timer);
        showToast('下载失败：' + (job.error || '未知错误'));
      } else if (tries >= 120) {
        clearInterval(timer);
        showToast('下载仍在进行中，稍后可再次查询');
      }
    }).catch(function () {});
  }, 2000);
}
