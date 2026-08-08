'use strict';

/*
 * 酷狗 API 纯函数测试
 * ----------------------------------------------------------------------------
 * 覆盖 _test 导出与公开纯函数：cookie 认证提取、VIP 载荷归一化、
 * 播放参数 VIP 判定、缓存作用域、cookie 归一化、搜索条目映射。
 * 不触发网络请求（全部为纯函数）。
 */
const assert = require('node:assert/strict');

const kg = require('../kugou-api');

// ---- cookie 认证提取 ----
const auth = kg.extractKugouAuth('userid=123456; token=secret-token; kg_mid=m1; kg_dfid=d1; NickName=%E6%B5%8B%E8%AF%95');
assert.equal(auth.userid, '123456', 'userid must be extracted and digits-only');
assert.equal(auth.token, 'secret-token');
assert.equal(auth.mid, 'm1');
assert.equal(auth.loggedIn, true, 'userid present must imply logged in');
assert.equal(auth.playbackReady, true, 'userid + token must imply playback ready');

assert.equal(kg.kugouCookieHasLogin(''), false, 'empty cookie must not be logged in');
assert.equal(kg.kugouCookieHasLogin('kg_mid=abc'), false, 'mid alone is not login');
assert.equal(kg.kugouCookieHasPlayback('userid=1'), false, 'userid without token is not playback-ready');
assert.equal(kg.kugouCookieUserId('userid=42; token=t'), '42', 'cookie string input must work');
assert.equal(kg.kugouCookieHasLogin('KuGoo=' + encodeURIComponent('KugooID=7')), true, 'KuGoo compound implies login');
assert.equal(kg.kugouCookieUserId('KuGoo=' + encodeURIComponent('KugooID=7')), '7', 'userid must extract from KuGoo compound');

// ---- cookie 输入归一化 ----
assert.equal(kg.normalizeKugouCookieInput(' a=1; b=2 '), 'a=1; b=2');
assert.equal(kg.normalizeKugouCookieInput(['a=1', '', 'b=2']), 'a=1; b=2');
assert.equal(kg.normalizeKugouCookieInput({ a: '1', b: '2' }), 'a=1; b=2');
assert.equal(kg.normalizeKugouCookieInput(null), '');

// ---- VIP 载荷归一化 ----
const vipPayload = { data: { vip_type: 2, vip_end_time: 9999999999999 } };
const vip = kg._test.normalizeKugouVipPayloadV2(vipPayload);
assert.equal(vip.isVip, true, 'positive vip_type with future expiry must be vip');
assert.equal(vip.membershipKnown, true);
assert.equal(vip.membershipSource, 'kugou-vip-api');

const noVip = kg._test.normalizeKugouVipPayloadV2({ data: {} });
assert.equal(noVip.isVip, false);
assert.equal(noVip.membershipKnown, false, 'no membership signal must stay unknown');

const fallback = kg._test.normalizeKugouVipPayloadV2(null, { userid: '123456', isVip: true, membershipKnown: true });
assert.equal(fallback.isVip, true, 'explicit fallback membership must apply');
assert.equal(fallback.membershipSource, 'kugou-cookie-explicit');

// ---- 播放参数 VIP 判定 ----
assert.equal(kg._test.kugouPlaybackParamsRequireVip({ privilege: 9 }), true, 'privilege >= 9 requires vip');
assert.equal(kg._test.kugouPlaybackParamsRequireVip({ fee: 1 }), true, 'fee > 0 requires vip');
assert.equal(kg._test.kugouPlaybackParamsRequireVip({ vipRequired: '1' }), true);
assert.equal(kg._test.kugouPlaybackParamsRequireVip({ privilege: 8 }), false);
assert.equal(kg._test.kugouPlaybackParamsRequireVip({}), false);

// ---- 缓存作用域：身份确定性 ----
const scopeA = kg._test.kugouPlaybackCacheScope({ userid: '1', token: 't', mid: 'm' }, { isVip: true });
const scopeA2 = kg._test.kugouPlaybackCacheScope({ userid: '1', token: 't', mid: 'm' }, { isVip: true });
const scopeB = kg._test.kugouPlaybackCacheScope({ userid: '1', token: 't', mid: 'm' }, { isSvip: true });
assert.equal(scopeA, scopeA2, 'same identity must produce same scope');
assert.equal(/^[0-9a-f]{20}$/.test(scopeA), true);
assert.notEqual(scopeA, scopeB, 'vip level must change cache scope');

// ---- 搜索条目映射 ----
const item = kg.mapKugouSearchItem({
  FileHash: 'HASH123',
  SongName: '晴天',
  SingerName: '周杰伦',
  AlbumID: '88',
  Privilege: 0,
});
assert.equal(item.provider, 'kugou');
assert.equal(item.id, 'HASH123');
assert.equal(item.name, '晴天');
assert.equal(item.artist, '周杰伦');
const multi = kg.mapKugouSearchItem({
  FileHash: 'H2',
  Singers: [
    { id: '1', SingerName: 'A' },
    { id: '2', SingerName: 'B' },
  ],
});
assert.equal(multi.artist, 'A / B', 'multiple singers must join with slash');

console.log('OK kugou-api');
