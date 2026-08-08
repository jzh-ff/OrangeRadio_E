/* =========================================================================
   OrangeSea · 酷狗音乐路由（kugou）
   -------------------------------------------------------------------------
   /api/kugou/* 端点，转发到 kugou-api 的 handle* 函数。
   ========================================================================= */
'use strict';

const { sendJSON, readRequestBody, parseCookieString } = require('../utils');
const { getKugouCookie, saveKugouCookie } = require('../context');
const {
  handleKugouSongUrl,
  handleKugouLyric,
  getKugouLoginInfo,
  normalizeKugouCookieInput,
  kugouCookieHasPlayback,
  extractKugouAuth,
  handleKugouUserPlaylists,
  handleKugouPlaylistTracks,
  handleKugouLikeCheck,
  handleKugouLikeToggle,
  handleKugouPlaylistAddSong,
} = require('../../kugou-api');

async function handle(req, res, url) {
  const pn = url.pathname;
  const kugouCookie = getKugouCookie();

  if (pn === '/api/kugou/song/url') {
    try {
      const info = await handleKugouSongUrl({
        hash: url.searchParams.get('hash') || url.searchParams.get('id') || '',
        albumId: url.searchParams.get('albumId') || url.searchParams.get('album_id') || '',
        albumAudioId: url.searchParams.get('albumAudioId') || url.searchParams.get('album_audio_id') || url.searchParams.get('mixSongId') || '',
        mixSongId: url.searchParams.get('mixSongId') || url.searchParams.get('albumAudioId') || url.searchParams.get('album_audio_id') || '',
        hqHash: url.searchParams.get('hqHash') || url.searchParams.get('hq_hash') || '',
        sqHash: url.searchParams.get('sqHash') || url.searchParams.get('sq_hash') || '',
        resHash: url.searchParams.get('resHash') || url.searchParams.get('res_hash') || '',
        quality: url.searchParams.get('quality') || '',
        vipRequired: url.searchParams.get('vipRequired') || '',
        needVip: url.searchParams.get('needVip') || url.searchParams.get('need_vip') || '',
        onlyVipPlayable: url.searchParams.get('onlyVipPlayable') || url.searchParams.get('only_vip_playable') || '',
        privilege: url.searchParams.get('privilege') || url.searchParams.get('mediaPrivilege') || url.searchParams.get('media_privilege') || '',
        fee: url.searchParams.get('fee') || '',
      }, kugouCookie);
      sendJSON(res, info);
    } catch (err) {
      console.error('[KugouSongUrl]', err);
      sendJSON(res, { provider: 'kugou', url: '', playable: false, error: err.message }, 500);
    }
    return true;
  }

  if (pn === '/api/kugou/lyric') {
    try {
      const hash = url.searchParams.get('hash') || url.searchParams.get('id') || '';
      const albumAudioId = url.searchParams.get('albumAudioId') || url.searchParams.get('album_audio_id') || '';
      const duration = url.searchParams.get('duration') || '';
      if (!hash) { sendJSON(res, { provider: 'kugou', error: 'Missing Kugou hash', lyric: '' }, 400); return true; }
      const data = await handleKugouLyric(hash, albumAudioId, duration);
      sendJSON(res, data);
    } catch (err) {
      console.error('[KugouLyric]', err);
      sendJSON(res, { provider: 'kugou', error: err.message, lyric: '' }, 500);
    }
    return true;
  }

  if (pn === '/api/kugou/login/status') {
    try {
      sendJSON(res, await getKugouLoginInfo(kugouCookie));
    } catch (err) {
      console.error('[KugouLoginStatus]', err);
      sendJSON(res, { provider: 'kugou', loggedIn: false, error: err.message }, 500);
    }
    return true;
  }

  if (pn === '/api/kugou/login/cookie') {
    try {
      const body = await readRequestBody(req);
      const raw = body.cookie || body.data || body.text || '';
      const normalized = normalizeKugouCookieInput(raw);
      const auth = extractKugouAuth(normalized);
      if (!auth.loggedIn && !parseCookieString(normalized).kg_mid) {
        sendJSON(res, { provider: 'kugou', loggedIn: false, error: 'INVALID_KUGOU_COOKIE', message: '酷狗 cookie 无效或缺少登录标识' }, 400);
        return true;
      }
      saveKugouCookie(normalized);
      const info = await getKugouLoginInfo(getKugouCookie());
      sendJSON(res, { ...info, saved: true, partial: auth.loggedIn && !auth.playbackReady });
    } catch (err) {
      console.error('[KugouLoginCookie]', err);
      sendJSON(res, { provider: 'kugou', loggedIn: false, error: err.message }, 500);
    }
    return true;
  }

  if (pn === '/api/kugou/logout') {
    saveKugouCookie('');
    sendJSON(res, { provider: 'kugou', loggedIn: false, ok: true });
    return true;
  }

  if (pn === '/api/kugou/user/playlists') {
    try {
      sendJSON(res, await handleKugouUserPlaylists(kugouCookie));
    } catch (err) {
      console.error('[KugouUserPlaylists]', err);
      sendJSON(res, { provider: 'kugou', loggedIn: false, error: err.message, playlists: [] }, 500);
    }
    return true;
  }

  if (pn === '/api/kugou/playlist/tracks') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('global_collection_id') || '';
      const paged = url.searchParams.has('limit') || url.searchParams.has('offset');
      const limit = Math.max(10, Math.min(50, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      sendJSON(res, await handleKugouPlaylistTracks(id, kugouCookie, paged ? { limit, offset, paged: true } : {}));
    } catch (err) {
      console.error('[KugouPlaylistTracks]', err);
      sendJSON(res, { provider: 'kugou', error: err.message, tracks: [] }, 500);
    }
    return true;
  }

  if (pn === '/api/kugou/song/like/check') {
    try {
      if (!kugouCookieHasPlayback(kugouCookie)) {
        sendJSON(res, { provider: 'kugou', loggedIn: false, liked: {}, error: 'KUGOU_AUTH_REQUIRED' });
        return true;
      }
      const hashes = url.searchParams.get('hashes') || url.searchParams.get('hash') || '';
      sendJSON(res, await handleKugouLikeCheck({ hashes }, kugouCookie));
    } catch (err) {
      console.error('[KugouLikeCheck]', err);
      sendJSON(res, { provider: 'kugou', liked: {}, error: err.message }, 500);
    }
    return true;
  }

  if (pn === '/api/kugou/song/like') {
    try {
      if (!kugouCookieHasPlayback(kugouCookie)) {
        sendJSON(res, { provider: 'kugou', success: false, error: 'KUGOU_AUTH_REQUIRED' }, 401);
        return true;
      }
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const song = body.song || {};
      const like = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
      sendJSON(res, await handleKugouLikeToggle(song, like, kugouCookie));
    } catch (err) {
      console.error('[KugouLike]', err);
      sendJSON(res, { provider: 'kugou', success: false, error: err.message }, 500);
    }
    return true;
  }

  if (pn === '/api/kugou/playlist/add-song') {
    try {
      if (!kugouCookieHasPlayback(kugouCookie)) {
        sendJSON(res, { provider: 'kugou', success: false, error: 'KUGOU_AUTH_REQUIRED' }, 401);
        return true;
      }
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const pid = body.pid || url.searchParams.get('pid') || '';
      const song = body.song || body;
      if (!pid) { sendJSON(res, { provider: 'kugou', success: false, error: 'Missing playlist id' }, 400); return true; }
      sendJSON(res, await handleKugouPlaylistAddSong(pid, song, kugouCookie));
    } catch (err) {
      console.error('[KugouPlaylistAddSong]', err);
      sendJSON(res, { provider: 'kugou', success: false, error: err.message }, 500);
    }
    return true;
  }

  return false;
}

module.exports = { handle };
