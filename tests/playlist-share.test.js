'use strict';

/*
 * 歌单导入导出（分享码）测试
 * ----------------------------------------------------------------------------
 * vm 沙箱加载 07-playlist-share.js 的纯函数：载荷构建、导入归一化（平台白名单）、
 * 分享码 gzip 编解码 roundtrip、校验和防篡改。UI 函数不打桩不测。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modulePath = path.join(__dirname, '..', 'public', 'js', 'modules', '06-lyrics', '07-playlist-share.js');

const sandbox = {
  console,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  TextEncoder,
  TextDecoder,
  Blob,
  CompressionStream,
  DecompressionStream,
  Response,
  playQueue: [],
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(modulePath, 'utf8'), sandbox, { filename: modulePath });

(async () => {
  // ---- 载荷构建：只收集有 platform+id 的项 ----
  sandbox.playQueue = [
    { platform: 'netease', id: 'n1', name: '晴天', artist: '周杰伦', cover: 'c1', duration: 250 },
    { platform: 'qq', id: 'q1', name: '七里香', artist: '周杰伦' },
    { platform: 'unknown', id: 'x1', name: '应被跳过' },
    { id: 'x2', name: '无平台应被跳过' },
  ];
  const payload = sandbox.buildPlaylistSharePayload('测试歌单');
  assert.equal(payload.type, 'osplaylist');
  assert.equal(payload.version, 1);
  assert.equal(payload.name, '测试歌单');
  assert.equal(payload.songs.length, 2, 'invalid items must be skipped');
  assert.equal(payload.songs[0].platform, 'netease');
  assert.equal(payload.songs[0].title, '晴天');

  // ---- 导入归一化：平台白名单 + id 过滤 ----
  const imported = sandbox.normalizeImportedSongs({
    songs: [
      { platform: 'kugou', id: 'k1', title: 'A' },
      { platform: 'spotify', id: 's1', title: 'B' },
      { platform: 'local', id: 'l1', title: 'C' },
      { platform: 'netease', id: '', title: '无 id' },
      { platform: 'bilibili', id: 'b1', title: '不支持' },
      { title: '无平台' },
    ],
  });
  assert.equal(imported.length, 3, 'only whitelisted platforms with id survive');
  assert.equal(imported[2].type, 'local');
  assert.equal(imported[0].provider, 'kugou');

  // ---- 分享码 roundtrip（gzip 路径）----
  const code = await sandbox.encodePlaylistShareCode(payload);
  assert.equal(code.startsWith('OSPL1:'), true);
  const decoded = await sandbox.decodePlaylistShareCode(code);
  assert.ok(decoded, 'decode must succeed');
  assert.equal(decoded.songs.length, 2);
  assert.equal(decoded.songs[0].id, 'n1');
  assert.equal(decoded.name, '测试歌单');

  // ---- 校验和防篡改 ----
  const tampered = code.slice(0, code.length - 3) + (code.endsWith('AAA') ? 'BBB' : 'AAA');
  assert.equal(await sandbox.decodePlaylistShareCode(tampered), null, 'tampered checksum must fail');
  assert.equal(await sandbox.decodePlaylistShareCode('OSPL1:garbage'), null);
  assert.equal(await sandbox.decodePlaylistShareCode('MR2:whatever'), null, 'foreign prefix must be rejected');
  assert.equal(await sandbox.decodePlaylistShareCode(''), null);
  assert.equal(await sandbox.decodePlaylistShareCode(null), null);

  // ---- JSON 明文（J codec 兜底）也可解 ----
  const rawJson = JSON.stringify(payload);
  const plainCode = 'OSPL1:J' + sandbox.shareBytesToBase64Url(new TextEncoder().encode(rawJson)) + '.' + sandbox.playlistShareChecksum(rawJson);
  const plainDecoded = await sandbox.decodePlaylistShareCode(plainCode);
  assert.ok(plainDecoded && plainDecoded.songs.length === 2, 'raw json codec must decode');

  console.log('OK playlist-share');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
