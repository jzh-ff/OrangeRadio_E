'use strict';

/*
 * 本地音乐库（Phase 5 音源）核心逻辑测试
 * ----------------------------------------------------------------------------
 * 用临时目录 + 假音频文件验证：扫描/排序/搜索/路径白名单/歌词/URL 解析/
 * 并发扫描互斥。music-metadata 解析失败时回退文件名，不影响流程。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lib = require('../local-library');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orangesea-local-lib-'));
const musicDir = path.join(tmpRoot, 'music');
const subDir = path.join(musicDir, 'sub');
const hiddenDir = path.join(musicDir, '.hidden');
fs.mkdirSync(subDir, { recursive: true });
fs.mkdirSync(hiddenDir, { recursive: true });

// 假音频：内容任意，music-metadata 解析失败 → 用文件名兜底
fs.writeFileSync(path.join(musicDir, 'b-歌.mp3'), 'fake-audio-bytes');
fs.writeFileSync(path.join(musicDir, 'a-歌.flac'), 'fake-audio-bytes');
fs.writeFileSync(path.join(subDir, 'c-歌.ogg'), 'fake-audio-bytes');
fs.writeFileSync(path.join(musicDir, 'not-audio.txt'), 'text');
fs.writeFileSync(path.join(hiddenDir, 'd-歌.mp3'), 'fake-audio-bytes');

// 同名 .lrc 歌词
fs.writeFileSync(path.join(musicDir, 'b-歌.lrc'), '[00:01.00]测试歌词\n[00:02.00]第二行');

function cleanup() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

(async () => {
  try {
    // ---- 扫描：跳过隐藏目录/非音频，按名称排序 ----
    const res = await lib.scanDirectory(musicDir);
    assert.equal(res.ok, true, 'scan must succeed');
    assert.equal(res.count, 3, 'must pick up 3 audio files (skip txt and .hidden)');

    const status = lib.getLibraryStatus();
    assert.equal(status.count, 3);
    assert.deepEqual(status.roots, [path.resolve(musicDir)], 'scan root must be registered');

    const names = status.roots && lib.searchLibrary('', 100, 0).songs.map((s) => s.name);
    assert.deepEqual(names, ['a-歌', 'b-歌', 'c-歌'], 'songs must sort by name (zh-CN numeric)');
    assert.equal(lib.searchLibrary('', 100, 0).songs[0].provider, 'local');
    assert.equal(lib.searchLibrary('', 100, 0).songs[0].source, 'local');

    // ---- 搜索 ----
    assert.equal(lib.searchLibrary('a-歌', 20, 0).total, 1);
    assert.equal(lib.searchLibrary('c-歌', 20, 0).songs[0].artist, '未知艺术家', 'fallback artist on metadata failure');
    const paged = lib.searchLibrary('歌', 2, 0);
    assert.equal(paged.songs.length, 2);
    assert.equal(paged.hasMore, true, 'pagination must report more');
    assert.equal(lib.searchLibrary('歌', 2, 2).songs.length, 1);
    assert.equal(lib.searchLibrary('歌', 2, 2).hasMore, false);
    assert.equal(lib.searchLibrary('不存在', 20, 0).total, 0);

    // ---- 路径白名单 ----
    const escaped = path.join(tmpRoot, 'outside.mp3');
    fs.writeFileSync(escaped, 'x');
    assert.equal(lib.isPathAllowed(escaped), false, 'path outside scan roots must be rejected');
    assert.equal(lib.isPathAllowed(path.join(musicDir, 'a-歌.mp3')), true);
    assert.equal(lib.resolveLocalSongUrl(escaped).playable, false);
    assert.equal(lib.resolveLocalSongUrl(escaped).error, 'PATH_NOT_ALLOWED');
    assert.equal(lib.resolveLocalSongUrl(path.join(musicDir, 'a-歌.flac')).playable, true);
    assert.equal(lib.resolveLocalSongUrl(path.join(musicDir, 'a-歌.flac')).url, '/api/local/audio?path=' + encodeURIComponent(path.join(musicDir, 'a-歌.flac')));
    assert.equal(lib.resolveLocalSongUrl(path.join(musicDir, 'ghost.mp3')).error, 'FILE_NOT_FOUND');

    // ---- 歌词 ----
    const lyric = lib.readLocalLyric(path.join(musicDir, 'b-歌.mp3'));
    assert.equal(lyric.source, 'local-lrc');
    assert.match(lyric.lyric, /测试歌词/);
    assert.equal(lib.readLocalLyric(escaped).source, 'none', 'lyric outside roots must be blocked');
    assert.equal(lib.readLocalLyric(path.join(musicDir, 'a-歌.flac')).source, 'none', 'missing lrc returns none');

    // ---- 并发扫描互斥 ----
    const second = await lib.scanDirectory(musicDir);
    assert.equal(second.ok, true, 'sequential rescan is fine');
    const invalid = await lib.scanDirectory(path.join(tmpRoot, 'nope'));
    assert.equal(invalid.error, 'INVALID_DIRECTORY');

    // ---- 重复根目录与 clear ----
    assert.equal(lib.addScanRoot(musicDir), false, 'duplicate root must not be added again');
    lib.clearLibrary();
    assert.equal(lib.getLibraryStatus().count, 0);
    const rescan = await lib.scanDirectory(musicDir);
    assert.equal(rescan.ok, true, 'rescan after clear works');
    assert.equal(rescan.count, 3);

    console.log('OK local-library');
  } finally {
    cleanup();
  }
})().catch((err) => {
  cleanup();
  console.error(err);
  process.exit(1);
});
