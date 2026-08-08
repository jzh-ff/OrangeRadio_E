/* =========================================================================
   OrangeSea · QQ 音乐路由（qq）
   -------------------------------------------------------------------------
   /api/qq/* 端点，转发到 qq-core / qq-playback / qq-liked-playlist 函数。
   ========================================================================= */
'use strict';

const { sendJSON, readRequestBody, parseCookieString } = require('../utils');
const { saveQQCookie } = require('../context');
const {
  getQQLoginInfo,
  normalizeQQCookieInput,
  qqCookieUin,
  qqCookieMusicKey,
} = require('../handlers/qq-core');
const {
  handleQQSongUrl,
  handleQQLyric,
  handleQQArtistDetail,
  handleQQAlbumDetail,
  handleQQSongComments,
} = require('../handlers/qq-playback');
const {
  handleQQUserPlaylists,
  handleQQPlaylistTracks,
} = require('../handlers/qq-user-playlists');

async function handle(req, res, url) {
  const pn = url.pathname;

  if (pn === '/api/qq/song/url') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('id') || '';
      const mediaMid = url.searchParams.get('mediaMid') || url.searchParams.get('media_mid') || '';
      const quality = url.searchParams.get('quality') || '';
      const playbackHints = {
        vipRequired: url.searchParams.get('vipRequired') || '',
        needVip: url.searchParams.get('needVip') || url.searchParams.get('need_vip') || '',
        onlyVipPlayable: url.searchParams.get('onlyVipPlayable') || url.searchParams.get('only_vip_playable') || '',
        privilege: url.searchParams.get('privilege') || url.searchParams.get('mediaPrivilege') || url.searchParams.get('media_privilege') || '',
        fee: url.searchParams.get('fee') || ''
      };
      const info = await handleQQSongUrl(mid, mediaMid, quality, playbackHints);
      sendJSON(res, info);
    } catch (err) {
      console.error('[QQSongUrl]', err);
      sendJSON(res, { provider: 'qq', url: '', playable: false, error: err.message }, 500);
    }
    return true;
  }

  if (pn === '/api/qq/lyric') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('songmid') || '';
      const id = url.searchParams.get('id') || url.searchParams.get('qqId') || '';
      if (!mid && !id) { sendJSON(res, { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' }, 400); return true; }
      const data = await handleQQLyric(mid, id);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQLyric]', err);
      sendJSON(res, { provider: 'qq', error: err.message, lyric: '' }, 500);
    }
    return true;
  }

  if (pn === '/api/qq/login/status') {
    try {
      const forceVip = /^(1|true|yes)$/i.test(String(url.searchParams.get('forceVip') || url.searchParams.get('force') || ''));
      const info = await getQQLoginInfo({ forceVip, forceCookie: forceVip });
      sendJSON(res, info);
    } catch (err) {
      console.error('[QQLoginStatus]', err);
      sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message }, 500);
    }
    return true;
  }

  if (pn === '/api/qq/login/cookie') {
    try {
      const body = await readRequestBody(req);
      const raw = body.cookie || body.data || body.text || '';
      const normalized = normalizeQQCookieInput(raw);
      const obj = parseCookieString(normalized);
      if (!qqCookieUin(obj) || !qqCookieMusicKey(obj)) {
        sendJSON(res, { provider: 'qq', loggedIn: false, error: 'INVALID_QQ_COOKIE', message: 'QQ cookie 缺少 uin 或有效登录票据' }, 400);
        return true;
      }
      saveQQCookie(normalized);
      const info = await getQQLoginInfo({ forceVip: true, forceCookie: true });
      sendJSON(res, { ...info, saved: true });
    } catch (err) {
      console.error('[QQLoginCookie]', err);
      sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message }, 500);
    }
    return true;
  }

  if (pn === '/api/qq/logout') {
    saveQQCookie('');
    sendJSON(res, { provider: 'qq', ok: true, loggedIn: false });
    return true;
  }

  if (pn === '/api/qq/user/playlists') {
    try {
      const data = await handleQQUserPlaylists();
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQUserPlaylists]', err);
      sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message, playlists: [] }, 500);
    }
    return true;
  }

  if (pn === '/api/qq/playlist/tracks') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('disstid') || '';
      const data = await handleQQPlaylistTracks(id, {
        limit: url.searchParams.get('limit') || '',
        offset: url.searchParams.get('offset') || '0',
      });
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQPlaylistTracks]', err);
      sendJSON(res, { provider: 'qq', error: err.message, tracks: [] }, 500);
    }
    return true;
  }

  if (pn === '/api/qq/artist/detail') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('singermid') || '';
      const limit = Math.max(10, Math.min(80, parseInt(url.searchParams.get('limit') || '36', 10) || 36));
      if (!mid) {
        sendJSON(res, { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] }, 400);
        return true;
      }
      const data = await handleQQArtistDetail(mid, limit);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQArtistDetail]', err);
      sendJSON(res, { provider: 'qq', error: err.message, artist: null, songs: [] }, 500);
    }
    return true;
  }

  if (pn === '/api/qq/album/detail') {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('albummid') || url.searchParams.get('albumMid') || '';
      const limit = Math.max(10, Math.min(120, parseInt(url.searchParams.get('limit') || '80', 10) || 80));
      if (!mid) {
        sendJSON(res, { provider: 'qq', error: 'MISSING_ALBUM_MID', album: null, songs: [] }, 400);
        return true;
      }
      sendJSON(res, await handleQQAlbumDetail(mid, limit));
    } catch (err) {
      console.error('[QQAlbumDetail]', err);
      sendJSON(res, { provider: 'qq', error: err.message, album: null, songs: [] }, 500);
    }
    return true;
  }

  if (pn === '/api/qq/song/comments') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('qqId') || '';
      const mid = url.searchParams.get('mid') || url.searchParams.get('songmid') || '';
      const limit = Math.max(6, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const data = await handleQQSongComments(id, mid, limit, offset);
      sendJSON(res, data);
    } catch (err) {
      console.error('[QQSongComments]', err);
      sendJSON(res, { provider: 'qq', error: err.message, comments: [] }, 500);
    }
    return true;
  }

  return false;
}

module.exports = { handle };
