/* =========================================================================
   OrangeSea · 本地音乐库（Local Library）
   扫描本地音乐目录（music-metadata 读 ID3/FLAC 标签）、内存搜索、同名 .lrc 歌词。
   被 server.js 的 /api/local/* 端点调用。无登录、无加密、无外部 API。
   ========================================================================= */

const mm = require('music-metadata');
const fs = require('fs');
const path = require('path');

const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus', '.wma', '.aiff', '.aif'];
const AUDIO_EXT_SET = new Set(AUDIO_EXTS);
const SCAN_CONCURRENCY = 8;     // music-metadata 并发限流，避免阻塞
const MAX_SCAN_FILES = 5000;    // 单次扫描上限，防止超大规模目录

// 内存状态
let scannedLibrary = [];        // [{ type,source,provider,id,name,artist,album,cover,duration,localKey,localPath,localUrl }]
let scanRoots = [];             // 用户配置的根目录（绝对路径）
let lastScanAt = 0;
let scanning = false;

/* ---------- 工具 ---------- */
function isAudioFile(filename) {
  return AUDIO_EXT_SET.has(path.extname(filename).toLowerCase());
}

function escapeHtmlSafe(s) {
  return String(s == null ? '' : s).replace(/[<>"'&]/g, function (c) {
    return { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c];
  });
}

function buildLocalUrl(absPath) {
  return '/api/local/audio?path=' + encodeURIComponent(absPath);
}

/* 路径安全：必须在已配置根目录下 */
function isPathAllowed(filePath) {
  if (!filePath) return false;
  let resolved;
  try { resolved = path.resolve(filePath); } catch (e) { return false; }
  if (scanRoots.length === 0) return false;
  return scanRoots.some(function (root) {
    var r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
}

/* ---------- 扫描 ---------- */
async function walkDir(dir, fileList) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
  catch (e) { return; }
  for (const entry of entries) {
    if (fileList.length >= MAX_SCAN_FILES) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // 跳过隐藏目录和系统目录
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      await walkDir(full, fileList);
    } else if (entry.isFile() && isAudioFile(entry.name)) {
      fileList.push(full);
    }
  }
}

async function readMetadataWithLimit(filePath) {
  try {
    const meta = await mm.parseFile(filePath, { duration: false, skipCovers: false });
    const common = meta.common || {};
    // 内嵌封面转 data URL
    let cover = '';
    const pics = common.picture;
    if (pics && pics.length) {
      const pic = pics[0];
      const fmt = pic.format || 'image/jpeg';
      cover = 'data:' + fmt + ';base64,' + pic.data.toString('base64');
    }
    return {
      title: common.title || '',
      artist: common.artist || '',
      album: common.album || '',
      duration: meta.format && meta.format.duration ? Math.round(meta.format.duration) : 0,
      cover: cover
    };
  } catch (e) {
    return null;
  }
}

async function scanDirectory(dir) {
  if (scanning) return { ok: false, error: 'SCAN_IN_PROGRESS' };
  scanning = true;
  try {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return { ok: false, error: 'INVALID_DIRECTORY' };
    }
    // 注册根目录
    if (!scanRoots.includes(resolved)) scanRoots.push(resolved);

    const fileList = [];
    await walkDir(resolved, fileList);

    // 并发读元数据（限流）
    const songs = [];
    let idx = 0;
    async function worker() {
      while (idx < fileList.length) {
        const i = idx++;
        const filePath = fileList[i];
        const meta = await readMetadataWithLimit(filePath);
        const baseName = path.basename(filePath, path.extname(filePath));
        const song = {
          type: 'local',
          source: 'local',
          provider: 'local',
          id: filePath,
          name: (meta && meta.title) ? meta.title : baseName,
          artist: (meta && meta.artist) ? meta.artist : '未知艺术家',
          album: (meta && meta.album) ? meta.album : '',
          cover: (meta && meta.cover) ? meta.cover : '',
          duration: (meta && meta.duration) ? meta.duration : 0,
          localKey: filePath,
          localPath: filePath,
          localUrl: buildLocalUrl(filePath)
        };
        songs.push(song);
      }
    }
    const workers = [];
    for (let w = 0; w < SCAN_CONCURRENCY; w++) workers.push(worker());
    await Promise.all(workers);

    // 按名称排序
    songs.sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), 'zh-CN', { numeric: true });
    });

    scannedLibrary = songs;
    lastScanAt = Date.now();
    return { ok: true, count: songs.length, scannedAt: lastScanAt };
  } catch (e) {
    return { ok: false, error: e.message || 'SCAN_FAILED' };
  } finally {
    scanning = false;
  }
}

