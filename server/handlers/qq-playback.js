/* =========================================================================
   OrangeSea · QQ 音乐业务（qq-playback）
   -------------------------------------------------------------------------
   从原 server.js 拆出：QQ 搜索（smartbox/full）、歌曲/歌手/专辑详情、
   播放地址（vkey + 探测）、歌词、评论。依赖 qq-core / netease-mappers /
   audio-probe / utils / context。
   ========================================================================= */
'use strict';

const crypto = require('crypto');
const {
  requestText,
  requestJson,
  parseJSONText,
  decodeHtmlEntities,
} = require('../utils');
const { getQQCookie } = require('../context');
const {
  QQ_SMARTBOX_URL,
  QQ_HEADERS,
  qqMusicRequest,
  qqGetJSON,
  qqCookieObject,
  qqCookieUin,
  qqCookieMusicKey,
  qqCookiePlaybackKey,
  classifyQQPlaybackRestriction,
  mapQQPlaylistTrack,
} = require('./qq-core');
const {
  QQ_QUALITY_CANDIDATE_TEMPLATES,
  normalizeQualityPreference,
  qualityCandidatesFrom,
} = require('./netease-mappers');
const {
  QQ_VKEY_REQUEST_TIMEOUT_MS,
  QQ_AUDIO_PROBE_TOTAL_MS,
  QQ_AUDIO_PROBE_ATTEMPT_MS,
  probeQQAudioUrl,
} = require('./audio-probe');

/* ---------- 头像 / 封面 ---------- */
function qqAlbumCover(albumMid, size) {
  if (!albumMid) return '';
  const px = size || 300;
  return 'https://y.qq.com/music/photo_new/T002R' + px + 'x' + px + 'M000' + albumMid + '.jpg?max_age=2592000';
}
function qqSingerAvatar(singerMid, size) {
  if (!singerMid) return '';
  const px = size || 300;
  return 'https://y.qq.com/music/photo_new/T001R' + px + 'x' + px + 'M000' + singerMid + '.jpg?max_age=2592000';
}

/* ---------- 映射 ---------- */
function mapQQArtists(raw) {
  return (raw || [])
    .map(a => ({
      id: a && a.id,
      mid: a && a.mid,
      name: (a && (a.name || a.title)) || '',
    }))
    .filter(a => a.name);
}
function mapQQSmartSong(item) {
  item = item || {};
  const mid = item.mid || item.songmid || item.id || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: item.id || item.docid || '',
    mid,
    songmid: mid,
    name: item.name || item.title || '',
    artist: item.singer || '',
    artists: item.singer ? [{ name: item.singer }] : [],
    album: '',
    cover: '',
    duration: 0,
    fee: 0,
    playable: false,
  };
}
function mapQQTrack(track, fallback) {
  track = track || {};
  fallback = fallback || {};
  const album = track.album || {};
  const artists = mapQQArtists(track.singer || []);
  const mid = track.mid || fallback.mid || fallback.songmid || '';
  const albumMid = album.mid || album.pmid || '';
  return {
    provider: 'qq',
    source: 'qq',
    type: 'qq',
    id: mid,
    qqId: track.id || fallback.qqId || fallback.id || '',
    mid,
    songmid: mid,
    mediaMid: track.file && track.file.media_mid,
    name: track.name || track.title || fallback.name || '',
    artist: artists.map(a => a.name).join(' / ') || fallback.artist || '',
    artists: artists.length ? artists : (fallback.artists || []),
    artistId: artists[0] && (artists[0].id || artists[0].mid),
    artistMid: artists[0] && artists[0].mid,
    album: album.name || album.title || fallback.album || '',
    albumMid,
    cover: qqAlbumCover(albumMid, 300) || fallback.cover || '',
    duration: (Number(track.interval) || 0) * 1000,
    fee: track.pay && Number(track.pay.pay_play) ? 1 : 0,
    playable: false,
  };
}

