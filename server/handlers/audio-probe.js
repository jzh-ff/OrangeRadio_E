/* =========================================================================
   OrangeSea · 音频字节探测（audio-probe）
   -------------------------------------------------------------------------
   从原 server.js 拆出：audioProbeMagic / probePlaybackAudioUrl /
   probeQQAudioUrl 与 QQ 探测预算常量。被 netease-playback / qq-playback
   共用。纯工具 + 网络探测，不持有业务状态。
   ========================================================================= */
'use strict';

const { fetchWithTimeout, readStreamChunkWithTimeout, audioProxyHeadersFor } = require('../utils');

// Keep the complete vkey + media verification path below the renderer's
// 15-second QQ request deadline (6.0s + 6.2s, with ~2.8s response margin).
const QQ_VKEY_REQUEST_TIMEOUT_MS = 6000;
const QQ_AUDIO_PROBE_TOTAL_MS = 6200;
const QQ_AUDIO_PROBE_ATTEMPT_MS = 2000;
const AUDIO_URL_PROBE_BYTES = 8192;

function audioProbeMagic(buffer) {
  if (!buffer || !buffer.length) return '';
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3-id3';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'fLaC') return 'flac';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'wave';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  const scan = Math.min(buffer.length - 1, 2048);
  for (let i = 0; i < scan; i++) {
    if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) return 'mpeg-frame';
  }
  return '';
}

async function probePlaybackAudioUrl(audioUrl, timeoutMs) {
  try {
    const probeStartedAt = Date.now();
    const probeBudgetMs = Math.max(800, Number(timeoutMs) || QQ_AUDIO_PROBE_ATTEMPT_MS);
    const resp = await fetchWithTimeout(audioUrl, {
      headers: audioProxyHeadersFor(audioUrl, 'bytes=0-' + (AUDIO_URL_PROBE_BYTES - 1)),
    }, probeBudgetMs);
    const status = Number(resp.status) || 0;
    const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
    const chunks = [];
    let bytes = 0;
    if (resp.body && (status === 200 || status === 206)) {
      const reader = resp.body.getReader();
      const deadline = probeStartedAt + probeBudgetMs;
      try {
        while (bytes < AUDIO_URL_PROBE_BYTES && Date.now() < deadline) {
          const chunk = await readStreamChunkWithTimeout(reader, Math.max(50, deadline - Date.now()));
          if (chunk.done) break;
          const buf = Buffer.from(chunk.value || []);
          if (!buf.length) continue;
          chunks.push(buf);
          bytes += buf.length;
        }
      } finally {
        try { await reader.cancel(); } catch (_) {}
      }
    } else {
      try { if (resp.body && typeof resp.body.cancel === 'function') await resp.body.cancel(); } catch (_) {}
    }
    const sample = chunks.length ? Buffer.concat(chunks, bytes).subarray(0, AUDIO_URL_PROBE_BYTES) : Buffer.alloc(0);
    const magic = audioProbeMagic(sample);
    const contentLooksText = /text\/html|application\/(json|xml)|text\/plain/.test(contentType);
    return {
      ok: (status === 200 || status === 206) && sample.length >= 512 && !contentLooksText && !!magic,
      status,
      bytes: sample.length,
      contentType,
      magic,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      reason: err && err.name === 'AbortError' ? 'timeout' : 'network',
    };
  }
}

async function probeQQAudioUrl(audioUrl, timeoutMs) {
  return probePlaybackAudioUrl(audioUrl, timeoutMs || QQ_AUDIO_PROBE_ATTEMPT_MS);
}

module.exports = {
  QQ_VKEY_REQUEST_TIMEOUT_MS,
  QQ_AUDIO_PROBE_TOTAL_MS,
  QQ_AUDIO_PROBE_ATTEMPT_MS,
  AUDIO_URL_PROBE_BYTES,
  audioProbeMagic,
  probePlaybackAudioUrl,
  probeQQAudioUrl,
};
