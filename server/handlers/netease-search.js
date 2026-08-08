/* =========================================================================
   OrangeSea · 网易云搜索（netease-search）
   -------------------------------------------------------------------------
   从原 server.js 拆出：统一搜索 + 缺失封面批量补齐。
   被 routes/search 与 handlers/weather（天气电台）共用。
   ========================================================================= */
'use strict';

const { cloudsearch, song_detail } = require('NeteaseCloudMusicApi');
const { getUserCookie } = require('../context');
const { mapSongRecord } = require('./netease-mappers');

async function handleSearch(keywords, limit, offset) {
  const userCookie = getUserCookie();
  limit = Math.max(1, Math.min(50, Number(limit) || 20));
  offset = Math.max(0, Number(offset) || 0);
  console.log('[Search]', keywords, 'limit:', limit, 'offset:', offset);
  const result = await cloudsearch({ keywords, limit, offset, cookie: userCookie });
  const songs = result.body && result.body.result && result.body.result.songs ? result.body.result.songs : [];

  let mapped = songs.map(s => {
    return mapSongRecord(s);
  });

  // 兜底: 补齐缺失的封面
  const missing = mapped.filter(s => !s.cover).map(s => s.id);
  if (missing.length) {
    try {
      console.log('[Search] backfilling covers for', missing.length, 'songs');
      const dd = await song_detail({ ids: missing.join(','), cookie: userCookie });
      const songsArr = (dd.body && dd.body.songs) || [];
      const idToPic = {};
      songsArr.forEach(s => {
        const pic = (s.al && s.al.picUrl) || (s.album && s.album.picUrl) || '';
        if (pic) idToPic[s.id] = pic;
      });
      mapped = mapped.map(s => s.cover ? s : { ...s, cover: idToPic[s.id] || '' });
    } catch (e) { console.warn('[Search] backfill failed:', e.message); }
  }

  return mapped;
}

module.exports = { handleSearch };