/* ---------- 搜索 ---------- */
async function qqSmartboxSearch(keywords, limit) {
  const u = new URL(QQ_SMARTBOX_URL);
  u.searchParams.set('format', 'json');
  u.searchParams.set('key', keywords);
  u.searchParams.set('g_tk', '5381');
  u.searchParams.set('loginUin', '0');
  u.searchParams.set('hostUin', '0');
  u.searchParams.set('inCharset', 'utf8');
  u.searchParams.set('outCharset', 'utf-8');
  u.searchParams.set('notice', '0');
  u.searchParams.set('platform', 'yqq.json');
  u.searchParams.set('needNewCode', '0');
  const text = await requestText(u.toString(), { headers: QQ_HEADERS });
  const json = parseJSONText(text);
  const items = json && json.data && json.data.song && json.data.song.itemlist;
  return (Array.isArray(items) ? items : []).slice(0, Math.max(1, Math.min(limit || 6, 10))).map(mapQQSmartSong);
}
function qqSearchSign(text) {
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  const part1 = [23, 14, 6, 36, 16, 40, 7, 19].map(index => hash[index]).join('');
  const part2 = [16, 1, 32, 12, 19, 27, 8, 5].map(index => hash[index]).join('');
  const scramble = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];
  const bytes = scramble.map((value, index) => value ^ parseInt(hash.slice(index * 2, index * 2 + 2), 16));
  const middle = Buffer.from(bytes).toString('base64').replace(/[\\/+=]/g, '');
  return `zzc${part1}${middle}${part2}`.toLowerCase();
}
async function qqFullSongSearch(keywords, limit, offset) {
  limit = Math.max(1, Math.min(30, Number(limit) || 12));
  offset = Math.max(0, Number(offset) || 0);
  const pageNumber = Math.floor(offset / limit) + 1;
  const payload = {
    comm: {
      ct: '11', cv: '14090508', v: '14090508', tmeAppID: 'qqmusic',
      phonetype: 'EBG-AN10', os_ver: '12', OpenUDID: '0', QIMEI36: '0',
      udid: '0', chid: '0', aid: '0', oaid: '0', taid: '0', tid: '0',
      wid: '0', uid: '0', sid: '0', modeSwitch: '6', teenMode: '0',
      ui_mode: '2', nettype: '1020',
    },
    req: {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicMobile',
      param: {
        search_type: 0,
        searchid: String(Date.now()) + String(Math.random()).slice(2, 8),
        query: keywords,
        page_num: pageNumber,
        num_per_page: limit,
        highlight: 0,
        nqc_flag: 0,
        multi_zhida: 0,
        cat: 2,
        grp: 1,
        sin: offset,
        sem: 0,
      },
    },
  };
  const bodyText = JSON.stringify(payload);
  const json = await requestJson(
    'https://u.y.qq.com/cgi-bin/musics.fcg?sign=' + qqSearchSign(bodyText),
    {
      method: 'POST',
      timeoutMs: 10000,
      headers: {
        'User-Agent': 'QQMusic 14090508(android 12)',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyText),
      },
    },
    bodyText
  );
  const data = json && json.req && json.req.data;
  const body = data && (data.body || data);
  const items = body && (body.item_song || body.song && body.song.list || body.list);
  return (Array.isArray(items) ? items : [])
    .slice(offset, offset + limit)
    .map(raw => mapQQTrack(raw && (raw.track_info || raw.songInfo || raw.songinfo || raw.song) || raw, {}))
    .filter(song => song && song.name && (song.mid || song.id));
}
async function handleQQSearch(keywords, limit, offset) {
  limit = Math.max(1, Math.min(30, Number(limit) || 12));
  offset = Math.max(0, Number(offset) || 0);
  console.log('[QQSearch]', keywords, 'limit:', limit, 'offset:', offset);
  let base = [];
  try {
    base = await qqFullSongSearch(keywords, limit, offset);
  } catch (err) {
    console.warn('[QQSearch] full search failed:', err.message);
  }
  if (!base.length && offset === 0) base = await qqSmartboxSearch(keywords, limit);
  const detailed = await Promise.all(base.map(async item => {
    try { return await qqSongDetail(item.mid, item); }
    catch (e) {
      console.warn('[QQSearch] detail failed:', item.mid, e.message);
      return item;
    }
  }));
  const seen = new Set();
  return detailed.filter(song => {
    const key = song && (song.mid || song.id || (song.name + '|' + song.artist));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !!song.name;
  });
}

