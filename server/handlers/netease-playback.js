/* =========================================================================
   OrangeSea · 网易云播放解析（netease-playback）
   -------------------------------------------------------------------------
   从原 server.js 拆出：播放限制归类、直连音源解析、站内同录音匹配播放、
   handleSongUrl 入口。依赖 mappers / source-match / login-cache /
   audio-probe / utils / context / NeteaseCloudMusicApi。
   ========================================================================= */
'use strict';

const {
  song_url,
  song_url_v1,
} = require('NeteaseCloudMusicApi');
const { promiseWithTimeout } = require('../utils');
const {
  getUserCookie,
  neteasePlaybackUrlCacheKey,
  readNeteasePlaybackUrlCache,
  writeNeteasePlaybackUrlCache,
} = require('../context');
const {
  NETEASE_DIRECT_RESOLVE_BUDGET_MS,
  NETEASE_SOURCE_MATCH_TOTAL_BUDGET_MS,
  NETEASE_SOURCE_MATCH_LOOKUP_BUDGET_MS,
  NETEASE_SONG_URL_TOTAL_BUDGET_MS,
  NETEASE_QUALITY_CANDIDATES,
  normalizeQualityPreference,
  qualityCandidatesFrom,
  hasNeteaseSvip,
} = require('./netease-mappers');
const {
  findNeteaseSameTrackCandidates,
} = require('./netease-source-match');
const {
  getPlaybackLoginInfo,
} = require('./netease-login-cache');
const {
  probePlaybackAudioUrl,
} = require('./audio-probe');

/* ---------- 播放限制 ---------- */
function playbackRestriction(provider, category, message, action, extra) {
  return {
    provider,
    category,
    action: action || '',
    message,
    ...(extra || {}),
  };
}
function classifyNeteasePlaybackRestriction(lastData, loginInfo) {
  const loggedIn = !!(loginInfo && loginInfo.loggedIn);
  const vipReady = !!(loginInfo && (loginInfo.isVip || loginInfo.isSvip || loginInfo.vipLevel === 'vip' || loginInfo.vipLevel === 'svip' || Number(loginInfo.vipType || 0) > 0));
  const fee = Number(lastData && lastData.fee);
  const code = Number(lastData && lastData.code);
  const freeTrial = lastData && lastData.freeTrialInfo;
  if (!loggedIn) {
    return playbackRestriction('netease', 'login_required', '网易云需要登录后尝试获取完整播放地址', 'login', { code, fee });
  }
  if (freeTrial) {
    return playbackRestriction('netease', 'trial_only', '网易云仅返回试听片段，完整播放需要会员或购买', 'upgrade', { code, fee });
  }
  if (fee === 1) {
    if (vipReady) {
      return playbackRestriction('netease', 'copyright_unavailable', '当前会员状态下仍未取得可播放地址，已尝试在网易云内匹配同一录音版本', 'switch_source', { code, fee });
    }
    return playbackRestriction('netease', 'vip_required', '网易云歌曲需要 VIP 权限，当前无法获取完整播放地址', 'upgrade', { code, fee });
  }
  if (fee === 4) {
    return playbackRestriction('netease', 'paid_required', '网易云歌曲需要单曲、专辑购买或更高权限', 'purchase', { code, fee });
  }
  if (fee === 8) {
    return playbackRestriction('netease', 'copyright_unavailable', '当前网易云版本没有返回完整音源，已尝试匹配站内同一录音版本', 'switch_source', { code, fee });
  }
  if (code === 404 || code === 403) {
    return playbackRestriction('netease', 'copyright_unavailable', '网易云版权暂不可播，换源或稍后重试会更稳', 'switch_source', { code, fee });
  }
  return playbackRestriction('netease', 'url_unavailable', '网易云没有返回可播放地址，可能是版权、会员或地区限制', loggedIn ? 'switch_source' : 'login', { code, fee });
}

