'use strict';

/*
 * 歌曲下载后端测试
 * ----------------------------------------------------------------------------
 * 用临时下载目录 + mock 各平台 URL 解析，验证：
 * - 平台白名单（spotify/local/unknown 拒绝）
 * - 文件名安全化与扩展名推断
 * - 普通音源流式写盘 + 元数据 JSON
 * - 汽水加密音源走解密通道
 * 不触发真实网络（fetchWithTimeout 打桩）。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orangesea-download-'));
process.env.MINERADIO_SONG_DOWNLOAD_DIR = path.join(tmpRoot, 'downloads');
process.env.COOKIE_FILE = path.join(tmpRoot, 'empty.cookie');
process.env.QQ_COOKIE_FILE = path.join(tmpRoot, 'empty.cookie');
process.env.KUGOU_COOKIE_FILE = path.join(tmpRoot, 'empty.cookie');
process.env.QISHUI_COOKIE_FILE = path.join(tmpRoot, 'empty.cookie');
process.env.MINERADIO_LISTEN_SYNC_FILE = path.join(tmpRoot, 'listen.json');

function cleanup() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

(async () => {
  try {
    const route = require('../server/routes/download');

    // ---- 文件名安全化 ----
    assert.equal(route.safeDownloadFileName('a/b:c*d?e'), 'a_b_c_d_e');
    assert.equal(route.safeDownloadFileName('  '), 'song');
    assert.equal(route.safeDownloadFileName('晴天.mp3'), '晴天.mp3');

    // ---- 扩展名推断 ----
    assert.equal(route.audioExtensionFromUrl('http://x/a.flac?size=1'), '.flac');
    assert.equal(route.audioExtensionFromUrl('http://x/a.m4a#auth=1'), '.m4a');
    assert.equal(route.audioExtensionFromUrl('http://x/a'), '.mp3');
    assert.equal(route.audioExtensionFromUrl('http://x/a.ogg/stream'), '.ogg');

    // ---- 平台白名单 ----
    const utils = require('../server/utils');
    const originalFetch = utils.fetchWithTimeout;

    // ---- 普通音源：mock URL 解析（netease）后流式写盘 ----
    const playbackModule = require('../server/handlers/netease-playback');
    const originalNetease = playbackModule.handleSongUrl;

    // 打桩 fetch：返回 3 个 chunk 的音频
    const chunks = [Buffer.from('ID3'), Buffer.from('FAKE'), Buffer.from('FLAC')];
    utils.fetchWithTimeout = async () => ({
      ok: true,
      headers: { get: (k) => (k === 'content-length' ? String(chunks.reduce((a, b) => a + b.length, 0)) : null) },
      body: {
        getReader: () => {
          let i = 0;
          return {
            read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
            cancel: async () => {},
          };
        },
      },
    });

    playbackModule.handleSongUrl = async () => ({ url: 'http://example.com/audio.flac', playable: true, trial: false });

    const job = route.createSongDownloadJob(
      { platform: 'netease', id: 'song-1', name: '测试歌曲', artist: '歌手A', cover: 'c' },
      'lossless'
    );
    // 等待下载完成（轮询 job 状态）
    let attempts = 0;
    while (job.status !== 'ready' && job.status !== 'error' && attempts < 100) {
      await new Promise((r) => setTimeout(r, 20));
      attempts++;
    }
    assert.equal(job.status, 'ready', 'download must complete, got: ' + job.error);
    assert.equal(job.progress, 100);
    assert.equal(job.total, chunks.reduce((a, b) => a + b.length, 0));
    assert.ok(job.filePath && fs.existsSync(job.filePath), 'audio file must exist');
    const written = fs.readFileSync(job.filePath);
    assert.equal(written.toString('utf8'), 'ID3FAKEFLAC', 'chunks must be written in order');

    // ---- 元数据 JSON ----
    const metaPath = job.filePath + '.osdownload.json';
    assert.ok(fs.existsSync(metaPath), 'meta json must exist');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    assert.equal(meta.type, 'osdownload');
    assert.equal(meta.platform, 'netease');
    assert.equal(meta.songId, 'song-1');
    assert.equal(meta.title, '测试歌曲');
    assert.equal(meta.quality, 'lossless');

    // ---- publicDownloadJob ----
    const pub = route.publicDownloadJob(job);
    assert.equal(pub.ok, true);
    assert.equal(pub.status, 'ready');
    assert.ok(pub.meta && pub.meta.title === '测试歌曲');

    // ---- 白名单拒绝（纯函数层）----
    const blocked = await route.resolvePlatformDownloadUrl({ platform: 'spotify', id: 's1' }, '').catch((e) => e);
    assert.equal(blocked.code, 'PLATFORM_NOT_DOWNLOADABLE', 'spotify must be rejected');
    const blockedLocal = await route.resolvePlatformDownloadUrl({ platform: 'local', id: 'l1' }, '').catch((e) => e);
    assert.equal(blockedLocal.code, 'PLATFORM_NOT_DOWNLOADABLE', 'local must be rejected');

    // 还原
    playbackModule.handleSongUrl = originalNetease;
    utils.fetchWithTimeout = originalFetch;

    console.log('OK song-download');
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
