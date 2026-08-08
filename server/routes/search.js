/* =========================================================================
   OrangeSea · 搜索路由（search）
   -------------------------------------------------------------------------
   /api/search（网易云统一搜索 + 封面补齐）、/api/qq/search、
   /api/kugou/search、/api/kugou/recommendations。
   ========================================================================= */
'use strict';

const { sendJSON } = require('../utils');
const { getKugouCookie } = require('../context');
const {
  handleKugouSearch,
  handleKugouGuessLike,
} = require('../../kugou-api');
const {
  handleQQSearch,
} = require('../handlers/qq-playback');
const { handleSearch } = require('../handlers/netease-search');

async function handle(req, res, url) {
  const pn = url.pathname;
  const kugouCookie = getKugouCookie();

  if (pn === '/api/search') {
    try {
      const kw    = url.searchParams.get('keywords') || '';
      const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const songs = await handleSearch(kw, limit, offset);
      sendJSON(res, { songs, offset, limit, nextOffset: offset + songs.length, hasMore: songs.length >= limit });
    } catch (err) { console.error('[Search]', err); sendJSON(res, { error: err.message, songs: [] }, 500); }
    return true;
  }

  if (pn === '/api/qq/search') {
    try {
      const kw = url.searchParams.get('keywords') || '';
      const limit = Math.max(4, Math.min(30, parseInt(url.searchParams.get('limit') || '12', 10) || 12));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const songs = await handleQQSearch(kw, limit, offset);
      sendJSON(res, { provider: 'qq', songs, offset, limit, nextOffset: offset + songs.length, hasMore: songs.length >= limit });
    } catch (err) {
      console.error('[QQSearch]', err);
      sendJSON(res, { provider: 'qq', error: err.message, songs: [] }, 500);
    }
    return true;
  }

  if (pn === '/api/kugou/search') {
    try {
      const kw = url.searchParams.get('keywords') || '';
      const limit = Math.max(4, Math.min(20, parseInt(url.searchParams.get('limit') || '12', 10) || 12));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const songs = await handleKugouSearch(kw, limit, kugouCookie, offset);
      sendJSON(res, { provider: 'kugou', songs, offset, limit, nextOffset: offset + songs.length, hasMore: songs.length >= limit });
    } catch (err) {
      console.error('[KugouSearch]', err);
      sendJSON(res, { provider: 'kugou', error: err.message, songs: [] }, 500);
    }
    return true;
  }

  if (pn === '/api/kugou/recommendations') {
    try {
      const limit = Math.max(4, Math.min(20, parseInt(url.searchParams.get('limit') || '12', 10) || 12));
      sendJSON(res, await handleKugouGuessLike(kugouCookie, limit));
    } catch (err) {
      console.error('[KugouRecommendations]', err);
      sendJSON(res, { provider: 'kugou', error: err.message, songs: [] }, 500);
    }
    return true;
  }

  return false;
}

module.exports = { handle };