/* ---------- 直连解析 ---------- */
async function resolveNeteaseDirectSongUrl(id, loginInfo, qualityPreference) {
  const userCookie = getUserCookie();
  console.log('[SongUrl] id:', id, 'logged-in:', !!userCookie);
  const resolveDeadline = Date.now() + NETEASE_DIRECT_RESOLVE_BUDGET_MS;
  const requestedQuality = normalizeQualityPreference(qualityPreference);
  const svipReady = hasNeteaseSvip(loginInfo);
  const qualities = qualityCandidatesFrom(requestedQuality, NETEASE_QUALITY_CANDIDATES)
    .filter(q => !q.svip || svipReady);

  let trialFallback = null; // 兜底: 即使是试听也要能播
  let lastData = null;
  let lastError = null;
  const probeFailures = [];
  const probeCache = new Map();

  for (const q of qualities) {
    if (resolveDeadline - Date.now() < 500) break;
    try {
      // 优先用 v1 接口 (支持更高音质 level 字段)
      let result;
      try {
        result = await promiseWithTimeout(
          song_url_v1({ id, level: q.level, cookie: userCookie }),
          Math.min(2600, Math.max(500, resolveDeadline - Date.now())),
          'NETEASE_DIRECT_URL_TIMEOUT'
        );
      } catch (e) {
        lastError = e;
        if (resolveDeadline - Date.now() < 500) throw e;
        result = await promiseWithTimeout(
          song_url({ id, br: q.br, cookie: userCookie }),
          Math.min(2200, Math.max(500, resolveDeadline - Date.now())),
          'NETEASE_LEGACY_URL_TIMEOUT'
        );
      }
      const d = result.body && result.body.data && result.body.data[0];
      if (d) lastData = d;
      const url = d && d.url;
      const freeTrial = d && d.freeTrialInfo;
      console.log('[SongUrl]', q.level, '->', url ? 'OK' : 'no url', freeTrial ? '(TRIAL)' : '');
      let probe = null;
      if (url) {
        probe = probeCache.get(url);
        if (!probe) {
          probe = await probePlaybackAudioUrl(url, Math.min(2500, Math.max(600, resolveDeadline - Date.now())));
          probeCache.set(url, probe);
        }
        if (!probe.ok || !probe.magic) {
          probeFailures.push(q.level + ':' + (probe.status || probe.reason || 'invalid-audio'));
          continue;
        }
      }
      if (url && !freeTrial && probe && probe.ok) {
        return {
          provider: 'netease',
          source: 'netease',
          url,
          trial: false,
          playable: true,
          level: q.level,
          quality: q.label,
          br: d.br,
          requestedQuality,
          probeStatus: probe.status,
          probeBytes: probe.bytes,
          probeMagic: probe.magic,
        };
      }
      if (url && freeTrial && probe && probe.ok && !trialFallback) {
        trialFallback = {
          provider: 'netease',
          source: 'netease',
          url,
          trial: true,
          playable: true,
          level: q.level,
          quality: q.label,
          br: d.br,
          requestedQuality,
          trialInfo: freeTrial,
          restriction: classifyNeteasePlaybackRestriction(d, loginInfo),
          probeStatus: probe.status,
          probeBytes: probe.bytes,
          probeMagic: probe.magic,
        };
      }
    } catch (err) {
      lastError = err;
      console.log('[SongUrl]', q.level, 'failed:', err.message);
    }
  }
  if (trialFallback) return trialFallback;
  const restriction = classifyNeteasePlaybackRestriction(lastData, loginInfo);
  return {
    provider: 'netease',
    source: 'netease',
    url: null,
    trial: false,
    playable: false,
    reason: restriction.category,
    message: restriction.message,
    restriction,
    lastCode: lastData && lastData.code,
    fee: lastData && lastData.fee,
    error: lastError && lastError.message,
    probeFailures: probeFailures.slice(0, 12),
    requestedQuality,
  };
}

/* ---------- 站内同录音匹配播放 ---------- */
async function resolveNeteaseSameTrackPlayback(id, loginInfo, qualityPreference, matchHints, requestDeadline) {
  const ownDeadline = Date.now() + NETEASE_SOURCE_MATCH_TOTAL_BUDGET_MS;
  const deadline = Number(requestDeadline) > 0 ? Math.min(ownDeadline, Number(requestDeadline)) : ownDeadline;
  let candidates = [];
  try {
    const lookupBudget = Math.min(NETEASE_SOURCE_MATCH_LOOKUP_BUDGET_MS, Math.max(500, deadline - Date.now()));
    candidates = await promiseWithTimeout(
      findNeteaseSameTrackCandidates(id, matchHints, Date.now() + lookupBudget),
      lookupBudget,
      'NETEASE_SOURCE_MATCH_LOOKUP_TIMEOUT'
    );
  } catch (err) {
    console.warn('[NeteaseSourceMatch] lookup failed:', err.code || err.message);
    return null;
  }
  const excludedIds = new Set(String(matchHints && matchHints.excludeIds || '')
    .split(',')
    .map(value => String(value || '').trim())
    .filter(Boolean));
  const attemptedIds = [...excludedIds];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const candidateId = String(candidate && candidate.song && candidate.song.id || '');
    if (!candidateId || excludedIds.has(candidateId)) continue;
    attemptedIds.push(candidateId);
    try {
      const remainingMs = deadline - Date.now();
      if (remainingMs < 800) break;
      const playback = await promiseWithTimeout(
        resolveNeteaseDirectSongUrl(candidate.song.id, loginInfo, qualityPreference),
        Math.min(NETEASE_DIRECT_RESOLVE_BUDGET_MS, remainingMs),
        'NETEASE_SOURCE_MATCH_PLAYBACK_TIMEOUT'
      );
      if (!playback || !playback.url || playback.trial) continue;
      return { candidate, playback, triedIds: attemptedIds.slice() };
    } catch (err) {
      console.warn('[NeteaseSourceMatch] candidate failed:', candidate.song && candidate.song.id, err.code || err.message);
    }
  }
  return null;
}

