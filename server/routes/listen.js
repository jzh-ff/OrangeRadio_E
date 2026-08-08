/* =========================================================================
   OrangeSea · 听歌上报路由（listen）
   -------------------------------------------------------------------------
   /api/listen/report、/api/listen/total。含上报校验与平台写入。
   ========================================================================= */
'use strict';

const { sendJSON, readRequestBody, normalizeApiCode, normalizeApiMessage } = require('../utils');
const {
  getUserCookie,
  getQishuiCookie,
  listenSyncJournal,
  listenSyncJournalKey,
  rememberListenSyncSubmission,
} = require('../context');
const { scrobble, listen_data_total } = require('NeteaseCloudMusicApi');
const { getLoginInfo, requireLogin } = require('../handlers/netease-login-cache');
const { qishuiCookieHasLogin, handleQishuiReportRecentlyPlayed } = require('../../qishui-api');

function normalizeListenReportProvider(value) {
  value = String(value || '').trim().toLowerCase();
  if (value === 'qq' || value === 'kugou' || value === 'qishui' || value === 'spotify') return value;
  return value === 'netease' || value === 'cloud' || value === 'song' ? 'netease' : '';
}
function listenReportSongId(provider, song) {
  song = song && typeof song === 'object' ? song : {};
  if (provider === 'qq') return String(song.qqId || song.mid || song.mediaMid || song.id || '');
  if (provider === 'kugou') return String(song.hash || song.mixSongId || song.providerSongId || song.id || '');
  if (provider === 'qishui') return String(song.providerSongId || song.trackId || song.id || '');
  if (provider === 'spotify') return String(song.spotifyId || song.providerSongId || song.id || '').replace(/^spotify:track:/i, '');
  return String(song.id || song.providerSongId || '');
}
function validateListenReport(body) {
  body = body && typeof body === 'object' ? body : {};
  const song = body.song && typeof body.song === 'object' ? body.song : {};
  const provider = normalizeListenReportProvider(
    body.provider || song.provider || song.source || song.sourceKey || song.type || song.resolvedPlaybackProvider
  );
  const songId = listenReportSongId(provider, song);
  const sessionId = String(body.sessionId || '').trim().slice(0, 160);
  const listenMs = Math.max(0, Math.min(12 * 60 * 60 * 1000, Math.round(Number(body.listenMs) || 0)));
  const durationMs = Math.max(0, Math.min(12 * 60 * 60 * 1000, Math.round(Number(body.durationMs) || 0)));
  const cappedListenMs = durationMs > 0 ? Math.min(listenMs, durationMs + 2500) : listenMs;
  const requiredMs = durationMs > 0
    ? (durationMs <= 30000 ? durationMs * 0.8 : Math.min(30000, durationMs * 0.5))
    : 30000;
  const eligible = !!(
    provider &&
    songId &&
    sessionId.length >= 8 &&
    cappedListenMs >= Math.max(5000, requiredMs) &&
    song.type !== 'local' &&
    song.type !== 'podcast' &&
    song.source !== 'podcast' &&
    !song.trial
  );
  return {
    provider,
    song,
    songId,
    sessionId,
    listenMs: cappedListenMs,
    durationMs,
    requiredMs: Math.ceil(requiredMs),
    eligible,
    context: body.context && typeof body.context === 'object' ? body.context : {},
  };
}
async function handlePlatformListenReport(body) {
  const report = validateListenReport(body);
  const base = {
    provider: report.provider || 'unknown',
    songId: report.songId,
    sessionId: report.sessionId,
    listenMs: report.listenMs,
    durationMs: report.durationMs,
    eligible: report.eligible,
    localRecorded: true,
    platformSubmitted: false,
    historySynced: false,
    accountDurationSync: 'unsupported',
  };
  if (!report.eligible) {
    return Object.assign(base, {
      accepted: false,
      reason: 'LISTEN_REPORT_NOT_ELIGIBLE',
      requiredMs: report.requiredMs,
    });
  }

  const userCookie = getUserCookie();
  const qishuiCookie = getQishuiCookie();
  let credential = '';
  if (report.provider === 'netease') credential = userCookie;
  else if (report.provider === 'qishui') credential = qishuiCookie;
  const journalKey = listenSyncJournalKey(report.provider, credential, report.sessionId);
  const previous = listenSyncJournal.entries[journalKey];
  if (previous) {
    return Object.assign(base, previous, {
      accepted: true,
      duplicate: true,
      platformSubmitted: true,
    });
  }

  if (report.provider === 'netease') {
    const info = await getLoginInfo();
    if (!info.loggedIn || !userCookie) {
      return Object.assign(base, { accepted: true, reason: 'NETEASE_LOGIN_REQUIRED' });
    }
    const rawSourceId = report.context.playlistId || report.context.id || report.context.sourceId || 0;
    const sourceId = /^\d+$/.test(String(rawSourceId || '')) ? String(rawSourceId) : 0;
    const result = await scrobble({
      id: report.songId,
      sourceid: sourceId,
      time: Math.max(1, Math.floor(report.listenMs / 1000)),
      cookie: userCookie,
      timestamp: Date.now(),
    });
    const code = normalizeApiCode(result);
    if (code !== 200) {
      const err = new Error(normalizeApiMessage(result) || 'NETEASE_SCROBBLE_FAILED');
      err.code = 'NETEASE_SCROBBLE_FAILED';
      err.statusCode = code;
      throw err;
    }
    const submitted = Object.assign(base, {
      accepted: true,
      platformSubmitted: true,
      accountDurationSync: 'submitted_unverified',
      platformCode: code,
    });
    rememberListenSyncSubmission(journalKey, submitted);
    return submitted;
  }

  if (report.provider === 'qishui') {
    if (!qishuiCookieHasLogin(qishuiCookie)) {
      return Object.assign(base, { accepted: true, reason: 'QISHUI_LOGIN_REQUIRED' });
    }
    await handleQishuiReportRecentlyPlayed(report.songId, qishuiCookie);
    const submitted = Object.assign(base, {
      accepted: true,
      platformSubmitted: true,
      historySynced: true,
      accountDurationSync: 'unsupported',
      note: 'Qishui accepted a recent-play item, but its PC endpoint carries no listening duration.',
    });
    rememberListenSyncSubmission(journalKey, submitted);
    return submitted;
  }

  return Object.assign(base, {
    accepted: true,
    reason: 'PLATFORM_DURATION_WRITE_UNAVAILABLE',
  });
}

