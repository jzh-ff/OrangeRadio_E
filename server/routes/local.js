/* =========================================================================
   OrangeSea · 本地音乐库路由（local）
   -------------------------------------------------------------------------
   /api/local/* 端点：扫描、状态、搜索、歌词、URL 解析、音频流（Range）。
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const { sendJSON } = require('../utils');
const localLibrary = require('../../local-library');

const MIME_MAP = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.opus': 'audio/opus', '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
};

async function handle(req, res, url) {
  const pn = url.pathname;

  if (pn === '/api/local/scan') {
    if (req.method !== 'GET') { sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405); return true; }
    const dir = url.searchParams.get('dir') || '';
    if (!dir) { sendJSON(res, { ok: false, error: 'MISSING_DIR' }, 400); return true; }
    const result = await localLibrary.scanDirectory(dir);
    sendJSON(res, result);
    return true;
  }

  if (pn === '/api/local/status') {
    sendJSON(res, localLibrary.getLibraryStatus());
    return true;
  }

  if (pn === '/api/local/search') {
    const keywords = url.searchParams.get('keywords') || '';
    const limit = url.searchParams.get('limit') || '50';
    const offset = url.searchParams.get('offset') || '0';
    sendJSON(res, localLibrary.searchLibrary(keywords, limit, offset));
    return true;
  }

  if (pn === '/api/local/song/url') {
    const songPath = url.searchParams.get('path') || url.searchParams.get('localKey') || '';
    sendJSON(res, localLibrary.resolveLocalSongUrl(songPath));
    return true;
  }

  if (pn === '/api/local/lyric') {
    const songPath = url.searchParams.get('path') || '';
    sendJSON(res, localLibrary.readLocalLyric(songPath));
    return true;
  }

  if (pn === '/api/local/audio') {
    const songPath = url.searchParams.get('path') || '';
    if (!localLibrary.isPathAllowed(songPath)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'PATH_NOT_ALLOWED' }));
      return true;
    }
    let stat;
    try { stat = fs.statSync(songPath); } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'FILE_NOT_FOUND' }));
      return true;
    }
    const ext = path.extname(songPath).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
          'Content-Length': chunkSize,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        });
        fs.createReadStream(songPath, { start: start, end: end }).pipe(res);
        return true;
      }
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': stat.size,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(songPath).pipe(res);
    return true;
  }

  return false;
}

module.exports = { handle };
