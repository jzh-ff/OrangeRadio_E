// ============================================================
//  歌单导入导出（07-playlist-share）
//  ------------------------------------------------------------
//  导出：当前队列 → JSON 载荷 → 两种载体（.osplaylist.json 文件
//  + OSPL1: 分享码，gzip+base64url+FNV 校验）。
//  导入：读文件或粘贴分享码 → 解析 → 过滤无效曲目 → 追加到队列。
//  编解码为纯函数，便于测试。
// ============================================================

var PLAYLIST_SHARE_PREFIX = 'OSPL1:';
var PLAYLIST_SHARE_TYPES = ['netease', 'qq', 'kugou', 'qishui', 'spotify', 'local'];

function buildPlaylistSharePayload(name) {
  var songs = [];
  for (var i = 0; i < playQueue.length; i++) {
    var s = playQueue[i] || {};
    var platform = String(s.platform || s.provider || s.source || '').toLowerCase();
    if (PLAYLIST_SHARE_TYPES.indexOf(platform) < 0 || !s.id) continue;
    songs.push({
      platform: platform,
      id: String(s.id),
      title: String(s.name || s.title || ''),
      artist: String(s.artist || ''),
      cover: String(s.cover || ''),
      duration: Number(s.duration) || 0
    });
  }
  return { type: 'osplaylist', version: 1, name: String(name || '未命名歌单'), exportedAt: Date.now(), songs: songs };
}

/* 导入归一化：只保留已知平台 + 有 id 的曲目，映射为标准 song 对象 */
function normalizeImportedSongs(payload) {
  var out = [];
  var list = payload && Array.isArray(payload.songs) ? payload.songs : [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i] || {};
    var platform = String(item.platform || item.provider || item.source || '').toLowerCase();
    var id = String(item.id || '');
    if (PLAYLIST_SHARE_TYPES.indexOf(platform) < 0) continue;
    if (!id) continue;
    var title = String(item.title || item.name || '');
    out.push({
      platform: platform,
      provider: platform,
      source: platform,
      type: platform === 'local' ? 'local' : 'song',
      id: id,
      name: title,
      title: title,
      artist: String(item.artist || ''),
      cover: String(item.cover || ''),
      duration: Number(item.duration) || 0
    });
  }
  return out;
}

/* ---------- 分享码编解码（纯函数，gzip + base64url + FNV-1a 校验） ---------- */
function playlistShareChecksum(text) {
  var h = 0x811c9dc5;
  for (var i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).toUpperCase();
}
function shareBytesToBase64Url(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function shareBase64UrlToBytes(text) {
  var b64 = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function shareCompressText(text) {
  var stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
}
function shareDecompressBytes(bytes) {
  var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

async function encodePlaylistShareCode(payload) {
  var json = JSON.stringify(payload);
  var body;
  try {
    var compressed = await shareCompressText(json);
    body = 'G' + shareBytesToBase64Url(compressed);
  } catch (e) {
    body = 'J' + shareBytesToBase64Url(new TextEncoder().encode(json));
  }
  return PLAYLIST_SHARE_PREFIX + body + '.' + playlistShareChecksum(json);
}

async function decodePlaylistShareCode(code) {
  var text = String(code || '').trim();
  if (text.indexOf(PLAYLIST_SHARE_PREFIX) !== 0) return null;
  var rest = text.slice(PLAYLIST_SHARE_PREFIX.length);
  var dot = rest.lastIndexOf('.');
  if (dot <= 0) return null;
  var body = rest.slice(0, dot);
  var checksum = rest.slice(dot + 1);
  var codec = body.charAt(0);
  var json;
  try {
    var bytes = shareBase64UrlToBytes(body.slice(1));
    json = codec === 'G' ? await shareDecompressBytes(bytes) : new TextDecoder().decode(bytes);
  } catch (e) {
    return null;
  }
  if (playlistShareChecksum(json) !== checksum) return null;
  try {
    var payload = JSON.parse(json);
    if (!payload || payload.type !== 'osplaylist' || !Array.isArray(payload.songs)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/* ---------- UI ---------- */
function copyShareTextToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
      return true;
    }
  } catch (e) {}
  try {
    var area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
    return true;
  } catch (e) {}
  return false;
}

function downloadShareJson(payload) {
  try {
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (payload.name || 'osplaylist') + '.osplaylist.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    return true;
  } catch (e) {
    return false;
  }
}

async function exportPlaylistShare() {
  if (!playQueue || !playQueue.length) {
    showToast('队列为空，没有可导出的歌曲');
    return;
  }
  var payload = buildPlaylistSharePayload(currentQueueDisplayName && currentQueueDisplayName() || '');
  try {
    var code = await encodePlaylistShareCode(payload);
    var copied = copyShareTextToClipboard(code);
    var downloaded = downloadShareJson(payload);
    showToast('已导出 ' + payload.songs.length + ' 首：' + (copied ? '分享码已复制，' : '') + (downloaded ? '文件已下载' : ''));
  } catch (e) {
    showToast('导出失败：' + (e && e.message || '编码错误'));
  }
}

async function applyImportedPlaylistText(text, sourceName) {
  var payload = null;
  var textTrim = String(text || '').trim();
  if (textTrim.indexOf(PLAYLIST_SHARE_PREFIX) === 0) {
    payload = await decodePlaylistShareCode(textTrim);
  } else {
    try { payload = JSON.parse(textTrim); } catch (e) { payload = null; }
  }
  if (!payload || !Array.isArray(payload.songs)) {
    showToast('导入失败：无法识别的歌单内容' + (sourceName ? '（' + sourceName + '）' : ''));
    return;
  }
  var songs = normalizeImportedSongs(payload);
  if (!songs.length) {
    showToast('导入失败：歌单里没有可播放的曲目');
    return;
  }
  for (var i = 0; i < songs.length; i++) queueSong(songs[i]);
  safeRenderQueuePanel('playlist-share-import');
  safeShelfRebuild('playlist-share-import');
  showToast('已导入 ' + songs.length + ' 首到队列' + (payload.name ? '（' + payload.name + '）' : ''));
}

function importPlaylistShareFile() {
  try {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.osplaylist,.txt,text/plain,application/json';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { applyImportedPlaylistText(String(reader.result || ''), file.name); };
      reader.onerror = function () { showToast('导入失败：文件读取错误'); };
      reader.readAsText(file);
    };
    input.click();
  } catch (e) {
    showToast('导入失败：无法打开文件选择器');
  }
}

function importPlaylistShareCode() {
  var code = window.prompt('粘贴 OSPL1: 歌单分享码', '');
  if (code == null) return;
  applyImportedPlaylistText(code, '分享码');
}
