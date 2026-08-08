/* =========================================================================
   OrangeSea · QQ 音乐“我的喜欢”歌单（qq-liked-playlist）
   -------------------------------------------------------------------------
   从原 server.js 拆出：QQ 喜欢歌单的识别、封面缓存、分页拉取与卡片构建。
   依赖 context（封面缓存 Map）/ qq 请求桥（qqMusicRequest）。
   ========================================================================= */
'use strict';

const {
  qqMusicRequest,
  mapQQPlaylistTrack,
  QQ_LIKED_PLAYLIST_ID,
  QQ_LIKED_DIRID,
  isQQLikedPlaylistId,
  isQQFavoritePlaylist,
  isQzoneBackgroundPlaylist,
} = require('./qq-core');
const { qqLikedPlaylistCoverByUser } = require('../context');

const QQ_LIKED_PLAYLIST_NAME = 'QQ 音乐·我的喜欢';
const QQ_LIKED_PLAYLIST_COVER = 'https://y.gtimg.cn/mediastyle/global/img/cover_like.png';
const QQ_LIKED_AUTH_MESSAGE = 'QQ 音乐“我的喜欢”需要完整 QQ 音乐授权。请重新打开官方 QQ 音乐登录窗口，等待进入播放器页后再关闭。';

function qqLikedPlaylistUserKey(info) {
  return String(info && (info.userId || info.uin) || '').trim();
}
function getCachedQQLikedPlaylistCover(info) {
  const key = qqLikedPlaylistUserKey(info);
  return key ? String(qqLikedPlaylistCoverByUser.get(key) || '') : '';
}
function rememberQQLikedPlaylistCover(info, cover) {
  const key = qqLikedPlaylistUserKey(info);
  cover = String(cover || '').trim();
  if (key && cover) qqLikedPlaylistCoverByUser.set(key, cover);
  else if (key) qqLikedPlaylistCoverByUser.delete(key);
  return cover;
}
function clearQQLikedPlaylistCoverCache() {
  qqLikedPlaylistCoverByUser.clear();
}

async function fetchQQLikedPlaylistPage(opts) {
  opts = opts || {};
  const limit = Math.max(1, Math.min(100, parseInt(opts.limit || '48', 10) || 48));
  const offset = Math.max(0, parseInt(opts.offset || '0', 10) || 0);
  const body = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    req_0: {
      module: 'music.srfDissInfo.DissInfo',
      method: 'CgiGetDiss',
      param: {
        disstid: 0,
        dirid: QQ_LIKED_DIRID,
        tag: 1,
        song_begin: offset,
        song_num: limit,
        userinfo: 1,
        orderlist: 1,
      },
    },
  }, { cookie: true, timeoutMs: 10000 });
  const block = body && body.req_0;
  const data = block && block.data || {};
  const code = Number(body && body.code) || Number(block && block.code) || Number(data.code) || Number(data.subcode) || 0;
  if (!block || code !== 0) {
    const err = new Error('QQ_LIKED_SYNC_FAILED_' + code);
    err.code = [1000, 10004, 104003, 301, -100008].includes(code)
      ? 'QQ_LIKED_REQUIRES_PLAYBACK_LOGIN'
      : 'QQ_LIKED_SYNC_FAILED';
    err.qqCode = code;
    throw err;
  }
  const rawTracks = Array.isArray(data.songlist) ? data.songlist : [];
  const tracks = rawTracks.map(mapQQPlaylistTrack).filter(song => song.name && (song.mid || song.id));
  const pageSpan = Math.max(Number(data.songlist_size) || 0, rawTracks.length);
  const upstreamTotal = Math.max(0, Number(data.total_song_num) || 0);
  const total = upstreamTotal || offset + pageSpan;
  const nextOffset = offset + pageSpan;
  return {
    tracks,
    total,
    offset,
    limit,
    pageSpan,
    nextOffset,
    hasMore: !!Number(data.hasmore) || nextOffset < total,
    dirinfo: data.dirinfo || {},
  };
}

