/* =========================================================================
   OrangeSea · 网易云登录信息 / VIP 缓存（netease-login-cache）
   -------------------------------------------------------------------------
   从原 server.js 拆出：登录态查询、VIP 判定与单槽缓存。依赖 utils /
   context / netease-mappers / NeteaseCloudMusicApi。
   ========================================================================= */
'use strict';

const {
  vip_info,
  vip_info_v2,
  login_status,
  user_account,
} = require('NeteaseCloudMusicApi');
const { promiseWithTimeout, normalizeApiCode, normalizeApiMessage, sendJSON } = require('../utils');
const { getUserCookie, saveCookie, neteaseVipInfoCache, neteaseLoginInfoCache } = require('../context');

const NETEASE_LOGIN_INFO_CACHE_TTL_MS = 30 * 1000;

/* ---------- VIP 判定 ---------- */
function firstPositiveNumberFrom(objects, keys) {
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of keys) {
      const value = Number(obj[key]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 0;
}
function collectStringValues(value, out, depth) {
  if (depth > 4 || value == null) return out;
  if (typeof value === 'string') {
    if (value) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStringValues(item, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach(key => collectStringValues(value[key], out, depth + 1));
  }
  return out;
}
function collectVipStringValues(value, out, depth) {
  if (depth > 4 || value == null) return out;
  if (Array.isArray(value)) {
    value.forEach(item => collectVipStringValues(item, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;
  Object.keys(value).forEach(key => {
    const child = value[key];
    if (/vip|svip|member|associator|privilege|right|level|package|label|title|type/i.test(key)) {
      collectStringValues(child, out, depth + 1);
    } else if (child && typeof child === 'object') {
      collectVipStringValues(child, out, depth + 1);
    }
  });
  return out;
}
function activeNeteaseVipPackage(pkg) {
  if (!pkg || typeof pkg !== 'object') return false;
  const expire = Number(pkg.expireTime || pkg.expire_time || pkg.expire || pkg.endTime || 0) || 0;
  if (expire && expire < Date.now()) return false;
  return firstPositiveNumberFrom([pkg], ['vipLevel', 'vip_level', 'level', 'vipType', 'vip_type', 'vipCode', 'vip_code', 'status']) > 0;
}
async function fetchNeteaseVipInfo(userId) {
  const userCookie = getUserCookie();
  userId = String(userId || '').trim();
  if (!userId || !userCookie) return null;
  const cached = neteaseVipInfoCache.get(userId);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value;
  let body = null;
  try {
    const r = await vip_info_v2({ uid: userId, cookie: userCookie, timestamp: Date.now() });
    body = r && r.body ? r.body : r;
  } catch (e) {
    try {
      const r = await vip_info({ uid: userId, cookie: userCookie, timestamp: Date.now() });
      body = r && r.body ? r.body : r;
    } catch (err) {
      console.warn('[Login] vip_info failed:', err.message);
    }
  }
  if (body) neteaseVipInfoCache.set(userId, { at: Date.now(), value: body });
  return body;
}
function normalizeNeteaseVip(profile, account, extra) {
  profile = profile || {};
  account = account || {};
  extra = extra || {};
  const vipInfo = profile.vipInfo || profile.vipinfo || account.vipInfo || account.vipinfo || extra.vipInfo || extra.vipinfo || {};
  const vipExtra = extra.vipExtra || extra.vip_info || extra.vipInfoV2 || {};
  const vipData = vipExtra.data || vipExtra;
  const objects = [account, profile, vipInfo, extra, vipData];
  const vipType = firstPositiveNumberFrom(objects, [
    'vipType', 'vip_type', 'viptype', 'musicVipType', 'music_vip_type',
    'musicVipLevel', 'music_vip_level', 'redVipLevel', 'red_vip_level',
    'blackVipLevel', 'black_vip_level', 'luxuryVipLevel', 'luxury_vip_level',
  ]);
  const text = collectVipStringValues({ account, profile, vipInfo, extra, vipData }, [], 0).join(' ').toLowerCase();
  const redplus = vipData.redplus || vipData.redPlus || vipInfo.redplus || vipInfo.redPlus || extra.redplus || extra.redPlus;
  const associator = vipData.associator || vipInfo.associator || extra.associator;
  const musicPackage = vipData.musicPackage || vipData.music_package || vipInfo.musicPackage || vipInfo.music_package || extra.musicPackage || extra.music_package;
  const svipType = firstPositiveNumberFrom(objects, [
    'svipType', 'svip_type', 'superVipLevel', 'super_vip_level', 'superVipType', 'super_vip_type',
  ]);
  const svipFlag = objects.some(obj => obj && (
    obj.isSvip === true || obj.is_svip === true || obj.svip === true ||
    Number(obj.isSvip || obj.is_svip || obj.svip || obj.svipType || obj.svip_type || obj.superVipLevel || obj.super_vip_level || 0) > 0
  )) || /svip|supervip|super_vip|黑胶svip|超级会员/.test(text);
  const vipFlag = objects.some(obj => obj && (
    obj.isVip === true || obj.is_vip === true || obj.vip === true ||
    Number(obj.isVip || obj.is_vip || obj.vip || obj.vipFlag || obj.vipflag || 0) > 0
  )) || /vip|黑胶|会员/.test(text);
  const svipResolved = svipFlag || svipType > 0 || activeNeteaseVipPackage(redplus);
  const vipResolved = vipFlag || activeNeteaseVipPackage(associator) || activeNeteaseVipPackage(musicPackage);
  const isSvip = svipResolved;
  const isVip = isSvip || vipResolved || vipType > 0;
  const vipLevel = isSvip ? 'svip' : (isVip ? 'vip' : 'none');
  return {
    vipType,
    vipLevel,
    isVip,
    isSvip,
    vipLabel: vipLevel === 'svip' ? 'SVIP' : (vipLevel === 'vip' ? 'VIP' : '无VIP'),
  };
}
function normalizeLoginInfo(profile, account, extra) {
  profile = profile || {};
  account = account || {};
  const userId = profile.userId || profile.user_id || profile.id || account.userId || account.id || '';
  if (!(userId || userId === 0)) return { loggedIn: false };
  const vip = normalizeNeteaseVip(profile, account, extra);
  return {
    loggedIn: true,
    userId,
    nickname: profile.nickname || profile.userName || '网易云用户',
    avatar: profile.avatarUrl || profile.avatar || '',
    ...vip,
  };
}
async function enrichNeteaseLoginInfo(info, profile, account, extra) {
  if (!info || !info.loggedIn || !info.userId) return info;
  let vipExtra = null;
  try {
    vipExtra = await promiseWithTimeout(fetchNeteaseVipInfo(info.userId), 1800, 'NETEASE_VIP_INFO_TIMEOUT');
  } catch (err) {
    console.warn('[Login] vip info timeout:', err.code || err.message);
  }
  if (!vipExtra) return info;
  const vip = normalizeNeteaseVip(profile, account, { ...(extra || {}), vipExtra });
  return { ...info, ...vip };
}
function isNeteaseAuthInvalidPayload(payload) {
  const code = normalizeApiCode(payload);
  if (code === 301 || code === 401) return true;
  const msg = normalizeApiMessage(payload);
  return /未登录|需要登录|请先登录|login/i.test(msg) && code >= 300;
}
async function fetchNeteaseLoginInfo() {
  const userCookie = getUserCookie();
  if (!userCookie) return { loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };

  // login_status 对二维码 cookie 的资料刷新通常更及时；失败时再降级到 user_account。
  try {
    const st = await promiseWithTimeout(login_status({ cookie: userCookie, timestamp: Date.now() }), 2400, 'NETEASE_LOGIN_STATUS_TIMEOUT');
    const body = st.body || {};
    const data = body.data || body;
    const profile = data.profile || body.profile;
    const account = data.account || body.account;
    const info = normalizeLoginInfo(profile, account, data);
    if (info.loggedIn) return await enrichNeteaseLoginInfo(info, profile, account, data);
  } catch (e) {
    console.warn('[Login] login_status failed:', e.message);
  }

  try {
    const acc = await promiseWithTimeout(user_account({ cookie: userCookie, timestamp: Date.now() }), 2400, 'NETEASE_ACCOUNT_STATUS_TIMEOUT');
    const body = acc.body || {};
    const info = normalizeLoginInfo(body.profile, body.account, body);
    if (info.loggedIn) return await enrichNeteaseLoginInfo(info, body.profile, body.account, body);
    if (isNeteaseAuthInvalidPayload(acc)) saveCookie('');
    return { loggedIn: false, hasCookie: !!userCookie, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
  } catch (e) {
    console.warn('[Login] account check failed:', e.message);
    return { loggedIn: false, hasCookie: !!userCookie, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
  }
}
async function getLoginInfo() {
  const userCookie = getUserCookie();
  if (!userCookie) return { loggedIn: false, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
  const cookieKey = userCookie;
  if (neteaseLoginInfoCache.cookie === cookieKey && neteaseLoginInfoCache.value && Date.now() - neteaseLoginInfoCache.at < NETEASE_LOGIN_INFO_CACHE_TTL_MS) {
    return neteaseLoginInfoCache.value;
  }
  if (neteaseLoginInfoCache.cookie === cookieKey && neteaseLoginInfoCache.promise) return neteaseLoginInfoCache.promise;
  const request = fetchNeteaseLoginInfo().then(info => {
    if (getUserCookie() === cookieKey) {
      neteaseLoginInfoCache.cookie = cookieKey;
      neteaseLoginInfoCache.at = Date.now();
      neteaseLoginInfoCache.value = info;
    }
    return info;
  }).finally(() => {
    if (neteaseLoginInfoCache.cookie === cookieKey) neteaseLoginInfoCache.promise = null;
  });
  neteaseLoginInfoCache.cookie = cookieKey;
  neteaseLoginInfoCache.promise = request;
  return request;
}
async function getPlaybackLoginInfo() {
  try {
    return await promiseWithTimeout(getLoginInfo(), 800, 'NETEASE_PLAYBACK_LOGIN_INFO_TIMEOUT');
  } catch (err) {
    const stale = neteaseLoginInfoCache.cookie === getUserCookie() && neteaseLoginInfoCache.value;
    if (stale) return stale;
    return { loggedIn: !!getUserCookie(), hasCookie: !!getUserCookie(), vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP', statusPending: true };
  }
}

/* ---------- 登录守卫（路由用） ---------- */
async function requireLogin(res) {
  const info = await getLoginInfo();
  if (!info.loggedIn || !info.userId) {
    sendJSON(res, { error: 'LOGIN_REQUIRED', loggedIn: false }, 401);
    return null;
  }
  return info;
}

module.exports = {
  firstPositiveNumberFrom,
  collectStringValues,
  collectVipStringValues,
  activeNeteaseVipPackage,
  fetchNeteaseVipInfo,
  normalizeNeteaseVip,
  normalizeLoginInfo,
  enrichNeteaseLoginInfo,
  isNeteaseAuthInvalidPayload,
  fetchNeteaseLoginInfo,
  getLoginInfo,
  getPlaybackLoginInfo,
  requireLogin,
};
