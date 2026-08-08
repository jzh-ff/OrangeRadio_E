/* =========================================================================
   OrangeSea · QQ 音乐域基础（qq-core）
   -------------------------------------------------------------------------
   从原 server.js 拆出：QQ cookie 工具、musicu 请求桥、登录信息/VIP
   状态、歌单/曲目映射。被 qq-liked-playlist / qq-playback / qq 路由
   与 netease-playback（classifyQQPlaybackRestriction）共用。
   ========================================================================= */
'use strict';

const {
  requestText,
  requestJson,
  parseJSONText,
  parseCookieString,
  serializeCookieObject,
} = require('../utils');
const { UA, getQQCookie, refreshQQConfiguredCookieStore, qqVipInfoCache } = require('../context');
const {
  normalizeQQVipPayload: normalizeQQVipPayloadStrict,
  resolveQQVipFromProbes,
  qqVipSessionCacheKey,
  qqVipCacheTtlMs,
  qqVipObjectLooksExpired: qqVipObjectLooksExpiredStrict,
} = require('../../qq-vip-api');

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_SMARTBOX_URL = 'https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg';
const QQ_HEADERS = {
  Referer: 'https://y.qq.com/',
  'User-Agent': UA,
};
const QQ_VIP_INFO_CACHE_TTL_MS = 2 * 60 * 1000;
const QQ_LIKED_PLAYLIST_ID = 'liked';
const QQ_LIKED_DIRID = 201;

/* ---------- QQ “我的喜欢” 判定（纯函数，供 qq-liked-playlist 复用） ---------- */
function isQQLikedPlaylistId(id) {
  const value = String(id || '').trim().toLowerCase();
  return value === QQ_LIKED_PLAYLIST_ID || value === 'qq-liked' || value === String(QQ_LIKED_DIRID);
}
function isQQFavoritePlaylist(pl) {
  if (pl && (isQQLikedPlaylistId(pl.id) || Number(pl.dirid || 0) === QQ_LIKED_DIRID)) return true;
  const name = String(pl && pl.name || pl && pl.diss_name || '').trim();
  const normalizedName = name.replace(/[·•・_\-\s]+/g, '').toLowerCase();
  return [
    '我喜欢',
    '我的喜欢',
    '喜欢的音乐',
    'qq音乐我喜欢',
    'qq音乐我的喜欢',
    'qq音乐喜欢的音乐',
  ].includes(normalizedName);
}
function isQzoneBackgroundPlaylist(pl) {
  const text = String((pl && pl.name || '') + ' ' + (pl && pl.creator || '')).toLowerCase();
  return /qzone|空间|背景音乐/i.test(text);
}

