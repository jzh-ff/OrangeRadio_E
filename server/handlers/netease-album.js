/* =========================================================================
   OrangeSea · 网易云专辑详情（netease-album）
   -------------------------------------------------------------------------
   从原 server.js 拆出：handleNeteaseAlbumDetail。依赖 mappers / context /
   NeteaseCloudMusicApi。
   ========================================================================= */
'use strict';

const { album } = require('NeteaseCloudMusicApi');
const { getUserCookie } = require('../context');
const { mapArtists, mapSongRecord } = require('./netease-mappers');

async function handleNeteaseAlbumDetail(id, limit) {
  const userCookie = getUserCookie();
  const albumId = String(id || '').trim();
  const num = Math.max(10, Math.min(120, parseInt(limit || '80', 10) || 80));
  if (!albumId) return { provider: 'netease', error: 'MISSING_ALBUM_ID', album: null, songs: [] };
  const result = await album({ id: albumId, cookie: userCookie, timestamp: Date.now() });
  const body = result.body || result || {};
  const info = body.album || body.data && (body.data.album || body.data) || {};
  const rawSongs = Array.isArray(body.songs) ? body.songs : (Array.isArray(info.songs) ? info.songs : []);
  const artists = mapArtists(info.artists || info.ar || []);
  const songs = rawSongs
    .slice(0, num)
    .map(song => mapSongRecord(song))
    .filter(song => song && song.id);
  return {
    provider: 'netease',
    album: {
      provider: 'netease',
      id: info.id || albumId,
      albumId: info.id || albumId,
      name: info.name || '',
      artist: artists.map(a => a.name).join(' / ') || info.artist && info.artist.name || (songs[0] && songs[0].artist) || '',
      artists,
      cover: info.picUrl || info.coverUrl || '',
      releaseDate: info.publishTime || info.publishTime === 0 ? info.publishTime : '',
      trackCount: Number(info.size || info.trackCount || rawSongs.length) || songs.length,
    },
    songs,
    total: Number(info.size || info.trackCount || rawSongs.length) || songs.length,
  };
}

module.exports = { handleNeteaseAlbumDetail };
