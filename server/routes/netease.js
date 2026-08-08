/* =========================================================================
   OrangeSea · 网易云核心路由（netease）
   -------------------------------------------------------------------------
   /api/album/detail、/api/album/subscribe(/check)、/api/playlist/subscribe、
   /api/song/url、/api/login/*、/api/logout、/api/user/playlists、
   /api/song/like(/check)、/api/playlist/create(/add-song)、/api/lyric、
   /api/song/comments(/like)、/api/artist/detail、/api/playlist/tracks。
   ========================================================================= */
'use strict';

const {
  album,
  album_sub,
  album_sublist,
  playlist_subscribe,
  login_qr_key,
  login_qr_create,
  login_qr_check,
  login_status,
  logout,
  song_like_check,
  likelist,
  like: like_song,
  playlist_create,
  playlist_tracks,
  playlist_track_add,
  comment,
  comment_music,
  comment_like,
  lyric,
  lyric_new,
  artist_detail,
  artist_songs,
  artist_top_song,
} = require('NeteaseCloudMusicApi');
const { sendJSON, readRequestBody, normalizeApiCode, normalizeApiMessage, parseCookieString } = require('../utils');
const { getUserCookie, saveCookie, normalizeCookieHeader } = require('../context');
const { mapSongRecord } = require('../handlers/netease-mappers');
const {
  getLoginInfo,
  getPlaybackLoginInfo,
  requireLogin,
  normalizeLoginInfo,
  enrichNeteaseLoginInfo,
} = require('../handlers/netease-login-cache');
const { handleSongUrl } = require('../handlers/netease-playback');
const {
  handleNeteaseAlbumDetail,
} = require('../handlers/netease-album');
const {
  mapNeteasePlaylistMeta,
  fetchAllNeteaseUserPlaylists,
  fetchNeteaseUserPlaylistsPage,
  fetchAllNeteasePlaylistTracks,
  fetchNeteasePlaylistTracksPage,
  invalidateNeteasePlaylistTrackIndex,
} = require('../handlers/netease-playlist');

/* ---------- 歌词合并（路由内嵌套辅助） ---------- */
function lyricNodeText(body, key) {
  return body && body[key] && typeof body[key].lyric === 'string' ? body[key].lyric : '';
}
function lyricBodyHasPrimary(body) {
  return !!(lyricNodeText(body, 'lrc') || lyricNodeText(body, 'yrc'));
}
function lyricBodyHasTranslation(body) {
  return !!(lyricNodeText(body, 'tlyric') || lyricNodeText(body, 'ytlrc'));
}
function mergeLyricBodies(primary, fallback) {
  const merged = Object.assign({}, fallback || {}, primary || {});
  ['lrc', 'tlyric', 'yrc', 'ytlrc', 'romalrc', 'yromalrc', 'klyric'].forEach((key) => {
    if (!lyricNodeText(merged, key) && fallback && fallback[key]) merged[key] = fallback[key];
  });
  return merged;
}

