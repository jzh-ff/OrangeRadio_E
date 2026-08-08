/* =========================================================================
   OrangeSea · 网易云歌单（netease-playlist）
   -------------------------------------------------------------------------
   从原 server.js 拆出：用户歌单同步、歌单曲目分页/全量拉取、曲目索引缓存。
   依赖 context（缓存 Map / cookie）/ NeteaseCloudMusicApi。
   ========================================================================= */
'use strict';

const {
  user_playlist,
  playlist_detail,
  playlist_track_all,
  song_detail,
} = require('NeteaseCloudMusicApi');
const {
  getUserCookie,
  neteasePlaylistTrackIndexCache,
  neteasePlaylistTrackIndexInflight,
} = require('../context');

const NETEASE_PLAYLIST_SYNC_PAGE_SIZE = 200;
const NETEASE_PLAYLIST_SYNC_MAX_PAGES = 80;
const NETEASE_TRACK_SYNC_PAGE_SIZE = 500;
const NETEASE_TRACK_SYNC_MAX_PAGES = 80;
const NETEASE_TRACK_STREAM_PAGE_SIZE = 200;
const NETEASE_PLAYLIST_TRACK_INDEX_TTL_MS = 10 * 60 * 1000;
const NETEASE_PLAYLIST_TRACK_INDEX_MAX_ENTRIES = 8;

function mapNeteasePlaylistMeta(pl, fallbackId) {
  pl = pl || {};
  return {
    id: pl.id || fallbackId,
    name: pl.name || '',
    cover: pl.coverImgUrl || pl.cover || '',
    trackCount: pl.trackCount || pl.track_count || 0,
    playCount: pl.playCount || pl.play_count || 0,
    creator: (pl.creator && pl.creator.nickname) || pl.creatorNickname || '',
    subscribed: !!pl.subscribed,
    specialType: pl.specialType || 0,
  };
}