/* ---------- 详情 ---------- */
async function qqSongDetail(mid, fallback) {
  if (!mid) return fallback;
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    songinfo: {
      module: 'music.pf_song_detail_svr',
      method: 'get_song_detail_yqq',
      param: { song_mid: mid },
    },
  });
  const data = json && json.songinfo && json.songinfo.data;
  return mapQQTrack(data && data.track_info, fallback);
}
async function handleQQArtistDetail(mid, limit) {
  const singerMid = String(mid || '').trim();
  const num = Math.max(10, Math.min(80, parseInt(limit || '36', 10) || 36));
  if (!singerMid) return { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] };
  const json = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    singer: {
      module: 'music.web_singer_info_svr',
      method: 'get_singer_detail_info',
      param: { sort: 5, singermid: singerMid, sin: 0, num },
    },
  }, { cookie: true });
  const block = json && json.singer;
  if (!block || Number(block.code || 0) !== 0) {
    return { provider: 'qq', error: block && (block.message || block.msg || block.code) || 'QQ_ARTIST_DETAIL_FAILED', artist: null, songs: [] };
  }
  const data = block.data || {};
  const info = data.singer_info || data.singerInfo || {};
  const rawSongs = Array.isArray(data.songlist) ? data.songlist : [];
  const songs = rawSongs
    .map(raw => mapQQTrack(raw && (raw.track_info || raw.songInfo || raw.songinfo || raw.song) || raw, {}))
    .filter(song => song && song.name && (song.mid || song.id));
  const matchedSongArtist = songs[0] && (songs[0].artists || []).find(a => a && a.mid === singerMid);
  const artistMid = info.mid || singerMid;
  const artistName = info.name || info.title || (matchedSongArtist && matchedSongArtist.name) || '';
  const totalSong = Number(data.total_song || data.song_count || 0) || songs.length;
  return {
    provider: 'qq',
    artist: {
      provider: 'qq',
      id: info.id || '',
      mid: artistMid,
      name: artistName,
      avatar: info.pic || info.avatar || qqSingerAvatar(artistMid, 300),
      fans: Number(info.fans || 0) || 0,
      musicSize: totalSong,
      albumSize: Number(data.total_album || 0) || 0,
      mvSize: Number(data.total_mv || 0) || 0,
    },
    total: totalSong,
    songs,
  };
}
async function handleQQAlbumDetail(mid, limit) {
  const albumMid = String(mid || '').trim();
  const num = Math.max(10, Math.min(120, parseInt(limit || '80', 10) || 80));
  if (!albumMid) return { provider: 'qq', error: 'MISSING_ALBUM_MID', album: null, songs: [] };
  const body = await qqGetJSON('https://c.y.qq.com/v8/fcgi-bin/fcg_v8_album_info_cp.fcg', {
    albummid: albumMid,
    g_tk: 5381,
    loginUin: '0',
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    needNewCode: 0,
  }, { headers: { Referer: 'https://y.qq.com/n/ryqq/albumDetail/' + encodeURIComponent(albumMid) } });
  const data = body && body.data || {};
  const rawSongs = Array.isArray(data.list) ? data.list : (Array.isArray(data.songlist) ? data.songlist : []);
  const songs = rawSongs
    .slice(0, num)
    .map(raw => {
      const song = mapQQPlaylistTrack(Object.assign({}, raw, {
        albummid: raw.albummid || albumMid,
        albumname: raw.albumname || data.name || data.title || data.albumname || '',
      }));
      if (song && !song.cover) song.cover = qqAlbumCover(albumMid, 300);
      if (song && !song.albumMid) song.albumMid = albumMid;
      return song;
    })
    .filter(song => song && song.name && (song.mid || song.id));
  const singerName = data.singername || data.singerName || data.singer_name || (songs[0] && songs[0].artist) || '';
  return {
    provider: 'qq',
    album: {
      provider: 'qq',
      mid: albumMid,
      albumMid,
      id: data.id || data.albumid || '',
      name: data.name || data.title || data.albumname || '',
      artist: singerName,
      cover: qqAlbumCover(albumMid, 300),
      releaseDate: data.aDate || data.publictime || data.pub_time || '',
      trackCount: Number(data.total_song_num || data.total || data.songnum || rawSongs.length) || songs.length,
    },
    songs,
    total: Number(data.total_song_num || data.total || data.songnum || rawSongs.length) || songs.length,
  };
}

