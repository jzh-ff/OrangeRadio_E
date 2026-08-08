/* =========================================================================
   OrangeSea · 媒体代理路由（proxy）
   -------------------------------------------------------------------------
   /api/cover（封面代理）、/api/audio（音频代理，Range + 汽水解密）。
   ========================================================================= */
'use strict';

const { UA } = require('../context');
const {
  sendAudioBuffer,
  fetchWithTimeout,
  audioProxyHeadersFor,
  audioContentTypeForUrl,
  getQishuiDecryptedAudio,
} = require('../utils');

async function handle(req, res, url) {
  const pn = url.pathname;

  if (pn === '/api/cover') {
    try {
      const coverUrl = url.searchParams.get('url');
      // URL 校验: 必须是 http(s) 开头, 否则直接 404 (不要让 fetch 抛错)
      if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        res.end('Invalid cover url');
        return true;
      }
      const resp = await fetch(coverUrl, { headers: { 'User-Agent': UA, 'Referer': 'https://music.163.com/' } });
      const ct  = resp.headers.get('content-type') || 'image/jpeg';
      const cl  = resp.headers.get('content-length');
      const hdr = {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=86400',
      };
      if (cl) hdr['Content-Length'] = cl;
      res.writeHead(resp.status, hdr);
      const reader = resp.body.getReader();
      while (true) { const c = await reader.read(); if (c.done) break; res.write(c.value); }
      res.end();
    } catch (err) { console.error('[Cover]', err); res.writeHead(500); res.end(); }
    return true;
  }

  // ---------- 音频代理 (支持 Range) ----------
  if (pn === '/api/audio') {
    try {
      const audioUrl = url.searchParams.get('url');
      if (!audioUrl) { res.writeHead(400); res.end('Missing url'); return true; }
      const range = req.headers.range || '';
      if (audioUrl.includes('#auth=')) {
        const decrypted = await getQishuiDecryptedAudio(audioUrl);
        if (decrypted && decrypted.buffer) {
          sendAudioBuffer(res, decrypted.buffer, decrypted.contentType, range);
          return true;
        }
      }
      const hdr = audioProxyHeadersFor(audioUrl, range);
      const up = await fetchWithTimeout(audioUrl, { headers: hdr }, 9000);
      const out = {
        'Content-Type': audioContentTypeForUrl(audioUrl, up.headers.get('content-type')),
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      };
      const cl = up.headers.get('content-length'); if (cl) out['Content-Length'] = cl;
      const cr = up.headers.get('content-range');  if (cr) out['Content-Range']  = cr;
      res.writeHead(up.status, out);
      if (up.body && typeof up.body.getReader === 'function') {
        const reader = up.body.getReader();
        let clientClosed = false;
        const closeReader = () => { clientClosed = true; };
        res.on('close', closeReader);
        try {
          while (!clientClosed) {
            const c = await reader.read();
            if (c.done) break;
            if (c.value && c.value.length) res.write(c.value);
          }
        } finally {
          res.removeListener('close', closeReader);
          if (clientClosed) {
            try { await reader.cancel(); } catch (_) {}
          }
        }
        if (clientClosed) return true;
        res.end();
      } else {
        res.end(await up.arrayBuffer());
      }
    } catch (err) {
      console.error('[Audio]', err && (err.code || err.name || err.message || 'AUDIO_PROXY_FAILED'));
      if (res.headersSent) {
        try { res.destroy(); } catch (_) {}
      } else {
        res.writeHead(err && err.name === 'AbortError' ? 504 : 502, { 'Cache-Control': 'no-store' });
        res.end();
      }
    }
    return true;
  }

  return false;
}

module.exports = { handle };