async function handle(req, res, url) {
  const pn = url.pathname;
  const userCookie = getUserCookie();

  if (pn === '/api/album/detail') {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('albumId') || '';
      const limit = Math.max(10, Math.min(120, parseInt(url.searchParams.get('limit') || '80', 10) || 80));
      if (!id) {
        sendJSON(res, { provider: 'netease', error: 'Missing album id', album: null, songs: [] }, 400);
        return true;
      }
      sendJSON(res, await handleNeteaseAlbumDetail(id, limit));
    } catch (err) {
      console.error('[AlbumDetail]', err);
      sendJSON(res, { provider: 'netease', error: err.message, album: null, songs: [] }, 500);
    }
    return true;
  }

  if (pn === '/api/album/subscribe') {
    try {
      const info = await requireLogin(res);
      if (!info) return true;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const id = body.id || body.albumId || url.searchParams.get('id') || '';
      const subscribed = String(body.subscribed != null ? body.subscribed : (url.searchParams.get('subscribed') || 'true')) !== 'false';
      if (!id) { sendJSON(res, { success: false, error: 'Missing album id' }, 400); return true; }
      const result = await album_sub({ id, t: subscribed ? 1 : 0, cookie: userCookie, timestamp: Date.now() });
      const code = normalizeApiCode(result);
      sendJSON(res, { provider: 'netease', id, subscribed, success: code === 200, code, body: result.body || result });
    } catch (err) {
      console.error('[AlbumSubscribe]', err);
      sendJSON(res, { provider: 'netease', success: false, error: err.message }, 500);
    }
    return true;
  }

  if (pn === '/api/album/subscribe/check') {
    try {
      const info = await requireLogin(res);
      if (!info) return true;
      const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
        .split(',').map(value => value.trim()).filter(Boolean);
      if (!ids.length) { sendJSON(res, { provider: 'netease', subscribed: {} }); return true; }
      const wanted = new Set(ids);
      const found = new Set();
      let offset = 0;
      for (let page = 0; page < 8 && found.size < wanted.size; page++) {
        const result = await album_sublist({ limit: 50, offset, cookie: userCookie, timestamp: Date.now() });
        const body = result.body || result || {};
        const rows = Array.isArray(body.data) ? body.data : (body.albums || []);
        rows.forEach(item => {
          const id = String(item && item.id || '');
          if (wanted.has(id)) found.add(id);
        });
        if (!body.hasMore || rows.length < 50) break;
        offset += rows.length;
      }
      const subscribed = {};
      ids.forEach(id => { subscribed[id] = found.has(id); });
      sendJSON(res, { provider: 'netease', ids, subscribed });
    } catch (err) {
      console.error('[AlbumSubscribeCheck]', err);
      sendJSON(res, { provider: 'netease', subscribed: {}, error: err.message }, 500);
    }
    return true;
  }

  if (pn === '/api/playlist/subscribe') {
    try {
      const info = await requireLogin(res);
      if (!info) return true;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const id = body.id || body.playlistId || url.searchParams.get('id') || '';
      const subscribed = String(body.subscribed != null ? body.subscribed : (url.searchParams.get('subscribed') || 'true')) !== 'false';
      if (!id) { sendJSON(res, { success: false, error: 'Missing playlist id' }, 400); return true; }
      const result = await playlist_subscribe({ id, t: subscribed ? 1 : 0, cookie: userCookie, timestamp: Date.now() });
      const code = normalizeApiCode(result);
      sendJSON(res, { provider: 'netease', id, subscribed, success: code === 200, code, body: result.body || result });
    } catch (err) {
      console.error('[PlaylistSubscribe]', err);
      sendJSON(res, { provider: 'netease', success: false, error: err.message }, 500);
    }
    return true;
  }

  if (pn === '/api/song/url') {
    try {
      const sid = url.searchParams.get('id');
      const quality = url.searchParams.get('quality') || '';
      const matchHints = {
        name: url.searchParams.get('name') || '',
        artist: url.searchParams.get('artist') || '',
        artistId: url.searchParams.get('artistId') || '',
        artistIds: url.searchParams.get('artistIds') || '',
        artistNames: url.searchParams.get('artistNames') || '',
        album: url.searchParams.get('album') || '',
        duration: url.searchParams.get('duration') || '',
        excludeIds: url.searchParams.get('excludeIds') || '',
        skipDirect: url.searchParams.get('skipDirect') === '1',
      };
      const loginInfo = await getPlaybackLoginInfo();
      const info = await handleSongUrl(sid, loginInfo, quality, matchHints);
      sendJSON(res, {
        ...info,
        loggedIn: loginInfo.loggedIn,
        vipType: loginInfo.vipType || 0,
        vipLevel: loginInfo.vipLevel || 'none',
        isVip: !!loginInfo.isVip,
        isSvip: !!loginInfo.isSvip,
        vipLabel: loginInfo.vipLabel || '无VIP',
      });
    } catch (err) { console.error('[SongUrl]', err); sendJSON(res, { error: err.message }, 500); }
    return true;
  }

  if (pn === '/api/login/cookie') {
    try {
      const body = await readRequestBody(req);
      const raw = body.cookie || body.data || body.text || '';
      const normalized = normalizeCookieHeader(raw);
      const obj = parseCookieString(normalized);
      if (!obj.MUSIC_U) {
        sendJSON(res, { loggedIn: false, error: 'INVALID_NETEASE_COOKIE', message: '网易云 cookie 缺少 MUSIC_U' }, 400);
        return true;
      }
      saveCookie(normalized);
      let info = await getLoginInfo();
      if (!info.loggedIn && getUserCookie()) {
        info = {
          loggedIn: true,
          pendingProfile: true,
          nickname: '网易云用户',
          avatar: '',
          vipType: 0,
          vipLevel: 'none',
          isVip: false,
          isSvip: false,
          vipLabel: '无VIP',
        };
      }
      sendJSON(res, { ...info, saved: true, hasCookie: !!getUserCookie() });
    } catch (err) {
      console.error('[LoginCookie]', err);
      sendJSON(res, { loggedIn: false, error: err.message }, 500);
    }
    return true;
  }

  if (pn === '/api/login/qr/key') {
    try {
      const r = await login_qr_key({ timestamp: Date.now() });
      const key = r.body && r.body.data && r.body.data.unikey;
      sendJSON(res, { key });
    } catch (err) { sendJSON(res, { error: err.message }, 500); }
    return true;
  }

  // ---------- 登录: QR 二维码图片 ----------
  if (pn === '/api/login/qr/create') {
    try {
      const key = url.searchParams.get('key');
      const r = await login_qr_create({ key, qrimg: true, timestamp: Date.now() });
      const d = r.body && r.body.data;
      sendJSON(res, { img: d && d.qrimg, url: d && d.qrurl });
    } catch (err) { sendJSON(res, { error: err.message }, 500); }
    return true;
  }

  // ---------- 登录: 轮询扫码状态 ----------
  if (pn === '/api/login/qr/check') {
    try {
      const key = url.searchParams.get('key');
      let r = await login_qr_check({ key, noCookie: true, timestamp: Date.now() });
      let body = r.body || {};
      let code = Number(body.code || r.code);
      let msg  = body.message || r.message || '';
      let cookie = readCookieFromResponse(r);
      if (code === 803 && !cookie) {
        try {
          const retry = await login_qr_check({ key, timestamp: Date.now() });
          const retryCookie = readCookieFromResponse(retry);
          if (retryCookie) {
            r = retry;
            body = retry.body || body;
            code = Number(body.code || retry.code || code);
            msg = body.message || retry.message || msg;
            cookie = retryCookie;
          }
        } catch (retryErr) {
          console.warn('[Login] qr cookie retry failed:', retryErr.message);
        }
      }
      // 803 = 授权成功, 802 = 已扫待确认, 801 = 等待扫码, 800 = 二维码过期
      if (code === 803) {
        if (cookie) saveCookie(cookie);
        let info = await getLoginInfo();
        if (!info.loggedIn) {
          const profile = body.profile || (body.data && body.data.profile) || {};
          const account = body.account || (body.data && body.data.account);
          const extra = body.data || body;
          info = normalizeLoginInfo(profile, account, extra);
          if (info.loggedIn) info = await enrichNeteaseLoginInfo(info, profile, account, extra);
        }
        if (!info.loggedIn && cookie) {
          info = {
            loggedIn: true,
            pendingProfile: true,
            nickname: (body.nickname || (body.profile && body.profile.nickname) || '网易云用户'),
            avatar: body.avatarUrl || (body.profile && body.profile.avatarUrl) || '',
            vipType: 0,
            vipLevel: 'none',
            isVip: false,
            isSvip: false,
            vipLabel: '无VIP',
          };
        }
        sendJSON(res, { code, message: msg, ...info, hasCookie: !!cookie });
        return true;
      }
      sendJSON(res, { code, message: msg, nickname: body.nickname, avatar: body.avatarUrl });
    } catch (err) { sendJSON(res, { error: err.message }, 500); }
    return true;
  }

  // ---------- 登录态查询 ----------
  if (pn === '/api/login/status') {
    const info = await getLoginInfo();
    sendJSON(res, info);
    return true;
  }

  // ---------- 登出 ----------
  if (pn === '/api/logout') {
    try { await logout({ cookie: userCookie }); } catch (e) {}
    saveCookie('');
    sendJSON(res, { ok: true });
    return true;
  }

  // ---------- 用户歌单 ----------
  if (pn === '/api/user/playlists') {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn || !info.userId) { sendJSON(res, { loggedIn: false, playlists: [] }); return true; }
      const requestedLimit = Math.max(0, parseInt(url.searchParams.get('limit') || '0', 10) || 0);
      const requestedOffset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      if (requestedLimit || requestedOffset || url.searchParams.has('paged')) {
        const pageData = await fetchNeteaseUserPlaylistsPage(info.userId, requestedLimit || 48, requestedOffset);
        const pageList = pageData.playlists.map(pl => mapNeteasePlaylistMeta(pl, pl && pl.id));
        sendJSON(res, {
          loggedIn: true,
          userId: info.userId,
          playlists: pageList,
          total: pageData.total,
          offset: pageData.offset,
          limit: pageData.limit,
          nextOffset: pageData.nextOffset,
          hasMore: pageData.hasMore,
          partial: true,
        });
        return true;
      }
      const rawPlaylists = await fetchAllNeteaseUserPlaylists(info.userId, requestedLimit);
      const list = rawPlaylists.map(pl => mapNeteasePlaylistMeta(pl, pl && pl.id));
      sendJSON(res, { loggedIn: true, userId: info.userId, playlists: list });
    } catch (err) {
      console.error('[UserPlaylists]', err);
      sendJSON(res, { error: err.message, loggedIn: false, playlists: [] }, 500);
    }
    return true;
  }

  // ---------- 红心状态 ----------
  if (pn === '/api/song/like/check') {
    try {
      const info = await requireLogin(res);
      if (!info) return true;
      const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (!ids.length) { sendJSON(res, { error: 'Missing song id', liked: {}, ids: [] }, 400); return true; }
      let likedIds = [];
      try {
        if (typeof song_like_check === 'function') {
          const checked = await song_like_check({ ids: JSON.stringify(ids.map(Number).filter(Boolean)), cookie: userCookie, timestamp: Date.now() });
          const data = (checked.body && (checked.body.data || checked.body.ids)) || checked.body || {};
          if (Array.isArray(data)) likedIds = data.map(String);
          else if (data && typeof data === 'object') {
            ids.forEach(id => {
              if (data[id] || data[String(id)] || data[Number(id)]) likedIds.push(String(id));
            });
          }
        }
      } catch (e) {
        console.warn('[LikeCheck] direct check failed:', e.message);
      }
      if (!likedIds.length) {
        const r = await likelist({ uid: info.userId, cookie: userCookie, timestamp: Date.now() });
        likedIds = ((r.body && r.body.ids) || []).map(String);
      }
      const set = new Set(likedIds);
      const liked = {};
      ids.forEach(id => { liked[id] = set.has(String(id)); });
      sendJSON(res, { loggedIn: true, ids, liked });
    } catch (err) {
      console.error('[LikeCheck]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return true;
  }

  // ---------- 红心/取消红心 ----------
  if (pn === '/api/song/like') {
    try {
      const info = await requireLogin(res);
      if (!info) return true;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const id = body.id || url.searchParams.get('id');
      const nextLike = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
      if (!id) { sendJSON(res, { error: 'Missing song id' }, 400); return true; }
      const r = await like_song({ id, like: String(nextLike), cookie: userCookie, timestamp: Date.now() });
      const code = (r.body && r.body.code) || r.code || 200;
      sendJSON(res, { loggedIn: true, id, liked: nextLike, code, body: r.body || r });
    } catch (err) {
      console.error('[Like]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return true;
  }

  // ---------- 创建歌单 ----------
  if (pn === '/api/playlist/create') {
    try {
      const info = await requireLogin(res);
      if (!info) return true;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const name = String(body.name || url.searchParams.get('name') || '').trim();
      const privacy = String(body.privacy || url.searchParams.get('privacy') || '0');
      if (!name) { sendJSON(res, { error: 'Missing playlist name' }, 400); return true; }
      const r = await playlist_create({ name, privacy, cookie: userCookie, timestamp: Date.now() });
      const created = (r.body && (r.body.playlist || r.body.data)) || {};
      sendJSON(res, { loggedIn: true, playlist: created, body: r.body || r });
    } catch (err) {
      console.error('[PlaylistCreate]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return true;
  }

  // ---------- 收藏歌曲到歌单 ----------
  if (pn === '/api/playlist/add-song') {
    try {
      const info = await requireLogin(res);
      if (!info) return true;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const pid = body.pid || url.searchParams.get('pid');
      const id = body.id || body.ids || url.searchParams.get('id') || url.searchParams.get('ids');
      if (!pid || !id) { sendJSON(res, { error: 'Missing playlist id or song id' }, 400); return true; }
      const attempts = [];
      let finalBody = null;
      let finalCode = 0;
      let finalMessage = '';
      let success = false;

      const primary = await playlist_tracks({ op: 'add', pid, tracks: String(id), cookie: userCookie, timestamp: Date.now() });
      finalBody = primary.body || primary;
      finalCode = normalizeApiCode(primary);
      finalMessage = normalizeApiMessage(primary);
      success = finalCode === 200 && !(finalBody && finalBody.error);
      attempts.push({ api: 'playlist_tracks', code: finalCode, message: finalMessage, body: finalBody });

      if (!success && typeof playlist_track_add === 'function') {
        try {
          const fallback = await playlist_track_add({ pid, ids: String(id), cookie: userCookie, timestamp: Date.now() });
          finalBody = fallback.body || fallback;
          finalCode = normalizeApiCode(fallback);
          finalMessage = normalizeApiMessage(fallback);
          success = finalCode === 200 && !(finalBody && finalBody.error);
          attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: finalBody });
        } catch (fallbackErr) {
          const errBody = fallbackErr.body || fallbackErr.response || {};
          finalBody = errBody;
          finalCode = normalizeApiCode(errBody);
          finalMessage = normalizeApiMessage(errBody) || fallbackErr.message || '';
          attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: errBody });
        }
      }

      if (!success) {
        sendJSON(res, { loggedIn: true, pid, id, success: false, code: finalCode, error: finalMessage || 'PLAYLIST_ADD_FAILED', attempts }, finalCode === 401 ? 401 : 409);
        return true;
      }
      invalidateNeteasePlaylistTrackIndex(pid);
      sendJSON(res, { loggedIn: true, pid, id, success: true, code: finalCode, body: finalBody, attempts });
    } catch (err) {
      console.error('[PlaylistAddSong]', err);
      sendJSON(res, { error: err.message }, 500);
    }
    return true;
  }

  // ---------- 歌词 ----------
  if (pn === '/api/lyric') {
    try {
      const id = url.searchParams.get('id');
      if (!id) { sendJSON(res, { error: 'Missing song id', lyric: '' }, 400); return true; }
      let body = {};
      let source = 'lyric';
      try {
        if (typeof lyric_new === 'function') {
          const nr = await lyric_new({ id, cookie: userCookie, timestamp: Date.now() });
          body = nr.body || {};
          source = 'lyric_new';
        }
      } catch (errNew) {
        console.warn('[LyricNew]', errNew.message);
      }
      if (!lyricBodyHasPrimary(body) || !lyricBodyHasTranslation(body)) {
        const r = await lyric({ id, cookie: userCookie, timestamp: Date.now() });
        body = mergeLyricBodies(body, r.body || {});
        source = source === 'lyric_new' ? 'lyric_new+lyric' : 'lyric';
      }
      sendJSON(res, {
        lyric: (body.lrc && body.lrc.lyric) || '',
        tlyric: (body.tlyric && body.tlyric.lyric) || '',
        yrc: (body.yrc && body.yrc.lyric) || '',
        ytlrc: (body.ytlrc && body.ytlrc.lyric) || '',
        romalrc: (body.romalrc && body.romalrc.lyric) || '',
        yromalrc: (body.yromalrc && body.yromalrc.lyric) || '',
        source,
      });
    } catch (err) {
      console.error('[Lyric]', err);
      sendJSON(res, { error: err.message, lyric: '' }, 500);
    }
    return true;
  }

  // ---------- 歌曲评论 ----------
  if (pn === '/api/song/comments') {
    try {
      const requestBody = req.method === 'POST' ? await readRequestBody(req) : {};
      const id = requestBody.id || url.searchParams.get('id');
      if (req.method === 'POST') {
        const info = await requireLogin(res);
        if (!info) return true;
        const content = String(requestBody.content || requestBody.text || '').trim();
        if (!id || !content) { sendJSON(res, { created: false, error: 'Missing song id or comment content' }, 400); return true; }
        const result = await comment({
          t: requestBody.replyTo ? 2 : 1,
          type: 0,
          id,
          commentId: requestBody.replyTo || '',
          content,
          cookie: userCookie,
          timestamp: Date.now(),
        });
        const code = normalizeApiCode(result);
        sendJSON(res, { provider: 'netease', id, created: code === 200, success: code === 200, code, body: result.body || result });
        return true;
      }
      const limit = Math.max(6, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      if (!id) { sendJSON(res, { error: 'Missing song id', comments: [] }, 400); return true; }
      const r = await comment_music({ id, limit, offset, cookie: userCookie, timestamp: Date.now() });
      const body = r.body || r || {};
      const raw = body.hotComments && offset === 0 ? body.hotComments : (body.comments || []);
      const comments = (raw || []).map(c => ({
        id: c.commentId,
        content: c.content || '',
        likedCount: c.likedCount || 0,
        time: c.time || 0,
        user: c.user ? { id: c.user.userId, nickname: c.user.nickname || '', avatar: c.user.avatarUrl || '' } : null,
      })).filter(c => c.content);
      sendJSON(res, { id, total: body.total || 0, comments, hot: !!(body.hotComments && offset === 0), body });
    } catch (err) {
      console.error('[SongComments]', err);
      sendJSON(res, { error: err.message, comments: [] }, 500);
    }
    return true;
  }

  if (pn === '/api/song/comments/like') {
    try {
      const info = await requireLogin(res);
      if (!info) return true;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const id = body.id || url.searchParams.get('id') || '';
      const cid = body.commentId || body.cid || url.searchParams.get('commentId') || '';
      const liked = String(body.liked != null ? body.liked : (url.searchParams.get('liked') || 'true')) !== 'false';
      if (!id || !cid) { sendJSON(res, { success: false, error: 'Missing song id or comment id' }, 400); return true; }
      const result = await comment_like({ type: 0, id, cid, t: liked ? 1 : 0, cookie: userCookie, timestamp: Date.now() });
      const code = normalizeApiCode(result);
      sendJSON(res, { provider: 'netease', id, commentId: cid, liked, success: code === 200, code, body: result.body || result });
    } catch (err) {
      console.error('[SongCommentLike]', err);
      sendJSON(res, { provider: 'netease', success: false, error: err.message }, 500);
    }
    return true;
  }

  // ---------- 歌手主页 / 热门歌曲 ----------
  if (pn === '/api/artist/detail') {
    try {
      const id = url.searchParams.get('id');
      const limit = Math.max(10, Math.min(80, parseInt(url.searchParams.get('limit') || '30', 10) || 30));
      if (!id) { sendJSON(res, { error: 'Missing artist id', songs: [] }, 400); return true; }
      let detailBody = {};
      try {
        const detail = await artist_detail({ id, cookie: userCookie, timestamp: Date.now() });
        detailBody = detail.body || detail || {};
      } catch (e) {
        console.warn('[ArtistDetail] detail failed:', e.message);
      }
      let rawSongs = [];
      try {
        const list = await artist_songs({ id, order: 'hot', limit, offset: 0, cookie: userCookie, timestamp: Date.now() });
        const b = list.body || list || {};
        rawSongs = (b.songs || (b.data && b.data.songs) || []);
      } catch (e) {
        console.warn('[ArtistSongs] hot failed:', e.message);
      }
      if (!rawSongs.length) {
        const top = await artist_top_song({ id, cookie: userCookie, timestamp: Date.now() });
        const b = top.body || top || {};
        rawSongs = b.songs || [];
      }
      const artist = detailBody.artist || (detailBody.data && (detailBody.data.artist || detailBody.data)) || {};
      const songs = rawSongs.map(mapSongRecord).filter(s => s.id).slice(0, limit);
      sendJSON(res, {
        id,
        artist: {
          id: artist.id || id,
          name: artist.name || artist.artistName || '',
          avatar: artist.avatar || artist.cover || artist.picUrl || artist.img1v1Url || '',
          brief: artist.briefDesc || artist.description || artist.desc || '',
          musicSize: artist.musicSize || artist.songSize || 0,
          albumSize: artist.albumSize || 0,
        },
        songs,
        body: detailBody,
      });
    } catch (err) {
      console.error('[ArtistDetail]', err);
      sendJSON(res, { error: err.message, songs: [] }, 500);
    }
    return true;
  }

  // ---------- 歌单曲目详情 ----------
  if (pn === '/api/playlist/tracks') {
    try {
      const id = url.searchParams.get('id');
      if (!id) { sendJSON(res, { error: 'Missing playlist id', tracks: [] }, 400); return true; }

      const pageLimit = parseInt(url.searchParams.get('limit') || '0', 10) || 0;
      const pageOffset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
      if (pageLimit || pageOffset) {
        const pageData = await fetchNeteasePlaylistTracksPage(id, pageLimit || 48, pageOffset);
        const pageTracks = (pageData.rawTracks || []).map(mapSongRecord).filter(t => t.id);
        sendJSON(res, {
          playlist: pageData.playlistMeta || { id, name: '', cover: '', trackCount: 0 },
          tracks: pageTracks,
          offset: pageData.offset,
          limit: pageData.limit,
          nextOffset: pageData.nextOffset,
          hasMore: pageData.hasMore,
          total: pageData.total || Number(pageData.playlistMeta && pageData.playlistMeta.trackCount) || 0,
          partial: true,
        });
        return true;
      }

      const syncedData = await fetchAllNeteasePlaylistTracks(id);
      const syncedPlaylistMeta = syncedData.playlistMeta || { id, name: '', cover: '', trackCount: 0 };
      const syncedRawTracks = syncedData.rawTracks || [];
      const syncedTracks = syncedRawTracks.map(mapSongRecord).filter(t => t.id);
      if (!syncedPlaylistMeta.trackCount) syncedPlaylistMeta.trackCount = syncedTracks.length;
      sendJSON(res, { playlist: syncedPlaylistMeta, tracks: syncedTracks });
      return true;

    } catch (err) {
      console.error('[PlaylistTracks]', err);
      sendJSON(res, { error: err.message, tracks: [] }, 500);
    }
    return true;
  }

  return false;
}

/* ---------- QR 登录响应 cookie 读取（netease-login-cache 同源实现） ---------- */
function readCookieFromResponse(resp) {
  const { normalizeCookieHeader: norm } = require('../context');
  const candidates = [
    resp && resp.cookie,
    resp && resp.body && resp.body.cookie,
    resp && resp.body && resp.body.data && resp.body.data.cookie,
    resp && resp.body && resp.body.data && resp.body.data.cookies,
  ];
  for (const candidate of candidates) {
    const cookie = norm(candidate);
    if (cookie) return cookie;
  }
  return '';
}

module.exports = { handle };
