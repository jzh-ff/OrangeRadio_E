/* =========================================================================
   OrangeSea · QQ 用户歌单（qq-user-playlists）
   -------------------------------------------------------------------------
   从原 server.js 拆出：QQ 用户歌单聚合（创建的/收藏的/我的喜欢）与歌单曲目。
   ========================================================================= */
'use strict';

const { qqGetJSON } = require('./qq-core');
const {
  mapQQPlaylist,
  mapQQPlaylistTrack,
  getQQLoginInfo,
  isQQLikedPlaylistId,
  isQQFavoritePlaylist,
  isQzoneBackgroundPlaylist,
  fetchQQCreatedPlaylists,
  fetchQQCollectedPlaylists,
} = require('./qq-core');
const {
  getQQLikedPlaylistCard,
  buildQQLikedPlaylistCard,
  handleQQLikedPlaylistTracks,
} = require('./qq-liked-playlist');

async function handleQQUserPlaylists() {
  const info = await getQQLoginInfo();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', playlists: [] };
  const uin = info.userId;
  const createdReq = fetchQQCreatedPlaylists(uin);
  const collectReq = fetchQQCollectedPlaylists(uin);
  const likedReq = getQQLikedPlaylistCard(info);
  const [createdRaw, collectRaw, likedRaw] = await Promise.allSettled([createdReq, collectReq, likedReq]);
  const created = createdRaw.status === 'fulfilled' && Array.isArray(createdRaw.value)
    ? createdRaw.value.map(pl => mapQQPlaylist(pl, 'created')) : [];
  const collected = collectRaw.status === 'fulfilled' && Array.isArray(collectRaw.value)
    ? collectRaw.value.map(pl => mapQQPlaylist(pl, 'collect')) : [];
  const likedCard = likedRaw.status === 'fulfilled' ? likedRaw.value : buildQQLikedPlaylistCard(info, null, 'QQ_LIKED_UNAVAILABLE');
  const seen = new Set();
  const base = created.concat(collected).filter(pl => !isQQFavoritePlaylist(pl));
  base.unshift(likedCard);
  const playlists = base.filter(pl => {
    if (!pl.id || !pl.name || seen.has(pl.id)) return false;
    if (isQzoneBackgroundPlaylist(pl)) return false;
    seen.add(pl.id);
    return true;
  }).sort((a, b) => Number(isQQFavoritePlaylist(b)) - Number(isQQFavoritePlaylist(a)));
  return { loggedIn: true, provider: 'qq', userId: uin, playlists };
}

async function handleQQPlaylistTracks(id, opts) {
  opts = opts || {};
  const info = await getQQLoginInfo();
  if (!info.loggedIn || !info.userId) return { loggedIn: false, provider: 'qq', tracks: [] };
  const pid = String(id || '').trim();
  if (!pid) return { loggedIn: true, provider: 'qq', error: 'Missing QQ playlist id', tracks: [] };
  if (isQQLikedPlaylistId(pid)) return handleQQLikedPlaylistTracks(info, opts);
  const pageLimit = Math.max(0, Math.min(500, parseInt(opts.limit || '0', 10) || 0));
  const pageOffset = Math.max(0, parseInt(opts.offset || '0', 10) || 0);
  const result = await qqGetJSON('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg', {
    type: 1,
    utf8: 1,
    disstid: pid,
    song_begin: pageOffset,
    song_num: pageLimit || undefined,
    loginUin: info.userId,
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  }, { headers: { Referer: 'https://y.qq.com/n/yqq/playlist' } });
  const detail = result && result.cdlist && result.cdlist[0] ? result.cdlist[0] : {};
  let rawTracks = Array.isArray(detail.songlist) ? detail.songlist : [];
  const totalHint = Number(detail.total_song_num || detail.songnum || detail.song_cnt || detail.song_count || 0) || 0;
  if (pageLimit && rawTracks.length > pageLimit) {
    rawTracks = totalHint && rawTracks.length < totalHint
      ? rawTracks.slice(0, pageLimit)
      : rawTracks.slice(pageOffset, pageOffset + pageLimit);
  }
  const tracks = rawTracks.map(mapQQPlaylistTrack).filter(s => s.name && (s.mid || s.id));
  const total = totalHint || tracks.length;
  const playlist = {
    provider: 'qq',
    id: pid,
    name: detail.dissname || detail.diss_name || detail.name || '',
    cover: detail.logo || detail.diss_cover || '',
    trackCount: total,
  };
  return {
    loggedIn: true,
    provider: 'qq',
    playlist,
    tracks,
    offset: pageOffset,
    limit: pageLimit || tracks.length,
    nextOffset: pageOffset + tracks.length,
    hasMore: pageLimit ? (pageOffset + tracks.length < total || tracks.length >= pageLimit) : false,
    partial: !!pageLimit,
    total,
  };
}

module.exports = {
  handleQQUserPlaylists,
  handleQQPlaylistTracks,
};