/* ---------- 播放 ---------- */
function truthyQQPlaybackHint(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return value === true || text === '1' || text === 'true' || text === 'yes' || text === 'vip';
}
function qqPlaybackMemberHints(hints) {
  hints = hints || {};
  const fee = Number(hints.fee || hints.Fee || 0) || 0;
  const privilege = Number(hints.privilege || hints.Privilege || hints.mediaPrivilege || hints.media_privilege || 0) || 0;
  return !!(
    truthyQQPlaybackHint(hints.vipRequired) ||
    truthyQQPlaybackHint(hints.needVip) ||
    truthyQQPlaybackHint(hints.onlyVipPlayable) ||
    truthyQQPlaybackHint(hints.only_vip_playable) ||
    fee > 0 ||
    privilege >= 9
  );
}
async function handleQQSongUrl(mid, mediaMid, qualityPreference, playbackHints) {
  const qqCookie = getQQCookie();
  const songmid = String(mid || '').trim();
  if (!songmid) return { provider: 'qq', url: '', error: 'MISSING_MID', message: 'Missing QQ song mid' };
  const guid = String(10000000 + Math.floor(Math.random() * 90000000));
  const cookieObj = qqCookieObject();
  const uin = qqCookieUin(cookieObj) || '0';
  const musicKey = qqCookieMusicKey(cookieObj);
  const playbackKey = qqCookiePlaybackKey(cookieObj);
  const fileMediaMid = String(mediaMid || '').trim();
  const requestedQuality = normalizeQualityPreference(qualityPreference);
  const memberTrackHint = qqPlaybackMemberHints(playbackHints);
  const hasQQPlaybackSession = !!(uin && uin !== '0' && musicKey);
  const mediaIds = [];
  if (fileMediaMid) mediaIds.push(fileMediaMid);
  if (songmid && !mediaIds.includes(songmid)) mediaIds.push(songmid);
  const fileCandidates = mediaIds.flatMap(mediaId =>
    qualityCandidatesFrom(requestedQuality, QQ_QUALITY_CANDIDATE_TEMPLATES)
      .map(item => ({ ...item, mediaId, filename: item.prefix + mediaId + item.ext }))
  );
  const filenames = fileCandidates.map(item => item.filename);
  const param = {
    guid,
    songmid: filenames.length ? filenames.map(() => songmid) : [songmid],
    songtype: filenames.length ? filenames.map(() => 0) : [0],
    uin,
    loginflag: 1,
    platform: '20',
  };
  if (filenames.length) param.filename = filenames;
  const comm = { uin, format: 'json', ct: musicKey ? 19 : 24, cv: 0 };
  if (musicKey) comm.authst = musicKey;
  const json = await qqMusicRequest({
    comm,
    req_0: {
      module: 'vkey.GetVkeyServer',
      method: 'CgiGetVkey',
      param,
    },
  }, { cookie: true, timeoutMs: QQ_VKEY_REQUEST_TIMEOUT_MS });
  const data = json && json.req_0 && json.req_0.data;
  const infos = (data && Array.isArray(data.midurlinfo)) ? data.midurlinfo : [];
  const purlInfos = infos.filter(item => item && item.purl);
  const sips = (data && Array.isArray(data.sip) && data.sip.length ? data.sip : ['https://ws.stream.qqmusic.qq.com/']).filter(Boolean);
  const probeDeadline = Date.now() + QQ_AUDIO_PROBE_TOTAL_MS;
  const probeFailures = [];
  let playableInfo = null;
  let playableUrl = '';
  for (let infoIndex = 0; infoIndex < purlInfos.length && !playableUrl; infoIndex++) {
    const candidateInfo = purlInfos[infoIndex];
    for (let sipIndex = 0; sipIndex < sips.length && !playableUrl; sipIndex++) {
      const remainingMs = probeDeadline - Date.now();
      if (remainingMs < 300) break;
      const candidateUrl = String(sips[sipIndex] || '') + String(candidateInfo.purl || '');
      const probe = await probeQQAudioUrl(candidateUrl, Math.min(QQ_AUDIO_PROBE_ATTEMPT_MS, remainingMs));
      if (probe.ok) {
        playableInfo = candidateInfo;
        playableUrl = candidateUrl;
        break;
      }
      const probeMeta = fileCandidates.find(item => item.filename === candidateInfo.filename) || {};
      probeFailures.push((probeMeta.label || candidateInfo.filename || 'unknown') + ':' + (probe.status || probe.reason || 'failed'));
    }
  }
  const info = playableInfo || purlInfos[0] || infos[0];
  if (playableUrl && playableInfo) {
    const info = playableInfo;
    const fileMeta = fileCandidates.find(item => item.filename === info.filename) || {};
    return {
      provider: 'qq',
      url: playableUrl,
      trial: false,
      playable: true,
      playbackReady: true,
      loggedIn: hasQQPlaybackSession,
      userId: hasQQPlaybackSession ? uin : '',
      playbackKeyReady: !!(uin && playbackKey),
      vipRequired: memberTrackHint,
      level: fileMeta.level || info.filename || '',
      quality: fileMeta.label || info.filename || '',
      filename: info.filename || '',
      probeFailures: probeFailures.slice(0, 12),
      requestedQuality,
    };
  }
  const restriction = classifyQQPlaybackRestriction(info, {
    hasSession: !!(uin && musicKey),
    hasPlaybackKey: !!(uin && playbackKey),
  });
  return {
    provider: 'qq',
    url: '',
    playable: false,
    error: 'QQ_URL_UNAVAILABLE',
    loggedIn: hasQQPlaybackSession,
    playbackKeyReady: !!(uin && playbackKey),
    userId: hasQQPlaybackSession ? uin : '',
    vipRequired: memberTrackHint,
    restriction,
    reason: restriction.category,
    message: restriction.message,
    qqCode: info && (info.result || info.code || info.errtype),
    rawMessage: info && (info.msg || info.tips || info.errmsg || ''),
    tried: fileCandidates.map(item => item.label + ' · ' + item.filename),
    probeFailures: probeFailures.slice(0, 12),
    requestedQuality,
  };
}

