/* =========================================================================
   OrangeSea · 节拍 / 过渡 / 反馈缓存路由（beatmap）
   -------------------------------------------------------------------------
   /api/beatmap/cache/status、/api/cuefield/transition、
   /api/cuefield/feedback、/api/beatmap/cache。
   ========================================================================= */
'use strict';

const { sendJSON, readRequestBody } = require('../utils');
const { CUEFIELD_FEEDBACK_FILE } = require('../context');
const { planCuefieldTransitionFromCache } = require('../../cuefield/mineradio-bridge');
const { readCuefieldFeedbackStats, appendCuefieldFeedback } = require('../../cuefield/feedback-log');
const { beatCacheRootInfo, readBeatMapCache, writeBeatMapCache } = require('../handlers/beat-cache');

async function handle(req, res, url) {
  const pn = url.pathname;

  if (pn === '/api/beatmap/cache/status') {
    const info = beatCacheRootInfo();
    sendJSON(res, {
      enabled: info.allowed && info.available,
      dir: info.dir,
      drive: info.drive,
      reason: !info.allowed ? 'C_DRIVE_DISABLED' : (!info.available ? 'TARGET_DRIVE_UNAVAILABLE' : ''),
      mode: info.allowed && info.available ? 'disk' : 'memory-only',
    });
    return true;
  }

  // Cuefield only consumes OrangeSea's existing local beat-map cache. It never
  // receives account cookies, song files, or playback URLs on this route.
  if (pn === '/api/cuefield/transition') {
    if (req.method !== 'POST') {
      sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      return true;
    }
    try {
      const body = await readRequestBody(req);
      const plan = planCuefieldTransitionFromCache({
        fromKey: body.fromKey,
        toKey: body.toKey,
        fromLrc: body.fromLrc,
        toLrc: body.toLrc,
        exitBias: body.exitBias || 'late',
        maxEntryTime: Math.max(8, Math.min(32, Number(body.maxEntryTime) || 32)),
        readBeatMapCache,
      });
      sendJSON(res, plan);
    } catch (err) {
      sendJSON(res, {
        ok: false,
        error: err && (err.code || err.message) || 'CUEFIELD_TRANSITION_FAILED',
      }, 400);
    }
    return true;
  }

  // Feedback remains on this computer under Electron userData. The fan project's
  // optional remote-feedback module is intentionally not wired into OrangeSea.
  if (pn === '/api/cuefield/feedback') {
    if (req.method === 'GET') {
      try {
        sendJSON(res, { ok: true, stats: readCuefieldFeedbackStats(CUEFIELD_FEEDBACK_FILE) });
      } catch (err) {
        sendJSON(res, { ok: false, error: err.message || 'CUEFIELD_FEEDBACK_READ_FAILED' }, 500);
      }
      return true;
    }
    if (req.method === 'POST') {
      try {
        const body = await readRequestBody(req);
        const record = appendCuefieldFeedback(CUEFIELD_FEEDBACK_FILE, body);
        sendJSON(res, { ok: true, record });
      } catch (err) {
        sendJSON(res, { ok: false, error: err.code || err.message || 'CUEFIELD_FEEDBACK_SAVE_FAILED' }, 400);
      }
      return true;
    }
    sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    return true;
  }

  if (pn === '/api/beatmap/cache') {
    if (req.method === 'GET') {
      const key = url.searchParams.get('key') || '';
      try {
        const entry = readBeatMapCache(key);
        sendJSON(res, entry
          ? { ok: true, hit: true, key: entry.key || key, map: entry.map, meta: entry.meta || {}, savedAt: entry.savedAt || 0 }
          : { ok: true, hit: false, key });
      } catch (err) {
        const info = err.info || beatCacheRootInfo();
        sendJSON(res, {
          ok: false,
          hit: false,
          enabled: false,
          mode: 'memory-only',
          key,
          reason: err.code || err.message || 'BEAT_CACHE_READ_FAILED',
          dir: info.dir,
        });
      }
      return true;
    }

    if (req.method === 'POST') {
      try {
        const body = await readRequestBody(req);
        sendJSON(res, writeBeatMapCache(body));
      } catch (err) {
        const info = err.info || beatCacheRootInfo();
        sendJSON(res, {
          ok: false,
          enabled: false,
          mode: 'memory-only',
          reason: err.code || err.message || 'BEAT_CACHE_WRITE_FAILED',
          dir: info.dir,
        });
      }
      return true;
    }

    sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    return true;
  }

  return false;
}

module.exports = { handle };