async function handle(req, res, url) {
  const pn = url.pathname;

  if (pn === '/api/listen/report') {
    try {
      if (req.method !== 'POST') {
        sendJSON(res, { accepted: false, error: 'METHOD_NOT_ALLOWED' }, 405);
        return true;
      }
      const body = await readRequestBody(req);
      sendJSON(res, await handlePlatformListenReport(body));
    } catch (err) {
      console.error('[ListenReport]', err);
      sendJSON(res, {
        accepted: false,
        platformSubmitted: false,
        error: err.code || err.message,
        message: err.message,
      }, Number(err.statusCode) === 401 ? 401 : 502);
    }
    return true;
  }

  if (pn === '/api/listen/total') {
    try {
      const provider = normalizeListenReportProvider(url.searchParams.get('provider') || 'netease');
      if (provider !== 'netease') {
        sendJSON(res, { provider, supported: false, accountDurationSync: 'unsupported' });
        return true;
      }
      const info = await requireLogin(res);
      if (!info) return true;
      const result = await listen_data_total({ cookie: getUserCookie(), timestamp: Date.now() });
      sendJSON(res, {
        provider: 'netease',
        supported: true,
        readOnly: true,
        body: result.body || result,
      });
    } catch (err) {
      console.error('[ListenTotal]', err);
      sendJSON(res, { provider: 'netease', supported: true, error: err.message }, 500);
    }
    return true;
  }

  return false;
}

module.exports = {
  handle,
  validateListenReport,
  handlePlatformListenReport,
  normalizeListenReportProvider,
  listenReportSongId,
};