/* ---------- 搜索 ---------- */
function searchLibrary(keywords, limit, offset) {
  limit = Math.max(1, Math.min(100, Number(limit) || 20));
  offset = Math.max(0, Number(offset) || 0);
  const kw = String(keywords || '').trim().toLowerCase();
  let results;
  if (!kw) {
    results = scannedLibrary.slice();
  } else {
    results = scannedLibrary.filter(function (s) {
      return (s.name && s.name.toLowerCase().indexOf(kw) >= 0)
        || (s.artist && s.artist.toLowerCase().indexOf(kw) >= 0)
        || (s.album && s.album.toLowerCase().indexOf(kw) >= 0);
    });
  }
  const slice = results.slice(offset, offset + limit);
  return {
    provider: 'local',
    songs: slice,
    offset: offset,
    limit: limit,
    nextOffset: offset + slice.length,
    hasMore: offset + slice.length < results.length,
    total: results.length
  };
}

/* ---------- 歌词 ---------- */
function readLocalLyric(audioPath) {
  if (!audioPath || !isPathAllowed(audioPath)) return { provider: 'local', lyric: '', source: 'none' };
  // 尝试同名 .lrc
  const lrcPath = path.join(path.dirname(audioPath), path.basename(audioPath, path.extname(audioPath)) + '.lrc');
  try {
    if (fs.existsSync(lrcPath)) {
      const text = fs.readFileSync(lrcPath, 'utf8');
      return { provider: 'local', lyric: text, tlyric: '', yrc: '', source: 'local-lrc' };
    }
  } catch (e) { }
  return { provider: 'local', lyric: '', tlyric: '', yrc: '', source: 'none' };
}

/* ---------- song/url ---------- */
function resolveLocalSongUrl(audioPath) {
  if (!audioPath || !isPathAllowed(audioPath)) {
    return { provider: 'local', source: 'local', url: '', playable: false, error: 'PATH_NOT_ALLOWED' };
  }
  try {
    if (!fs.existsSync(audioPath)) {
      return { provider: 'local', source: 'local', url: '', playable: false, error: 'FILE_NOT_FOUND' };
    }
  } catch (e) {
    return { provider: 'local', source: 'local', url: '', playable: false, error: 'STAT_FAILED' };
  }
  return {
    provider: 'local',
    source: 'local',
    url: buildLocalUrl(audioPath),
    playable: true,
    trial: false
  };
}

/* ---------- 状态 ---------- */
function getLibraryStatus() {
  return {
    ok: true,
    scanning: scanning,
    count: scannedLibrary.length,
    scannedAt: lastScanAt,
    roots: scanRoots.slice()
  };
}

function addScanRoot(dir) {
  const resolved = path.resolve(dir);
  if (fs.existsSync(resolved) && !scanRoots.includes(resolved)) {
    scanRoots.push(resolved);
    return true;
  }
  return false;
}

function clearLibrary() {
  scannedLibrary = [];
  lastScanAt = 0;
}

module.exports = {
  AUDIO_EXTS,
  scanDirectory,
  searchLibrary,
  readLocalLyric,
  resolveLocalSongUrl,
  isPathAllowed,
  getLibraryStatus,
  addScanRoot,
  clearLibrary,
  buildLocalUrl
};
