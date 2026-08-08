/* =========================================================================
   OrangeSea · 歌曲下载路由（download）
   -------------------------------------------------------------------------
   POST /api/download      — 仅白名单平台：解析可播放 URL → 流式写盘到
                              SONG_DOWNLOAD_DIR → 写元数据 JSON（供本地库识别）
   GET  /api/download/status?id= — 下载任务状态轮询
   安全约束：不接受任意 URL，只按平台 songId 走各平台自己的 URL 解析；
   汽水加密音源走解密通道；Spotify/本地不产出下载。
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const utils = require('../utils');
const {
  getUserCookie,
  getQQCookie,
  getKugouCookie,
  getQishuiCookie,
  SONG_DOWNLOAD_DIR,
} = require('../context');
const neteasePlayback = require('../handlers/netease-playback');
const qqPlayback = require('../handlers/qq-playback');
const kugouApi = require('../../kugou-api');
const qishuiApi = require('../../qishui-api');

const DOWNLOAD_ALLOWED_PLATFORMS = ['netease', 'qq', 'kugou', 'qishui'];
const DOWNLOAD_MAX_CONCURRENCY = 2;
const DOWNLOAD_JOB_TTL_MS = 10 * 60 * 1000;

const downloadJobs = new Map();
let downloadActive = 0;

function safeDownloadFileName(name) {
  return String(name || 'song')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 80) || 'song';
}
function audioExtensionFromUrl(url) {
  const clean = String(url || '').split('#')[0].split('?')[0].toLowerCase();
  const m = clean.match(/\.(mp3|flac|m4a|aac|ogg|wav|opus)(?:$|[/])/);
  return m ? '.' + m[1] : '.mp3';
}

/* ---------- 平台 URL 解析（白名单，返回 { url, trial, playable, meta }） ---------- */
async function resolvePlatformDownloadUrl(song, quality) {
  const platform = String(song && (song.platform || song.provider || song.source) || '').toLowerCase();
  if (DOWNLOAD_ALLOWED_PLATFORMS.indexOf(platform) < 0) {
    const err = new Error('PLATFORM_NOT_DOWNLOADABLE');
    err.code = 'PLATFORM_NOT_DOWNLOADABLE';
    throw err;
  }
  if (platform === 'netease') {
    const info = await neteasePlayback.handleSongUrl(String(song.id || ''), { loggedIn: !!getUserCookie() }, quality || '', {
      name: song.name || song.title || '',
      artist: song.artist || '',
    });
    return { url: info && info.url, playable: info && info.playable !== false, trial: !!(info && info.trial), meta: info };
  }
  if (platform === 'qq') {
    const info = await qqPlayback.handleQQSongUrl(String(song.mid || song.id || ''), String(song.mediaMid || ''), quality || '', {
      vipRequired: song.vipRequired || '',
      needVip: song.needVip || '',
      onlyVipPlayable: song.onlyVipPlayable || '',
      privilege: song.privilege || '',
      fee: song.fee || '',
    });
    return { url: info && info.url, playable: info && info.playable !== false, trial: !!(info && info.trial), meta: info };
  }
  if (platform === 'kugou') {
    const info = await kugouApi.handleKugouSongUrl({
      hash: String(song.hash || song.id || ''),
      albumId: String(song.albumId || ''),
      albumAudioId: String(song.albumAudioId || song.mixSongId || ''),
      mixSongId: String(song.mixSongId || song.albumAudioId || ''),
      hqHash: String(song.hqHash || ''),
      sqHash: String(song.sqHash || ''),
      resHash: String(song.resHash || ''),
      quality: String(quality || ''),
      vipRequired: String(song.vipRequired || ''),
      needVip: String(song.needVip || ''),
      onlyVipPlayable: String(song.onlyVipPlayable || ''),
      privilege: String(song.privilege || ''),
      fee: String(song.fee || ''),
    }, getKugouCookie());
    return { url: info && info.url, playable: info && info.playable !== false, trial: !!(info && info.trial), meta: info };
  }
  // qishui
  const info = await qishuiApi.handleQishuiSongUrl({
    id: String(song.id || song.trackId || ''),
    quality: String(quality || ''),
    vipRequired: String(song.vipRequired || ''),
    needVip: String(song.needVip || ''),
    onlyVipPlayable: String(song.onlyVipPlayable || ''),
    privilege: String(song.privilege || ''),
    fee: String(song.fee || ''),
  }, getQishuiCookie());
  return { url: info && info.url, playable: info && info.playable !== false, trial: !!(info && info.trial), meta: info };
}

