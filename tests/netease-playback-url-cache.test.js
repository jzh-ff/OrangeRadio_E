'use strict';

/*
 * 播放 URL 缓存测试
 * ----------------------------------------------------------------------------
 * 验证 server/context.js 的 neteasePlaybackUrlCache：key 构造确定性/区分度、
 * 读写命中、TTL 过期失效、登录态清理时全量失效。
 * 通过环境变量隔离 cookie 文件，避免读取仓库内真实凭据。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orangesea-url-cache-'));
for (const envKey of ['COOKIE_FILE', 'QQ_COOKIE_FILE', 'KUGOU_COOKIE_FILE', 'QISHUI_COOKIE_FILE']) {
  process.env[envKey] = path.join(tmpRoot, 'empty.cookie');
}
process.env.MINERADIO_LISTEN_SYNC_FILE = path.join(tmpRoot, 'listen.json');

function cleanup() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

(async () => {
  try {
    const context = require('../server/context');
    const {
      neteasePlaybackUrlCacheKey,
      readNeteasePlaybackUrlCache,
      writeNeteasePlaybackUrlCache,
      NETEASE_PLAYBACK_URL_CACHE_TTL_MS,
      neteasePlaybackUrlCache,
      clearNeteaseLoginInfoCache,
    } = context;

    assert.equal(NETEASE_PLAYBACK_URL_CACHE_TTL_MS, 30 * 60 * 1000, 'TTL must be 30 minutes');

    // ---- key 构造：确定性 + 区分度 ----
    const k1 = neteasePlaybackUrlCacheKey('song-1', 'hires', 'cookie-a', { name: '晴天', artist: '周杰伦' });
    const k1b = neteasePlaybackUrlCacheKey('song-1', 'hires', 'cookie-a', { title: '晴天', artist: '周杰伦' });
    assert.equal(k1, k1b, 'name/title alias must produce same key');
    assert.notEqual(k1, neteasePlaybackUrlCacheKey('song-2', 'hires', 'cookie-a', { name: '晴天', artist: '周杰伦' }), 'song id must differ key');
    assert.notEqual(k1, neteasePlaybackUrlCacheKey('song-1', 'standard', 'cookie-a', { name: '晴天', artist: '周杰伦' }), 'quality must differ key');
    assert.notEqual(k1, neteasePlaybackUrlCacheKey('song-1', 'hires', 'cookie-b', { name: '晴天', artist: '周杰伦' }), 'credential fingerprint must differ key');
    assert.notEqual(k1, neteasePlaybackUrlCacheKey('song-1', 'hires', 'cookie-a', { name: '晴天', artist: '别的歌手' }), 'match hints must differ key');

    // ---- 读写命中 ----
    assert.equal(readNeteasePlaybackUrlCache(k1), null, 'miss returns null');
    writeNeteasePlaybackUrlCache(k1, { url: 'http://example/audio.mp3', playable: true });
    const hit = readNeteasePlaybackUrlCache(k1);
    assert.equal(hit.url, 'http://example/audio.mp3', 'hit must return written value');

    // ---- TTL 过期 ----
    const k2 = neteasePlaybackUrlCacheKey('song-2', 'standard', 'cookie-a', {});
    writeNeteasePlaybackUrlCache(k2, { url: 'u2', playable: true });
    neteasePlaybackUrlCache.get(k2).at = Date.now() - NETEASE_PLAYBACK_URL_CACHE_TTL_MS - 1000;
    assert.equal(readNeteasePlaybackUrlCache(k2), null, 'expired entry must be evicted');
    assert.equal(neteasePlaybackUrlCache.has(k2), false, 'expired entry must be deleted from map');

    // ---- 登录态清理 → 全量失效 ----
    const k3 = neteasePlaybackUrlCacheKey('song-3', 'hires', 'cookie-a', {});
    writeNeteasePlaybackUrlCache(k3, { url: 'u3', playable: true });
    clearNeteaseLoginInfoCache();
    assert.equal(readNeteasePlaybackUrlCache(k1), null, 'login clear must wipe all playback url caches');
    assert.equal(readNeteasePlaybackUrlCache(k3), null);

    console.log('OK netease-playback-url-cache');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
})().catch((err) => {
  cleanup();
  console.error(err);
  process.exit(1);
});
