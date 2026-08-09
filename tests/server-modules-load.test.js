'use strict';

/*
 * Server 模块加载冒烟测试
 * ----------------------------------------------------------------------------
 * 逐个 require 全部后端模块，确保模块顶层可执行（导出引用完整、无缺失定义）。
 * 修复过 update.js 误删函数导致的 ReferenceError（quick-check 是文本守卫、
 * node --check 只查语法，均无法捕获），此测试作为加载期防线。
 * 不 require server.js（它会 listen），不触发任何网络调用。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orangesea-server-load-'));
for (const envKey of ['COOKIE_FILE', 'QQ_COOKIE_FILE', 'KUGOU_COOKIE_FILE', 'QISHUI_COOKIE_FILE']) {
  process.env[envKey] = path.join(tmpRoot, 'empty.cookie');
}
process.env.MINERADIO_LISTEN_SYNC_FILE = path.join(tmpRoot, 'listen.json');
process.env.MINERADIO_SONG_DOWNLOAD_DIR = path.join(tmpRoot, 'downloads');

const modules = [
  '../server/context',
  '../server/utils',
  '../server/http-utils',
  '../server/cookie-cipher',
  '../server/routes/system',
  '../server/routes/local',
  '../server/routes/listen',
  '../server/routes/update',
  '../server/routes/beatmap',
  '../server/routes/discover',
  '../server/routes/search',
  '../server/routes/spotify',
  '../server/routes/qishui',
  '../server/routes/kugou',
  '../server/routes/qq',
  '../server/routes/download',
  '../server/routes/podcast',
  '../server/routes/netease',
  '../server/routes/proxy',
  '../server/routes/static',
  '../server/handlers/netease-playback',
  '../server/handlers/qq-playback',
  '../server/handlers/update',
  '../server/handlers/weather',
  '../kugou-api',
  '../qishui-api',
  '../spotify-api',
  '../local-library',
];

try {
  for (const m of modules) {
    const mod = require(m);
    assert.ok(mod && typeof mod === 'object', m + ' must export an object');
    assert.ok(Object.keys(mod).length > 0, m + ' must export something');
  }
  // 更新处理器必须导出校验与下载函数
  const update = require('../server/handlers/update');
  assert.equal(typeof update.verifyUpdateFile, 'function', 'verifyUpdateFile must be defined');
  assert.equal(typeof update.sha512Base64, 'function', 'sha512Base64 must be defined');
  assert.equal(typeof update.verifyUpdateBuffer, 'function', 'verifyUpdateBuffer must be defined');
  assert.equal(typeof update.reuseVerifiedInstallerJob, 'function', 'reuseVerifiedInstallerJob must be defined');
  console.log('OK server-modules-load (' + modules.length + ' modules)');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