async function runDownloadQueued(fn) {
  if (downloadActive >= DOWNLOAD_MAX_CONCURRENCY) {
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  downloadActive++;
  try {
    return await fn();
  } finally {
    downloadActive--;
  }
}

async function performSongDownload(job) {
  const song = job.song || {};
  const resolved = await resolvePlatformDownloadUrl(song, job.quality);
  if (!resolved.url || resolved.playable === false || resolved.trial) {
    throw new Error('NO_PLAYABLE_URL: 该曲目当前无可用下载地址（可能需 VIP/购买或版权限制）');
  }
  fs.mkdirSync(SONG_DOWNLOAD_DIR, { recursive: true });

  let filePath;
  // 汽水加密音源：整段下载 + 解密（受 utils 的 200MB/并发限流约束）
  if (String(resolved.url).indexOf('#auth=') >= 0) {
    const decrypted = await utils.getQishuiDecryptedAudio(resolved.url);
    if (!decrypted || !decrypted.buffer) throw new Error('QISHUI_DECRYPT_FAILED');
    filePath = path.join(SONG_DOWNLOAD_DIR, safeDownloadFileName(song.name || 'song') + '-' + String(song.id || 'x').slice(0, 8) + (decrypted.extension || '.mp3'));
    fs.writeFileSync(filePath, decrypted.buffer);
    job.received = decrypted.buffer.length;
    job.total = decrypted.buffer.length;
    job.progress = 100;
  } else {
    const up = await utils.fetchWithTimeout(resolved.url, { headers: utils.audioProxyHeadersFor(resolved.url, '') }, 15000);
    if (!up.ok) throw new Error('HTTP_' + up.status);
    const ext = audioExtensionFromUrl(resolved.url);
    filePath = path.join(SONG_DOWNLOAD_DIR, safeDownloadFileName(song.name || 'song') + '-' + String(song.id || 'x').slice(0, 8) + ext);
    const total = Number(up.headers.get('content-length') || 0) || 0;
    job.total = total;
    job.received = 0;
    const reader = up.body.getReader();
    const writer = fs.createWriteStream(filePath);
    try {
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        job.received += step.value.length;
        if (total > 0) job.progress = Math.min(99, Math.round((job.received / total) * 100));
        if (!writer.write(Buffer.from(step.value))) {
          await new Promise((resolve) => writer.once('drain', resolve));
        }
      }
      await new Promise((resolve, reject) => {
        writer.end((err) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      try { fs.unlinkSync(filePath); } catch (_) {}
      throw err;
    } finally {
      try { reader.cancel(); } catch (_) {}
    }
    job.progress = 100;
  }

  // 元数据 JSON：与音频同名的 .osdownload.json，供本地库/用户识别来源
  const meta = {
    type: 'osdownload',
    version: 1,
    platform: job.platform,
    songId: String(song.id || ''),
    title: String(song.name || song.title || ''),
    artist: String(song.artist || ''),
    album: String(song.album || ''),
    cover: String(song.cover || ''),
    quality: String(job.quality || ''),
    downloadedAt: Date.now(),
    fileName: path.basename(filePath),
    filePath: filePath,
  };
  try {
    fs.writeFileSync(filePath + '.osdownload.json', JSON.stringify(meta, null, 2), 'utf8');
  } catch (e) {
    // 元数据写入失败不阻断下载本身
  }
  job.filePath = filePath;
  job.status = 'ready';
  job.updatedAt = Date.now();
  return meta;
}

function createSongDownloadJob(song, quality) {
  const now = Date.now();
  const id = now.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const platform = String(song && (song.platform || song.provider || song.source) || '').toLowerCase();
  const job = {
    id,
    platform,
    song,
    quality: String(quality || ''),
    status: 'queued',
    progress: 0,
    received: 0,
    total: 0,
    filePath: '',
    error: '',
    createdAt: now,
    updatedAt: now,
  };
  downloadJobs.set(id, job);
  trimDownloadJobs();
  runDownloadQueued(() => performSongDownload(job)).then((meta) => {
    job.meta = meta;
    job.updatedAt = Date.now();
  }).catch((err) => {
    job.status = 'error';
    job.error = (err && (err.code || err.message)) || 'DOWNLOAD_FAILED';
    job.updatedAt = Date.now();
  });
  return job;
}

function trimDownloadJobs() {
  const cutoff = Date.now() - DOWNLOAD_JOB_TTL_MS;
  for (const [id, job] of downloadJobs) {
    if (job.status !== 'queued' && job.status !== 'downloading' && (job.updatedAt || 0) < cutoff) {
      downloadJobs.delete(id);
    }
  }
}

function publicDownloadJob(job) {
  if (!job) return { ok: false, error: 'JOB_NOT_FOUND' };
  return {
    ok: true,
    id: job.id,
    platform: job.platform,
    status: job.status,
    progress: job.progress,
    received: job.received,
    total: job.total,
    filePath: job.filePath || '',
    error: job.error || '',
    meta: job.meta || null,
    updatedAt: job.updatedAt,
  };
}

async function handle(req, res, url) {
  const pn = url.pathname;

  if (pn === '/api/download' && req.method === 'POST') {
    try {
      const body = await utils.readRequestBody(req);
      const parsed = typeof body === 'string' ? JSON.parse(body) : (body || {});
      const song = parsed.song && typeof parsed.song === 'object' ? parsed.song : {};
      const platform = String(song.platform || song.provider || song.source || '').toLowerCase();
      if (DOWNLOAD_ALLOWED_PLATFORMS.indexOf(platform) < 0) {
        utils.sendJSON(res, { ok: false, error: 'PLATFORM_NOT_DOWNLOADABLE', message: '该平台暂不支持下载（支持：网易云/QQ/酷狗/汽水）' }, 400);
        return true;
      }
      if (!song.id) {
        utils.sendJSON(res, { ok: false, error: 'SONG_ID_MISSING' }, 400);
        return true;
      }
      const job = createSongDownloadJob(song, parsed.quality || '');
      utils.sendJSON(res, publicDownloadJob(job));
    } catch (err) {
      utils.sendJSON(res, { ok: false, error: err.message || 'DOWNLOAD_START_FAILED' }, 500);
    }
    return true;
  }

  if (pn === '/api/download/status') {
    const id = url.searchParams.get('id') || '';
    const job = id ? downloadJobs.get(id) : null;
    utils.sendJSON(res, publicDownloadJob(job), job ? 200 : 404);
    return true;
  }

  return false;
}

module.exports = {
  handle,
  createSongDownloadJob,
  publicDownloadJob,
  resolvePlatformDownloadUrl,
  safeDownloadFileName,
  audioExtensionFromUrl,
};
