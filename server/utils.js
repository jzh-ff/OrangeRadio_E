/* =========================================================================
   OrangeSea · 服务端共享工具（utils）
   -------------------------------------------------------------------------
   从原 server.js 拆出的「纯工具函数」：只依赖 context 常量/缓存或自带常量，
   不含业务状态。被多个路由/处理器模块共用。
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  requestText,
  requestJson,
} = require('./http-utils');
const {
  ALLOWED_ORIGIN,
  UA,
  qishuiAudioDecryptor,
  qishuiAudioDecryptCache,
  QISHUI_AUDIO_DECRYPT_CACHE_MAX_BYTES,
  qishuiAudioDecryptCacheBytes,
  APP_VERSION,
} = require('./context');
const { kugouAudioReferer } = require('../kugou-api');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

/* ---------- HTTP 响应 ---------- */
function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'text/plain',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(data);
  });
}
function sendJSON(res, data, status) {
  res.writeHead(status || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    // 数据接口（搜索/歌单/登录态等）仅允许本地前端源跨域读取，避免任意网页窃取。
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Vary': 'Origin',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(JSON.stringify(data));
}

/* ---------- 网络/超时 ---------- */
async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
  try {
    return await fetch(url, Object.assign({}, opts || {}, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}
function promiseWithTimeout(promise, timeoutMs, code) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(code || 'PROVIDER_REQUEST_TIMEOUT');
        err.code = code || 'PROVIDER_REQUEST_TIMEOUT';
        reject(err);
      }, Math.max(250, Number(timeoutMs) || 5000));
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
async function readStreamChunkWithTimeout(reader, timeoutMs) {
  let timer = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error('UPSTREAM_STREAM_IDLE_TIMEOUT');
          err.code = 'UPSTREAM_STREAM_IDLE_TIMEOUT';
          reject(err);
        }, timeoutMs || 12000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ---------- 基于 http/https 的文本/JSON 请求 ----------
   实现已收敛到零依赖的 ./http-utils（与 qishui/spotify/kugou 共用），
   此处保留导出接口。 */

/* ---------- 请求体 / 参数解析 ---------- */
function readRequestBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch (e) {
        const params = new URLSearchParams(raw);
        const out = {};
        params.forEach((v, k) => { out[k] = v; });
        resolve(out);
      }
    });
    req.on('error', () => resolve({}));
  });
}
function normalizeApiCode(payload) {
  const body = payload && (payload.body || payload);
  return Number((body && body.code) || (body && body.body && body.body.code) || (payload && payload.status) || 0);
}
function normalizeApiMessage(payload) {
  const body = payload && (payload.body || payload);
  return (body && (body.message || body.msg || body.error)) || (body && body.body && (body.body.message || body.body.msg || body.body.error)) || '';
}
function parseCookieString(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach(part => {
    const raw = String(part || '').trim();
    if (!raw) return;
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}
function serializeCookieObject(obj) {
  return Object.keys(obj || {})
    .filter(k => obj[k] != null && String(obj[k]) !== '')
    .map(k => k + '=' + String(obj[k]))
    .join('; ');
}
function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/* ---------- 音频代理 ---------- */
function audioProxyHeadersFor(audioUrl, range) {
  const headers = { 'User-Agent': UA, Referer: 'https://music.163.com/' };
  try {
    const host = new URL(audioUrl).hostname.toLowerCase();
    if (host.includes('qq.com') || host.includes('qpic.cn')) headers.Referer = 'https://y.qq.com/';
    if (host.includes('qishui.com') || host.includes('byteimg.com') || host.includes('douyin')) headers.Referer = 'https://www.qishui.com/';
    const kugouReferer = kugouAudioReferer(audioUrl);
    if (kugouReferer) headers.Referer = kugouReferer;
  } catch (e) {}
  if (range) headers.Range = range;
  return headers;
}
function audioContentTypeForUrl(audioUrl, upstreamType) {
  let pathname = '';
  try { pathname = new URL(audioUrl).pathname.toLowerCase(); } catch (e) {}
  if (/\.flac$/.test(pathname)) return 'audio/flac';
  if (/\.mp3$/.test(pathname)) return 'audio/mpeg';
  if (/\.(m4a|mp4)$/.test(pathname)) return 'audio/mp4';
  if (/\.ogg$/.test(pathname)) return 'audio/ogg';
  if (/\.wav$/.test(pathname)) return 'audio/wav';
  return upstreamType || 'audio/mpeg';
}
function sendAudioBuffer(res, buffer, contentType, range) {
  const total = buffer.length;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(range || ''));
  if (match) {
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : total - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + total });
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': contentType || 'audio/mp4',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
    });
    res.end(buffer.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, {
    'Content-Type': contentType || 'audio/mp4',
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'Content-Length': total,
  });
  res.end(buffer);
}

/* ---------- 汽水解密 ---------- */
// 限流防护：单曲最大 200MB（无损歌整段解密进内存），并发最多 2 个解密任务，
// 超出排队等待，防止多首歌曲同时触发时内存峰值失控
const QISHUI_AUDIO_DECRYPT_MAX_BYTES = 200 * 1024 * 1024;
const QISHUI_AUDIO_DECRYPT_MAX_CONCURRENCY = 2;
let qishuiDecryptActive = 0;
const qishuiDecryptQueue = [];