/* ---------- 评论 ---------- */
function mapQQComment(raw) {
  raw = raw || {};
  const user = raw.user || raw.uin || {};
  const nickname = raw.nick || raw.nickname || raw.encrypt_uin || user.nick || user.nickname || user.name || 'QQ 音乐用户';
  const avatar = raw.avatarurl || raw.avatar || user.avatarurl || user.avatar || '';
  const timeRaw = Number(raw.time || raw.commenttime || raw.createTime || 0) || 0;
  return {
    id: raw.commentid || raw.commentId || raw.id || '',
    content: raw.rootcommentcontent || raw.content || raw.comment || '',
    likedCount: Number(raw.praisenum || raw.praise_num || raw.likedCount || 0) || 0,
    time: timeRaw && timeRaw < 10000000000 ? timeRaw * 1000 : timeRaw,
    user: {
      id: raw.encrypt_uin || raw.uin || user.uin || '',
      nickname,
      avatar,
    },
  };
}
async function handleQQSongComments(id, mid, limit, offset) {
  let topid = String(id || '').replace(/\D/g, '');
  if (!topid && mid) {
    try {
      const detail = await qqSongDetail(mid, { mid });
      topid = String((detail && (detail.qqId || detail.id)) || '').replace(/\D/g, '');
    } catch (e) {
      console.warn('[QQComments] detail fallback failed:', e.message);
    }
  }
  if (!topid) return { provider: 'qq', error: 'Missing QQ song id', comments: [] };
  const page = Math.max(0, Math.floor((offset || 0) / Math.max(1, limit || 20)));
  const uin = qqCookieUin() || '0';
  const body = await qqGetJSON('https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', {
    g_tk: '5381',
    loginUin: uin,
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0',
    cid: '205360772',
    reqtype: '2',
    biztype: '1',
    topid,
    cmd: '8',
    needmusiccrit: '0',
    pagenum: String(page),
    pagesize: String(limit || 20),
  }, { headers: { Referer: 'https://y.qq.com/n/ryqq/songDetail/' + encodeURIComponent(mid || topid) } });
  const hotList = body && body.hot_comment && body.hot_comment.commentlist;
  const normalList = body && body.comment && body.comment.commentlist;
  const raw = (offset === 0 && Array.isArray(hotList) && hotList.length) ? hotList : (normalList || []);
  const comments = (raw || []).map(mapQQComment).filter(c => c.content);
  const total = Number(body && body.comment && (body.comment.commenttotal || body.comment.comment_total)) || comments.length;
  return { provider: 'qq', id: topid, total, comments, hot: !!(offset === 0 && Array.isArray(hotList) && hotList.length) };
}