/* ---------- QQ cookie 工具 ---------- */
function qqCookieObject() {
  return parseCookieString(getQQCookie());
}
function normalizeQQUin(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.replace(/^0+/, '') || digits;
}
function qqCookieUin(obj) {
  obj = obj || qqCookieObject();
  const raw = Number(obj.login_type) === 2 ? (obj.wxuin || obj.uin || obj.p_uin) : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin);
  return normalizeQQUin(raw);
}
function qqCookieMusicKey(obj) {
  obj = obj || qqCookieObject();
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.p_skey || obj.skey ||
    obj.psrf_qqaccess_token || obj.psrf_qqrefresh_token || obj.wxrefresh_token || obj.wxskey || '';
}
function qqCookiePlaybackKey(obj) {
  obj = obj || qqCookieObject();
  return obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || '';
}
function decodeQQCookieValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidates = [raw];
  if (/^(?:[0-9a-fA-F]{2}){2,}$/.test(raw)) {
    try {
      const decodedHex = Buffer.from(raw, 'hex').toString('utf8').trim();
      if (decodedHex && /[^\x20-\x7e]/.test(decodedHex)) candidates.push(decodedHex);
    } catch (e) {}
  }
  const plusSafe = raw.replace(/\+/g, '%20');
  try { candidates.push(decodeURIComponent(plusSafe).trim()); } catch (e) {}
  const percentBytes = [];
  let hasPercentBytes = false;
  for (let i = 0; i < plusSafe.length; i += 1) {
    const ch = plusSafe[i];
    const hex = plusSafe.slice(i + 1, i + 3);
    if (ch === '%' && /^[0-9a-fA-F]{2}$/.test(hex)) {
      percentBytes.push(parseInt(hex, 16));
      hasPercentBytes = true;
      i += 2;
    } else {
      const text = ch === '+' ? ' ' : ch;
      for (const byte of Buffer.from(text, 'utf8')) percentBytes.push(byte);
    }
  }
  if (hasPercentBytes && percentBytes.length) {
    const buf = Buffer.from(percentBytes);
    try { candidates.push(new TextDecoder('gb18030').decode(buf).trim()); } catch (e) {}
    try { candidates.push(buf.toString('utf8').trim()); } catch (e) {}
  }
  for (const item of candidates.slice()) {
    if (!item) continue;
    if (/\\u[0-9a-fA-F]{4}/.test(item)) {
      try { candidates.push(JSON.parse('"' + item.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\\\\u/g, '\\u') + '"').trim()); } catch (e) {}
    }
    if (/[ÃÂ]|[\u00c0-\u00ff][\u0080-\u00bf]/.test(item)) {
      try { candidates.push(Buffer.from(item, 'latin1').toString('utf8').trim()); } catch (e) {}
    }
  }
  function score(text) {
    text = String(text || '').trim();
    if (!text) return 1e9;
    let s = 0;
    s += (text.match(/\uFFFD/g) || []).length * 80;
    s += (text.match(/%[0-9a-fA-F]{2}/g) || []).length * 10;
    s += (text.match(/\\u[0-9a-fA-F]{4}/g) || []).length * 8;
    s += (text.match(/[ÃÂ]/g) || []).length * 34;
    s += (text.match(/[\u0080-\u009f]/g) || []).length * 42;
    s += (text.match(/[\x00-\x08\x0e-\x1f\x7f]/g) || []).length * 50;
    s -= (text.match(/[\u4e00-\u9fff]/g) || []).length * 2;
    return s + Math.min(text.length, 80) * 0.02;
  }
  return candidates
    .filter(Boolean)
    .sort((a, b) => score(a) - score(b))[0]
    .trim();
}
function qqCookieNickname(obj, uin) {
  obj = obj || qqCookieObject();
  uin = normalizeQQUin(uin || qqCookieUin(obj));
  const padded = uin ? '0' + uin : '';
  const keys = [
    uin && ('ptnick_' + uin),
    padded && ('ptnick_' + padded),
    'ptnick',
    'nick',
    'nickname',
    'qq_nickname'
  ].filter(Boolean);
  for (const key of keys) {
    if (obj[key]) {
      const nick = decodeQQCookieValue(obj[key]);
      if (nick) return nick;
    }
  }
  const ptnickKey = Object.keys(obj).find(key => /^ptnick_/i.test(key) && obj[key]);
  return ptnickKey ? decodeQQCookieValue(obj[ptnickKey]) : '';
}
function qqCookieAvatar(obj, uin) {
  obj = obj || qqCookieObject();
  const direct = obj.qqmusic_avatar || obj.avatar || obj.avatarUrl || obj.headpic || '';
  if (direct) return decodeQQCookieValue(direct);
  uin = normalizeQQUin(uin || qqCookieUin(obj));
  return uin ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(uin)}&s=100` : '';
}
function normalizeQQCookieInput(cookieText) {
  const obj = parseCookieString(cookieText);
  if (Number(obj.login_type) === 2 && obj.wxuin && !obj.uin) obj.uin = obj.wxuin;
  if (!obj.uin && (obj.qqmusic_uin || obj.p_uin)) obj.uin = obj.qqmusic_uin || obj.p_uin;
  if (obj.uin) obj.uin = normalizeQQUin(obj.uin);
  return serializeCookieObject(obj);
}

/* ---------- QQ 请求桥 ---------- */
async function qqMusicRequest(payload, opts) {
  opts = opts || {};
  const qqCookie = getQQCookie();
  const body = JSON.stringify(payload);
  const headers = {
    ...QQ_HEADERS,
    'Content-Type': 'application/json;charset=UTF-8',
    'Content-Length': Buffer.byteLength(body),
  };
  if (opts.cookie && qqCookie) headers.Cookie = qqCookie;
  const text = await requestText(QQ_MUSICU_URL, {
    method: 'POST',
    headers,
    timeoutMs: opts.timeoutMs,
  }, body);
  return parseJSONText(text);
}
async function qqGetJSON(targetUrl, params, opts) {
  opts = opts || {};
  const qqCookie = getQQCookie();
  const u = new URL(targetUrl);
  Object.keys(params || {}).forEach(k => {
    if (params[k] != null) u.searchParams.set(k, String(params[k]));
  });
  const headers = { ...QQ_HEADERS, ...(opts.headers || {}) };
  if (opts.cookie !== false && qqCookie) headers.Cookie = qqCookie;
  const text = await requestText(u.toString(), { headers });
  return parseJSONText(text);
}

/* ---------- QQ 播放限制 ---------- */
function playbackRestriction(provider, category, message, action, extra) {
  return {
    provider,
    category,
    action: action || '',
    message,
    ...(extra || {}),
  };
}
function classifyQQPlaybackRestriction(info, session) {
  const hasSession = typeof session === 'object' ? !!session.hasSession : !!session;
  const hasPlaybackKey = typeof session === 'object' ? !!session.hasPlaybackKey : hasSession;
  const rawMsg = String((info && (info.msg || info.tips || info.errmsg || info.message)) || '').trim();
  const code = Number((info && (info.result || info.code || info.errtype)) || 0);
  const lower = rawMsg.toLowerCase();
  if (!hasSession) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐需要登录或授权后才能获取播放地址', 'login', { code, rawMessage: rawMsg });
  }
  if (!hasPlaybackKey && code === 104003) {
    return playbackRestriction('qq', 'login_required', 'QQ 音乐当前只拿到了网页登录状态，还缺少播放授权，请重新打开官方 QQ 音乐登录窗口完成授权', 'login', { code, rawMessage: rawMsg, missingPlaybackKey: true });
  }
  if (code === 104003) {
    return playbackRestriction('qq', 'copyright_unavailable', 'QQ 音乐没有给当前版本返回播放地址，通常是版权、会员或官方版本限制，可以换一个搜索结果或切到网易云源', 'switch_source', { code, rawMessage: rawMsg });
  }
  if (/vip|会员|付费|购买|数字专辑|专辑|pay/.test(lower + rawMsg)) {
    return playbackRestriction('qq', 'paid_required', 'QQ 音乐歌曲需要会员、购买或数字专辑权限', 'upgrade', { code, rawMessage: rawMsg });
  }
  if (code && code !== 0) {
    return playbackRestriction('qq', 'copyright_unavailable', rawMsg || 'QQ 音乐版权暂不可播或仅官方客户端可播', 'switch_source', { code, rawMessage: rawMsg });
  }
  return playbackRestriction('qq', 'url_unavailable', 'QQ 音乐没有返回可播放地址，可能是版权、会员或地区限制', hasSession ? 'switch_source' : 'login', { code, rawMessage: rawMsg });
}

/* ---------- QQ VIP 状态 ---------- */
function qqVipObjectLooksExpired(obj) {
  return qqVipObjectLooksExpiredStrict(obj);
}
function normalizeQQVipPayload(payload, fallback) {
  return normalizeQQVipPayloadStrict(payload, fallback || {});
}
function withQQVipSyncState(info, probeAvailable) {
  info = info || {};
  const authIncomplete = !!(info.loggedIn && !info.playbackKeyReady);
  const membershipUnknown = !!(info.loggedIn && info.membershipKnown !== true);
  const membershipStale = !!(info.loggedIn && (
    authIncomplete
    || membershipUnknown
    || (info.profileUnavailable && !probeAvailable)
  ));
  return {
    ...info,
    membershipStale,
    authorizationIncomplete: authIncomplete,
    vipSyncState: authIncomplete
      ? 'authorization_incomplete'
      : (membershipUnknown ? 'unknown' : (probeAvailable ? 'checked' : (membershipStale ? 'stale' : 'profile'))),
  };
}
function mergeQQVipStatus(info, vip, source) {
  info = info || {};
  const profilePositive = !!(
    info.isVip ||
    info.isSvip ||
    info.vipLevel === 'vip' ||
    info.vipLevel === 'svip' ||
    Number(info.vipType || 0) > 0 ||
    Number(info.svipType || 0) > 0
  );
  const probeKnown = !!(vip && vip.resolved && vip.membershipKnown !== false);
  if (!probeKnown) {
    return withQQVipSyncState({
      ...info,
      vipCheckedAt: Date.now(),
      vipProbeAvailable: false,
      vipSource: info.vipSource || 'profile',
    }, false);
  }
  // A verified positive profile result wins over a stale ordinary response
  // returned by one of QQ's replicated VIP query endpoints.
  if (profilePositive && !vip.isVip) {
    return withQQVipSyncState({
      ...info,
      membershipKnown: true,
      vipCheckedAt: Date.now(),
      vipProbeAvailable: true,
      vipEvidenceConflict: true,
      vipSource: info.vipSource || 'qq-profile-vip',
    }, true);
  }
  if (info.loggedIn && info.playbackKeyReady === false && !vip.isVip) {
    return withQQVipSyncState({
      ...info,
      vipCheckedAt: Date.now(),
      vipProbeAvailable: false,
      vipSource: source || vip.vipSource || info.vipSource || 'qq-vip-probe-untrusted',
    }, false);
  }
  return withQQVipSyncState({
    ...info,
    vipType: vip.vipType || 0,
    svipType: vip.svipType || 0,
    vipLevel: vip.vipLevel || 'none',
    isVip: !!vip.isVip,
    isSvip: !!vip.isSvip,
    vipLabel: vip.vipLabel || (vip.isVip ? 'VIP' : '无VIP'),
    membershipKnown: true,
    expiresAt: Number(vip.expiresAt) || 0,
    vipCheckedAt: Date.now(),
    vipProbeAvailable: true,
    vipSource: source || vip.vipSource || 'qq-vip-probe',
  }, true);
}
async function fetchQQVipStatus(cookieObj, opts) {
  opts = opts || {};
  const qqCookie = getQQCookie();
  cookieObj = cookieObj || qqCookieObject();
  const uin = qqCookieUin(cookieObj);
  const musicKey = qqCookieMusicKey(cookieObj);
  if (!uin || !musicKey) return null;
  const cacheKey = qqVipSessionCacheKey(uin, musicKey, cookieObj);
  const cached = cacheKey ? qqVipInfoCache.get(cacheKey) : null;
  if (!opts.force && cached && Date.now() < cached.expiresAt) return cached.value;
  const comm = { uin, format: 'json', ct: 24, cv: 0 };
  if (musicKey) comm.authst = musicKey;
  const probes = [
    {
      source: 'qq-vip-query-v2-list',
      responseKey: 'req_1',
      uin: String(uin),
      body: {
        comm,
        req_1: {
          module: 'userInfo.VipQueryServer',
          method: 'SRFVipQuery_V2',
          param: { uin_list: [String(uin)] },
        },
      },
    },
    {
      source: 'qq-vip-query-v1-list',
      responseKey: 'req_1',
      uin: String(uin),
      body: {
        comm,
        req_1: {
          module: 'userInfo.VipQueryServer',
          method: 'SRFVipQuery',
          param: { uin_list: [String(uin)] },
        },
      },
    },
    {
      source: 'qq-vip-query-v2-single',
      responseKey: 'vip',
      uin: String(uin),
      body: {
        comm,
        vip: {
          module: 'userInfo.VipQueryServer',
          method: 'SRFVipQuery_V2',
          param: { uin: String(uin), uin_list: [String(uin)] },
        },
      },
    },
  ];
  const value = await resolveQQVipFromProbes(probes, async probe => {
    return qqMusicRequest(probe.body, { cookie: true, timeoutMs: 4200 });
  });
  if (value && value.resolved) {
    const ttlMs = qqVipCacheTtlMs(value, {
      positiveTtlMs: QQ_VIP_INFO_CACHE_TTL_MS,
      negativeTtlMs: 30 * 1000,
    });
    if (cacheKey && ttlMs > 0) {
      qqVipInfoCache.set(cacheKey, {
        expiresAt: Date.now() + ttlMs,
        value,
      });
    }
    return value;
  }
  if (opts.force && value && value.errorCount) {
    console.warn('[QQLogin] VIP probe incomplete:', value.errorCount + '/' + probes.length);
  }
  return null;
}
function normalizeQQProfile(body, cookieObj) {
  const qqCookie = getQQCookie();
  cookieObj = cookieObj || qqCookieObject();
  const uin = qqCookieUin(cookieObj);
  const data = (body && (body.data || body.profile || body.creator || body.result)) || {};
  const creator = (data.creator || data.user || data.profile || data) || {};
  const vipInfo = data.vipInfo || data.vipinfo || data.vip || creator.vipInfo || creator.vipinfo || {};
  const profileNick = decodeQQCookieValue(creator.nick || creator.nickname || creator.name || creator.hostname || creator.title || '');
  const profileAvatar = creator.headpic || creator.avatar || creator.avatarUrl || creator.logo || '';
  const cookieNick = qqCookieNickname(cookieObj, uin);
  const nick = profileNick || cookieNick || '';
  const avatar = profileAvatar || qqCookieAvatar(cookieObj, uin);
  // Cookie labels may survive a membership downgrade, so only current
  // official profile fields are allowed to become profile membership proof.
  const profileVip = normalizeQQVipPayload({ data, creator, vipInfo }, {});
  return {
    provider: 'qq',
    loggedIn: !!(uin && qqCookieMusicKey(cookieObj)),
    preview: false,
    userId: uin,
    nickname: nick || (uin ? ('QQ ' + uin) : 'QQ 音乐'),
    avatar,
    vipType: profileVip.vipType || 0,
    svipType: profileVip.svipType || 0,
    vipLevel: profileVip.vipLevel || 'none',
    isVip: !!profileVip.isVip,
    isSvip: !!profileVip.isSvip,
    vipLabel: profileVip.vipLabel || '无VIP',
    membershipKnown: !!profileVip.membershipKnown,
    expiresAt: Number(profileVip.expiresAt) || 0,
    hasCookie: !!qqCookie,
    playbackKeyReady: !!qqCookiePlaybackKey(cookieObj),
    profileSource: profileNick || profileAvatar ? 'qq-profile' : (cookieNick || avatar ? 'cookie' : 'fallback'),
    vipSource: profileVip.resolved ? 'qq-profile-vip' : 'profile',
  };
}
async function getQQLoginInfo(options) {
  const qqCookie = getQQCookie();
  options = options || {};
  if (options.forceCookie) refreshQQConfiguredCookieStore(true);
  const cookieObj = qqCookieObject();
  const uin = qqCookieUin(cookieObj);
  const musicKey = qqCookieMusicKey(cookieObj);
  if (!uin || !musicKey) return { provider: 'qq', loggedIn: false, hasCookie: !!qqCookie };
  const fallback = normalizeQQProfile(null, cookieObj);
  const vipProbePromise = fetchQQVipStatus(cookieObj, { force: !!options.forceVip }).catch(e => {
    if (options.forceVip) console.warn('[QQLogin] VIP probe skipped:', e.message);
    return null;
  });
  try {
    const u = new URL('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg');
    u.searchParams.set('cid', '205360838');
    u.searchParams.set('userid', uin);
    u.searchParams.set('reqfrom', '1');
    u.searchParams.set('g_tk', '5381');
    u.searchParams.set('loginUin', uin);
    u.searchParams.set('hostUin', '0');
    u.searchParams.set('format', 'json');
    u.searchParams.set('inCharset', 'utf8');
    u.searchParams.set('outCharset', 'utf-8');
    u.searchParams.set('notice', '0');
    u.searchParams.set('platform', 'yqq.json');
    u.searchParams.set('needNewCode', '0');
    const text = await requestText(u.toString(), {
      headers: { ...QQ_HEADERS, Cookie: qqCookie },
      timeoutMs: options.forceVip ? 6500 : 10000,
    });
    const body = parseJSONText(text);
    const info = normalizeQQProfile(body, cookieObj);
    const vipProbe = await vipProbePromise;
    if (body && (body.code === 1000 || body.result === 301)) {
      return mergeQQVipStatus({ ...fallback, profileUnavailable: true }, vipProbe, vipProbe && vipProbe.vipSource);
    }
    return mergeQQVipStatus(info, vipProbe, vipProbe && vipProbe.vipSource);
  } catch (e) {
    console.warn('[QQLogin] profile check failed:', e.message);
    const vipProbe = await vipProbePromise;
    return mergeQQVipStatus({ ...fallback, profileUnavailable: true }, vipProbe, vipProbe && vipProbe.vipSource);
  }
}

/* ---------- QQ 歌单 / 曲目映射 ---------- */
function mapQQPlaylist(pl, kind) {
  pl = pl || {};
  const dirid = pl.dirid || pl.dir_id || '';
  const liked = Number(dirid || 0) === QQ_LIKED_DIRID || isQQFavoritePlaylist(pl);
  const id = liked ? QQ_LIKED_PLAYLIST_ID : (pl.dissid || pl.tid || dirid || pl.id || pl.diss_id);
  const rawName = pl.diss_name || pl.name || pl.title || '';
  return {
    provider: 'qq',
    source: 'qq',
    id: id ? String(id) : '',
    dirid: dirid ? String(dirid) : '',
    name: rawName,
    cover: pl.logo || pl.picUrl || pl.cover || pl.coverUrl || '',
    trackCount: Number(pl.song_cnt || pl.song_count || pl.trackCount || pl.total_song_num || 0) || 0,
    playCount: Number(pl.listen_num || pl.playCount || pl.playcount || 0) || 0,
    creator: pl.creator || pl.owner_name || pl.nickname || '',
    kind: kind || '',
    subscribed: !!pl.is_collect,
    specialType: liked ? 5 : 0,
  };
}
function mapQQPlaylistTrack(raw) {
  raw = raw || {};
  const album = raw.album || {};
  const singers = Array.isArray(raw.singer) ? raw.singer : [];
  return {
    provider: 'qq',
    source: 'qq',
    type: 'song',
    id: raw.songid || raw.id,
    mid: raw.songmid || raw.mid || '',
    mediaMid: raw.media_mid || raw.strMediaMid || raw.mediaMid || '',
    name: raw.songname || raw.name || raw.title || '',
    artist: singers.map(s => s.name || '').filter(Boolean).join(' / '),
    artists: singers.map(s => ({ name: s.name || '', id: s.mid || s.id || '' })).filter(s => s.name),
    album: album.name || raw.albumname || raw.album_name || '',
    albumId: album.mid || raw.albummid || '',
    cover: raw.albumPic || raw.album_pic || raw.albumPicBig || raw.picUrl || album.picUrl || '',
    duration: Number(raw.interval || raw.duration || album.interval || 0) * 1000 || 0,
    popularity: Number(raw.pop || raw.popularity || 0) || 0,
    fee: Number(raw.fee || raw.pay_type || raw.payType || 0) || 0,
  };
}
async function fetchQQCreatedPlaylists(uin) {
  const body = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    req_0: {
      module: 'music.musichallSong.PlayListDataServer',
      method: 'GetUserPlaylist',
      param: { uin: String(uin), sin: 0, size: 60, order: 1 },
    },
  }, { cookie: true, timeoutMs: 10000 });
  const data = (body && body.req_0 && body.req_0.data) || {};
  return (Array.isArray(data.v_playlist) ? data.v_playlist : []).map(pl => mapQQPlaylist(pl, 'created'));
}
async function fetchQQCollectedPlaylists(uin) {
  const body = await qqMusicRequest({
    comm: { ct: 24, cv: 0 },
    req_0: {
      module: 'music.musichallSong.PlayListDataServer',
      method: 'GetUserPlaylist',
      param: { uin: String(uin), sin: 0, size: 60, order: 2 },
    },
  }, { cookie: true, timeoutMs: 10000 });
  const data = (body && body.req_0 && body.req_0.data) || {};
  return (Array.isArray(data.v_playlist) ? data.v_playlist : []).map(pl => mapQQPlaylist(pl, 'collected'));
}

module.exports = {
  QQ_MUSICU_URL,
  QQ_SMARTBOX_URL,
  QQ_HEADERS,
  QQ_VIP_INFO_CACHE_TTL_MS,
  QQ_LIKED_PLAYLIST_ID,
  QQ_LIKED_DIRID,
  isQQLikedPlaylistId,
  isQQFavoritePlaylist,
  isQzoneBackgroundPlaylist,
  qqCookieObject,
  normalizeQQUin,
  qqCookieUin,
  qqCookieMusicKey,
  qqCookiePlaybackKey,
  decodeQQCookieValue,
  qqCookieNickname,
  qqCookieAvatar,
  normalizeQQCookieInput,
  qqMusicRequest,
  qqGetJSON,
  playbackRestriction,
  classifyQQPlaybackRestriction,
  qqVipObjectLooksExpired,
  normalizeQQVipPayload,
  withQQVipSyncState,
  mergeQQVipStatus,
  fetchQQVipStatus,
  normalizeQQProfile,
  getQQLoginInfo,
  mapQQPlaylist,
  mapQQPlaylistTrack,
  fetchQQCreatedPlaylists,
  fetchQQCollectedPlaylists,
};