function mergeUniqueNeteasePlaylists(target, incoming, seen) {
  (incoming || []).forEach(pl => {
    const id = String(pl && pl.id || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    target.push(pl);
  });
}

async function fetchAllNeteaseUserPlaylists(uid, maxItems) {
  const userCookie = getUserCookie();
  const playlists = [];
  const seen = new Set();
  let offset = 0;
  let total = 0;
  for (let page = 0; page < NETEASE_PLAYLIST_SYNC_MAX_PAGES; page += 1) {
    const r = await user_playlist({
      uid,
      limit: NETEASE_PLAYLIST_SYNC_PAGE_SIZE,
      offset,
      cookie: userCookie,
      timestamp: Date.now(),
    });
    const body = r.body || r || {};
    const raw = Array.isArray(body.playlist) ? body.playlist : [];
    total = Number(body.total || body.count || total) || total;
    mergeUniqueNeteasePlaylists(playlists, raw, seen);
    if (maxItems && playlists.length >= maxItems) break;
    if (!raw.length || raw.length < NETEASE_PLAYLIST_SYNC_PAGE_SIZE) break;
    if (total && playlists.length >= total) break;
    offset += NETEASE_PLAYLIST_SYNC_PAGE_SIZE;
  }
  return maxItems ? playlists.slice(0, maxItems) : playlists;
}

async function fetchNeteaseUserPlaylistsPage(uid, limit, offset) {
  const userCookie = getUserCookie();
  limit = Math.max(1, Math.min(NETEASE_PLAYLIST_SYNC_PAGE_SIZE, parseInt(limit || '48', 10) || 48));
  offset = Math.max(0, parseInt(offset || '0', 10) || 0);
  const r = await user_playlist({
    uid,
    limit,
    offset,
    cookie: userCookie,
    timestamp: Date.now(),
  });
  const body = r.body || r || {};
  const playlists = Array.isArray(body.playlist) ? body.playlist : [];
  const total = Math.max(Number(body.total || body.count || 0) || 0, offset + playlists.length);
  const nextOffset = offset + playlists.length;
  return {
    playlists,
    total,
    offset,
    limit,
    nextOffset,
    hasMore: total ? nextOffset < total : playlists.length >= limit,
  };
}

function neteaseRawTrackKey(track, fallback) {
  track = track || {};
  const privilege = track.privilege || {};
  const album = track.al || track.album || {};
  return String(
    track.id ||
    track.songId ||
    track.resourceId ||
    privilege.id ||
    ((track.name || '') + '|' + (album.id || album.name || '') + '|' + fallback)
  );
}

function mergeUniqueNeteaseTracks(target, incoming, seen) {
  let added = 0;
  (incoming || []).forEach((track, index) => {
    const key = neteaseRawTrackKey(track, target.length + ':' + index);
    if (!key || seen.has(key)) return;
    seen.add(key);
    target.push(track);
    added += 1;
  });
  return added;
}

async function fetchNeteasePlaylistDetailMeta(id) {
  const userCookie = getUserCookie();
  if (typeof playlist_detail !== 'function') return { playlistMeta: { id, name: '', cover: '', trackCount: 0 }, tracks: [] };
  const detail = await playlist_detail({ id, s: 0, cookie: userCookie, timestamp: Date.now() });
  const pl = (detail.body && detail.body.playlist) || {};
  return { playlistMeta: mapNeteasePlaylistMeta(pl, id), tracks: Array.isArray(pl.tracks) ? pl.tracks : [] };
}

function pruneNeteasePlaylistTrackIndexCache() {
  const now = Date.now();
  for (const [key, entry] of neteasePlaylistTrackIndexCache.entries()) {
    if (!entry || now - entry.updatedAt > NETEASE_PLAYLIST_TRACK_INDEX_TTL_MS) {
      neteasePlaylistTrackIndexCache.delete(key);
    }
  }
  while (neteasePlaylistTrackIndexCache.size > NETEASE_PLAYLIST_TRACK_INDEX_MAX_ENTRIES) {
    const oldestKey = neteasePlaylistTrackIndexCache.keys().next().value;
    if (oldestKey == null) break;
    neteasePlaylistTrackIndexCache.delete(oldestKey);
  }
}

function invalidateNeteasePlaylistTrackIndex(id) {
  const key = String(id || '');
  if (key) neteasePlaylistTrackIndexCache.delete(key);
}

async function fetchNeteasePlaylistTrackIndex(id) {
  const userCookie = getUserCookie();
  const key = String(id || '');
  if (!key || typeof playlist_detail !== 'function') return null;
  pruneNeteasePlaylistTrackIndexCache();
  const cached = neteasePlaylistTrackIndexCache.get(key);
  if (cached && Date.now() - cached.updatedAt <= NETEASE_PLAYLIST_TRACK_INDEX_TTL_MS) {
    neteasePlaylistTrackIndexCache.delete(key);
    neteasePlaylistTrackIndexCache.set(key, cached);
    return cached;
  }
  if (neteasePlaylistTrackIndexInflight.has(key)) return neteasePlaylistTrackIndexInflight.get(key);
  const pending = (async () => {
    const detail = await playlist_detail({ id, s: 0, cookie: userCookie, timestamp: Date.now() });
    const pl = (detail.body && detail.body.playlist) || {};
    const rawIds = Array.isArray(pl.trackIds) && pl.trackIds.length ? pl.trackIds : (pl.tracks || []);
    const trackIds = rawIds.map(item => item && (item.id || item.songId || item.trackId)).filter(Boolean);
    const entry = {
      playlistMeta: mapNeteasePlaylistMeta(pl, id),
      trackIds,
      updatedAt: Date.now(),
    };
    if (!entry.playlistMeta.trackCount) entry.playlistMeta.trackCount = trackIds.length;
    neteasePlaylistTrackIndexCache.set(key, entry);
    pruneNeteasePlaylistTrackIndexCache();
    return entry;
  })().finally(() => {
    neteasePlaylistTrackIndexInflight.delete(key);
  });
  neteasePlaylistTrackIndexInflight.set(key, pending);
  return pending;
}

async function fetchAllNeteasePlaylistTracks(id) {
  const userCookie = getUserCookie();
  let playlistMeta = { id, name: '', cover: '', trackCount: 0 };
  let detailTracks = [];
  try {
    const detail = await fetchNeteasePlaylistDetailMeta(id);
    playlistMeta = detail.playlistMeta || playlistMeta;
    detailTracks = detail.tracks || [];
  } catch (err) {
    console.warn('[PlaylistTracks] playlist_detail meta failed:', err.message);
  }

  const rawTracks = [];
  const seen = new Set();
  const expectedTotal = Number(playlistMeta.trackCount || 0) || 0;

  if (typeof playlist_track_all === 'function') {
    let offset = 0;
    for (let page = 0; page < NETEASE_TRACK_SYNC_MAX_PAGES; page += 1) {
      try {
        const all = await playlist_track_all({
          id,
          limit: NETEASE_TRACK_SYNC_PAGE_SIZE,
          offset,
          cookie: userCookie,
          timestamp: Date.now(),
        });
        const body = all.body || all || {};
        const rows = (body.songs || body.tracks || []);
        const added = mergeUniqueNeteaseTracks(rawTracks, rows, seen);
        if (!rows.length || !added) break;
        if (expectedTotal && rawTracks.length >= expectedTotal) break;
        if (!expectedTotal && rows.length < NETEASE_TRACK_SYNC_PAGE_SIZE) break;
        offset += NETEASE_TRACK_SYNC_PAGE_SIZE;
      } catch (err) {
        console.warn('[PlaylistTracks] playlist_track_all page failed:', id, offset, err.message);
        break;
      }
    }
  }

  if (!rawTracks.length && detailTracks.length) {
    mergeUniqueNeteaseTracks(rawTracks, detailTracks, seen);
  }

  return { playlistMeta, rawTracks };
}

async function fetchNeteasePlaylistTracksPage(id, limit, offset) {
  const userCookie = getUserCookie();
  limit = Math.max(1, Math.min(NETEASE_TRACK_STREAM_PAGE_SIZE, parseInt(limit || '48', 10) || 48));
  offset = Math.max(0, parseInt(offset || '0', 10) || 0);
  let rawTracks = [];
  let playlistMeta = { id, name: '', cover: '', trackCount: 0 };
  let total = 0;
  let requestedCount = 0;
  try {
    const index = await fetchNeteasePlaylistTrackIndex(id);
    if (index && index.trackIds && index.trackIds.length) {
      playlistMeta = index.playlistMeta || playlistMeta;
      total = index.trackIds.length;
      const pageIds = index.trackIds.slice(offset, offset + limit);
      requestedCount = pageIds.length;
      if (pageIds.length) {
        const detail = await song_detail({ ids: pageIds.join(','), cookie: userCookie, timestamp: Date.now() });
        const body = detail.body || detail || {};
        const rows = body.songs || body.tracks || [];
        const byId = new Map(rows.map(track => [String(track && track.id || ''), track]));
        rawTracks = pageIds.map(trackId => byId.get(String(trackId))).filter(Boolean);
      }
    }
  } catch (err) {
    console.warn('[PlaylistTracks] cached track index failed:', id, offset, err.message);
  }
  if (!requestedCount && !rawTracks.length && typeof playlist_track_all === 'function') {
    const page = await playlist_track_all({ id, limit, offset, cookie: userCookie, timestamp: Date.now() });
    const body = page.body || page || {};
    rawTracks = body.songs || body.tracks || [];
    requestedCount = rawTracks.length;
    total = Number(body.total || body.count || body.songCount || body.trackCount || 0) || 0;
  }
  if (!rawTracks.length && !requestedCount && typeof playlist_detail === 'function') {
    try {
      const detail = await fetchNeteasePlaylistDetailMeta(id);
      playlistMeta = detail.playlistMeta || playlistMeta;
      total = Math.max(total, Number(playlistMeta.trackCount || 0) || 0);
      if (!rawTracks.length) rawTracks = (detail.tracks || []).slice(offset, offset + limit);
    } catch (err) {
      console.warn('[PlaylistTracks] paged metadata failed:', id, err.message);
    }
  }
  if (!playlistMeta.trackCount && total) playlistMeta.trackCount = total;
  const nextOffset = offset + Math.max(requestedCount, rawTracks.length);
  return {
    playlistMeta,
    rawTracks,
    total,
    offset,
    limit,
    nextOffset,
    hasMore: total ? nextOffset < total : rawTracks.length >= limit,
  };
}

module.exports = {
  NETEASE_PLAYLIST_SYNC_PAGE_SIZE,
  NETEASE_PLAYLIST_SYNC_MAX_PAGES,
  NETEASE_TRACK_SYNC_PAGE_SIZE,
  NETEASE_TRACK_SYNC_MAX_PAGES,
  NETEASE_TRACK_STREAM_PAGE_SIZE,
  NETEASE_PLAYLIST_TRACK_INDEX_TTL_MS,
  NETEASE_PLAYLIST_TRACK_INDEX_MAX_ENTRIES,
  mapNeteasePlaylistMeta,
  mergeUniqueNeteasePlaylists,
  fetchAllNeteaseUserPlaylists,
  fetchNeteaseUserPlaylistsPage,
  neteaseRawTrackKey,
  mergeUniqueNeteaseTracks,
  fetchNeteasePlaylistDetailMeta,
  pruneNeteasePlaylistTrackIndexCache,
  invalidateNeteasePlaylistTrackIndex,
  fetchNeteasePlaylistTrackIndex,
  fetchAllNeteasePlaylistTracks,
  fetchNeteasePlaylistTracksPage,
};