/* ---------- 播放地址入口 ---------- */
async function handleSongUrl(id, loginInfo, qualityPreference, matchHints) {
  const hints = matchHints || {};
  // 播放 URL 缓存：同歌 + 同音质 + 同凭证指纹在 TTL 内直接复用，
  // 跳过「多品质探测 + 字节验证 + 同录音匹配」全链（单次可达数百 ms ~ 数秒）。
  const credentialFingerprint = String(getUserCookie() || '').slice(0, 48);
  const cacheKey = neteasePlaybackUrlCacheKey(id, qualityPreference || '', credentialFingerprint, hints);
  const cached = readNeteasePlaybackUrlCache(cacheKey);
  if (cached && cached.url && cached.playable !== false && !cached.trial) return cached;
  const requestDeadline = Date.now() + NETEASE_SONG_URL_TOTAL_BUDGET_MS;
  let direct = null;
  if (!hints.skipDirect) {
    try {
      direct = await promiseWithTimeout(
        resolveNeteaseDirectSongUrl(id, loginInfo, qualityPreference),
        Math.min(NETEASE_DIRECT_RESOLVE_BUDGET_MS + 300, Math.max(500, requestDeadline - Date.now())),
        'NETEASE_DIRECT_RESOLVE_TIMEOUT'
      );
    } catch (err) {
      const restriction = playbackRestriction('netease', 'url_unavailable', '网易云音源请求超时，已继续尝试站内同一录音版本', 'retry', { code: err.code || 'NETEASE_DIRECT_RESOLVE_TIMEOUT' });
      direct = {
        provider: 'netease',
        source: 'netease',
        url: null,
        trial: false,
        playable: false,
        reason: restriction.category,
        message: restriction.message,
        restriction,
        error: err.code || err.message,
      };
    }
  } else {
    const restriction = playbackRestriction('netease', 'url_unavailable', '正在继续尝试网易云站内的其它同曲版本', 'retry', { code: 'NETEASE_DIRECT_SKIPPED_AFTER_MATCH_FAILURE' });
    direct = {
      provider: 'netease',
      source: 'netease',
      url: null,
      trial: false,
      playable: false,
      reason: restriction.category,
      message: restriction.message,
      restriction,
      error: 'NETEASE_DIRECT_SKIPPED_AFTER_MATCH_FAILURE',
    };
  }
  if (direct && direct.url && !direct.trial) {
    writeNeteasePlaybackUrlCache(cacheKey, Object.assign({}, direct));
    return direct;
  }
  const sourceMatchAttempted = !!(String(hints.name || hints.title || '').trim() && String(hints.artist || '').trim());
  const matched = await resolveNeteaseSameTrackPlayback(id, loginInfo, qualityPreference, hints, requestDeadline);
  if (!matched) return { ...direct, sourceMatchAttempted };
  const result = {
    ...matched.playback,
    provider: 'netease',
    source: 'netease-same-track',
    sourceMatch: true,
    matchKind: matched.candidate.fingerprintMatches > 0
      ? 'netease_same_recording'
      : (matched.candidate.officialRecommendation ? 'netease_official_alternate' : 'netease_same_track_metadata'),
    matchedFromId: String(id || ''),
    requestedSongId: String(id || ''),
    resolvedNeteaseId: String(matched.candidate.song.id || ''),
    resolvedSongId: String(matched.candidate.song.id || ''),
    matchedSong: matched.candidate.song,
    matchScore: Math.round(matched.candidate.score || 0),
    fingerprintMatches: matched.candidate.fingerprintMatches || 0,
    sourceMatchTriedIds: matched.triedIds || [String(matched.candidate.song.id || '')],
    originalRestriction: direct && direct.restriction || null,
  };
  if (result.url && !result.trial) writeNeteasePlaybackUrlCache(cacheKey, Object.assign({}, result));
  return result;
}

module.exports = {
  playbackRestriction,
  classifyNeteasePlaybackRestriction,
  resolveNeteaseDirectSongUrl,
  resolveNeteaseSameTrackPlayback,
  handleSongUrl,
};