function buildQQLikedPlaylistCard(info, likedPage, warning) {
  const tracks = likedPage && likedPage.tracks || [];
  const firstTrack = tracks[0] || null;
  const pageOffset = Math.max(0, Number(likedPage && likedPage.offset) || 0);
  if (likedPage && pageOffset === 0) rememberQQLikedPlaylistCover(info, firstTrack && firstTrack.cover);
  const stableCover = getCachedQQLikedPlaylistCover(info);
  const count = Number(likedPage && likedPage.total) || tracks.length || 0;
  return {
    provider: 'qq',
    source: 'qq',
    id: QQ_LIKED_PLAYLIST_ID,
    dirid: String(QQ_LIKED_DIRID),
    virtual: true,
    name: QQ_LIKED_PLAYLIST_NAME,
    cover: stableCover || (pageOffset === 0 && firstTrack && firstTrack.cover) || QQ_LIKED_PLAYLIST_COVER,
    trackCount: count,
    playCount: 0,
    creator: info && (info.nickname || info.userId) || 'QQ 音乐',
    subscribed: false,
    specialType: 5,
    requiresPlaybackKey: warning === 'QQ_LIKED_REQUIRES_PLAYBACK_LOGIN',
    warning: warning || '',
  };
}

async function getQQLikedPlaylistCard(info) {
  if (!info || !info.playbackKeyReady) {
    return buildQQLikedPlaylistCard(info, null, 'QQ_LIKED_REQUIRES_PLAYBACK_LOGIN');
  }
  try {
    const likedPage = await fetchQQLikedPlaylistPage({ limit: 1, offset: 0 });
    return buildQQLikedPlaylistCard(info, likedPage, '');
  } catch (err) {
    return buildQQLikedPlaylistCard(info, null, err.code || err.message || 'QQ_LIKED_UNAVAILABLE');
  }
}

async function handleQQLikedPlaylistTracks(info, opts) {
  const pageLimit = Math.max(0, Math.min(500, parseInt(opts && opts.limit || '0', 10) || 0));
  const pageOffset = Math.max(0, parseInt(opts && opts.offset || '0', 10) || 0);
  if (!info || !info.playbackKeyReady) {
    return {
      loggedIn: true,
      provider: 'qq',
      playlist: buildQQLikedPlaylistCard(info, null, 'QQ_LIKED_REQUIRES_PLAYBACK_LOGIN'),
      tracks: [],
      error: 'QQ_LIKED_REQUIRES_PLAYBACK_LOGIN',
      message: QQ_LIKED_AUTH_MESSAGE,
      requiresPlaybackKey: true,
    };
  }
  let likedPage = null;
  const coverWarmup = pageOffset > 0 && !getCachedQQLikedPlaylistCover(info)
    ? getQQLikedPlaylistCard(info)
    : null;
  try {
    likedPage = await fetchQQLikedPlaylistPage({ limit: pageLimit || 48, offset: pageOffset });
    if (coverWarmup) await coverWarmup;
  } catch (err) {
    const requiresPlaybackKey = err && err.code === 'QQ_LIKED_REQUIRES_PLAYBACK_LOGIN';
    return {
      loggedIn: true,
      provider: 'qq',
      playlist: buildQQLikedPlaylistCard(info, null, err.code || err.message || 'QQ_LIKED_UNAVAILABLE'),
      tracks: [],
      error: err.code || err.message || 'QQ_LIKED_UNAVAILABLE',
      message: requiresPlaybackKey ? QQ_LIKED_AUTH_MESSAGE : 'QQ 音乐“我的喜欢”同步失败，请稍后刷新重试。',
      requiresPlaybackKey,
    };
  }
  return {
    loggedIn: true,
    provider: 'qq',
    playlist: buildQQLikedPlaylistCard(info, likedPage, ''),
    tracks: likedPage.tracks,
    total: likedPage.total,
    offset: pageOffset,
    limit: likedPage.limit,
    nextOffset: likedPage.nextOffset,
    hasMore: likedPage.hasMore,
    partial: !!pageLimit,
  };
}

module.exports = {
  QQ_LIKED_PLAYLIST_NAME,
  QQ_LIKED_PLAYLIST_COVER,
  QQ_LIKED_AUTH_MESSAGE,
  qqLikedPlaylistUserKey,
  getCachedQQLikedPlaylistCover,
  rememberQQLikedPlaylistCover,
  clearQQLikedPlaylistCoverCache,
  fetchQQLikedPlaylistPage,
  buildQQLikedPlaylistCard,
  getQQLikedPlaylistCard,
  handleQQLikedPlaylistTracks,
};