/* ---------- 歌词 ---------- */
function decodeQQLyricText(text) {
  let raw = decodeHtmlEntities(String(text || '').trim());
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  const looksBase64 = compact.length >= 8 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
  if (looksBase64 && !/^\s*\[/.test(raw)) {
    try {
      const decoded = Buffer.from(compact, 'base64').toString('utf8').replace(/^\uFEFF/, '');
      if (decoded && (decoded.includes('[') || /[\u4e00-\u9fa5]/.test(decoded))) raw = decoded;
    } catch (e) {
      console.warn('[QQLyric] base64 decode failed:', e.message);
    }
  }
  return decodeHtmlEntities(raw).replace(/\r\n/g, '\n').trim();
}
function normalizeQQSongId(id) {
  const n = String(id || '').replace(/\D/g, '');
  return n ? Number(n) : 0;
}
async function handleQQLyric(mid, id) {
  const songMID = String(mid || '').trim();
  const songID = normalizeQQSongId(id);
  if (!songMID && !songID) return { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' };

  let lyricText = '';
  let transText = '';
  let qrcText = '';
  let romaText = '';
  let source = 'qq-musicu';

  try {
    const param = {};
    if (songMID) param.songMID = songMID;
    if (songID) param.songID = songID;
    const json = await qqMusicRequest({
      comm: { ct: 24, cv: 0 },
      lyric: {
        module: 'music.musichallSong.PlayLyricInfo',
        method: 'GetPlayLyricInfo',
        param,
      },
    }, { cookie: true });
    const data = json && json.lyric && json.lyric.data;
    lyricText = decodeQQLyricText(data && data.lyric);
    transText = decodeQQLyricText(data && data.trans);
    qrcText = decodeQQLyricText(data && data.qrc);
    romaText = decodeQQLyricText(data && data.roma);
  } catch (e) {
    console.warn('[QQLyric] musicu failed:', e.message);
  }

  if (!lyricText && songMID) {
    try {
      const body = await qqGetJSON('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', {
        songmid: songMID,
        songtype: '0',
        format: 'json',
        nobase64: '1',
        g_tk: '5381',
        loginUin: qqCookieUin() || '0',
        hostUin: '0',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq.json',
        needNewCode: '0',
      }, { headers: { Referer: 'https://y.qq.com/portal/player.html' } });
      lyricText = decodeQQLyricText(body && body.lyric);
      transText = decodeQQLyricText(body && (body.trans || body.tlyric)) || transText;
      source = 'qq-legacy';
    } catch (e) {
      console.warn('[QQLyric] legacy failed:', e.message);
    }
  }

  return {
    provider: 'qq',
    id: songID || '',
    mid: songMID,
    lyric: lyricText,
    tlyric: transText,
    yrc: '',
    qrc: qrcText,
    roma: romaText,
    source: lyricText ? source : 'qq-empty',
  };
}

module.exports = {
  qqAlbumCover,
  qqSingerAvatar,
  mapQQArtists,
  mapQQSmartSong,
  mapQQTrack,
  qqSmartboxSearch,
  qqSearchSign,
  qqFullSongSearch,
  handleQQSearch,
  qqSongDetail,
  handleQQArtistDetail,
  handleQQAlbumDetail,
  truthyQQPlaybackHint,
  qqPlaybackMemberHints,
  handleQQSongUrl,
  mapQQComment,
  handleQQSongComments,
  decodeQQLyricText,
  normalizeQQSongId,
  handleQQLyric,
};