async function runQishuiDecryptQueued(fn) {
  if (qishuiDecryptActive >= QISHUI_AUDIO_DECRYPT_MAX_CONCURRENCY) {
    await new Promise((resolve) => qishuiDecryptQueue.push(resolve));
  }
  qishuiDecryptActive++;
  try {
    return await fn();
  } finally {
    qishuiDecryptActive--;
    const next = qishuiDecryptQueue.shift();
    if (next) next();
  }
}

function qishuiAudioAuthFromUrl(audioUrl) {
  const text = String(audioUrl || '');
  const idx = text.indexOf('#auth=');
  if (idx < 0) return { cleanUrl: text, auth: '' };
  const authRaw = text.slice(idx + 6);
  let auth = authRaw;
  try { auth = decodeURIComponent(authRaw); } catch (_) {}
  return { cleanUrl: text.slice(0, idx), auth };
}
function qishuiAudioCacheKey(cleanUrl, auth) {
  return crypto.createHash('sha1').update(String(cleanUrl || '') + '\n' + String(auth || '')).digest('hex');
}
function rememberQishuiDecryptedAudio(key, payload) {
  if (!payload || !Buffer.isBuffer(payload.buffer)) return;
  qishuiAudioDecryptCache.set(key, Object.assign({ at: Date.now() }, payload));
  qishuiAudioDecryptCacheBytes.value += payload.buffer.length;
  while (qishuiAudioDecryptCacheBytes.value > QISHUI_AUDIO_DECRYPT_CACHE_MAX_BYTES && qishuiAudioDecryptCache.size > 1) {
    const oldest = [...qishuiAudioDecryptCache.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0))[0];
    if (!oldest) break;
    qishuiAudioDecryptCache.delete(oldest[0]);
    qishuiAudioDecryptCacheBytes.value -= oldest[1].buffer.length;
  }
}
async function getQishuiDecryptedAudio(audioUrl) {
  const parsed = qishuiAudioAuthFromUrl(audioUrl);
  if (!parsed.auth) return null;
  const key = qishuiAudioCacheKey(parsed.cleanUrl, parsed.auth);
  const cached = qishuiAudioDecryptCache.get(key);
  if (cached) {
    cached.at = Date.now();
    return cached;
  }
  // 下载 + 解密整体排队限流；缓存命中不排队
  return runQishuiDecryptQueued(async () => {
    const up = await fetch(parsed.cleanUrl, { headers: audioProxyHeadersFor(parsed.cleanUrl, '') });
    if (!up.ok) throw new Error('Qishui encrypted audio fetch failed: HTTP ' + up.status);
    // 单曲大小上限：Content-Length 预检 + 流式累积计数，超限中止
    const contentLength = Number(up.headers && up.headers.get('content-length') || 0);
    if (contentLength > QISHUI_AUDIO_DECRYPT_MAX_BYTES) {
      throw new Error('Qishui encrypted audio exceeds size limit');
    }
    const chunks = [];
    let received = 0;
    if (up.body && typeof up.body.getReader === 'function') {
      const reader = up.body.getReader();
      while (true) {
        const step = await reader.read();
        if (step.done) break;
        received += step.value.length;
        if (received > QISHUI_AUDIO_DECRYPT_MAX_BYTES) {
          await reader.cancel();
          throw new Error('Qishui encrypted audio exceeds size limit');
        }
        chunks.push(Buffer.from(step.value));
      }
    } else {
      const buffer = Buffer.from(await up.arrayBuffer());
      if (buffer.length > QISHUI_AUDIO_DECRYPT_MAX_BYTES) {
        throw new Error('Qishui encrypted audio exceeds size limit');
      }
      chunks.push(buffer);
    }
    const encryptedBuffer = Buffer.concat(chunks);
    const result = qishuiAudioDecryptor.decrypt({ encryptedBuffer, spadeA: parsed.auth });
    const payload = {
      buffer: result.buffer,
      contentType: result.extension === '.flac' ? 'audio/flac' : 'audio/mp4',
      extension: result.extension,
    };
    rememberQishuiDecryptedAudio(key, payload);
    return payload;
  });
}

/* ---------- 杂项 ---------- */
function parseJSONText(text) {
  const raw = String(text || '').trim();
  const json = raw.replace(/^callback\(([\s\S]*)\);?$/, '$1');
  return JSON.parse(json);
}
function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}
function firstArrayFrom(objects, keys) {
  for (const obj of objects) {
    for (const key of keys) {
      const v = obj && obj[key];
      if (Array.isArray(v)) return v;
    }
  }
  return null;
}

module.exports = {
  MIME,
  serveStatic,
  sendJSON,
  fetchWithTimeout,
  promiseWithTimeout,
  readStreamChunkWithTimeout,
  requestText,
  requestJson,
  readRequestBody,
  normalizeApiCode,
  normalizeApiMessage,
  parseCookieString,
  serializeCookieObject,
  clampNumber,
  audioProxyHeadersFor,
  audioContentTypeForUrl,
  sendAudioBuffer,
  qishuiAudioAuthFromUrl,
  qishuiAudioCacheKey,
  QISHUI_AUDIO_DECRYPT_MAX_BYTES,
  runQishuiDecryptQueued,
  rememberQishuiDecryptedAudio,
  getQishuiDecryptedAudio,
  parseJSONText,
  decodeHtmlEntities,
  firstArrayFrom,
};
