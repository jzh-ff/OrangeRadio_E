'use strict';

/*
 * 听歌同步日志（listen-sync-journal）测试
 * ----------------------------------------------------------------------------
 * 验证 server/context.js 的日志写入/去重键/600 条截断，以及
 * server/routes/listen.js 的上报校验纯函数。
 * 通过环境变量把日志文件指向临时目录，避免污染仓库 data/。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orangesea-listen-journal-'));
const journalFile = path.join(tmpRoot, 'listen-sync-journal.json');
process.env.MINERADIO_LISTEN_SYNC_FILE = journalFile;
// cookie 文件指向空文件，避免加载 context 时误读仓库内凭据
for (const envKey of ['COOKIE_FILE', 'QQ_COOKIE_FILE', 'KUGOU_COOKIE_FILE', 'QISHUI_COOKIE_FILE']) {
  process.env[envKey] = path.join(tmpRoot, 'empty.cookie');
}

function cleanup() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

(async () => {
  try {
    const context = require('../server/context');
    const listenRoute = require('../server/routes/listen');

    // ---- 去重键：账号指纹 + sessionId ----
    const accountKey = context.listenSyncAccountKey('netease', 'token-abc');
    assert.match(accountKey, /^netease:[0-9a-f]{16}$/, 'account key must be provider + sha256 prefix');
    assert.equal(context.listenSyncAccountKey('netease', 'token-abc'), accountKey, 'account key must be deterministic');
    assert.notEqual(context.listenSyncAccountKey('netease', 'token-other'), accountKey);
    const key1 = context.listenSyncJournalKey('netease', 'token-abc', 's1');
    const key2 = context.listenSyncJournalKey('netease', 'token-abc', 's2');
    assert.notEqual(key1, key2, 'session id must differ the key');

    // ---- 写入与持久化 ----
    assert.equal(context.listenSyncJournal.entries[key1], undefined);
    context.rememberListenSyncSubmission(key1, {
      provider: 'netease',
      songId: 'song-1',
      accountDurationSync: 'ok',
      historySynced: true,
    });
    const onDisk = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    assert.equal(onDisk.entries[key1].songId, 'song-1');
    assert.equal(onDisk.entries[key1].provider, 'netease');
    assert.equal(typeof onDisk.entries[key1].submittedAt, 'number');
    assert.equal(onDisk.entries[key1].historySynced, true);

    // ---- 同键覆盖（去重）----
    context.rememberListenSyncSubmission(key1, {
      provider: 'netease',
      songId: 'song-1-updated',
      accountDurationSync: 'ok',
      historySynced: false,
    });
    const onDisk2 = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    assert.equal(Object.keys(onDisk2.entries).length, 1, 'same key must overwrite, not append');
    assert.equal(onDisk2.entries[key1].songId, 'song-1-updated');

    // ---- 600 条截断（保留最新）----
    for (let i = 0; i < 620; i++) {
      const k = context.listenSyncJournalKey('qq', 't-' + i, 'sess-' + i);
      context.rememberListenSyncSubmission(k, {
        provider: 'qq',
        songId: 'song-' + i,
        accountDurationSync: 'unsupported',
        historySynced: i % 2 === 0,
      });
    }
    const onDisk3 = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    const keys = Object.keys(onDisk3.entries);
    assert.equal(keys.length, 600, 'journal must cap at 600 entries');
    // 最早的 netease 条目已按时间被挤出，最新的 t-619 必须存在
    assert.equal(onDisk3.entries[key1] === undefined, true, 'oldest entry must be trimmed away');
    const newestKey = context.listenSyncJournalKey('qq', 't-619', 'sess-619');
    assert.equal(onDisk3.entries[newestKey] !== undefined, true, 'newest entry must survive trimming');

    // ---- listen 路由上报校验纯函数 ----
    assert.equal(listenRoute.normalizeListenReportProvider('Netease'), 'netease');
    assert.equal(listenRoute.normalizeListenReportProvider('qq'), 'qq');
    assert.equal(listenRoute.normalizeListenReportProvider('unknown'), '');
    assert.equal(listenRoute.listenReportSongId('netease', { id: 'x1' }), 'x1');
    assert.equal(listenRoute.listenReportSongId('netease', { providerSongId: 'x3' }), 'x3');
    assert.equal(listenRoute.listenReportSongId('qq', { mid: 'q1' }), 'q1');
    assert.equal(listenRoute.listenReportSongId('kugou', { hash: 'k1' }), 'k1');
    assert.equal(listenRoute.listenReportSongId('spotify', { spotifyId: 'spotify:track:x9' }), 'x9');
    assert.equal(listenRoute.listenReportSongId('netease', { songId: 'x2' }), '', 'netease ignores songId field');
    const bad = listenRoute.validateListenReport({});
    assert.equal(bad.eligible, false, 'empty body must fail eligibility');
    assert.equal(bad.songId, '', 'empty body yields empty songId');
    const good = listenRoute.validateListenReport({
      provider: 'netease',
      song: { id: 's1', type: 'song' },
      sessionId: 'session-123456',
      listenMs: 60000,
      durationMs: 70000,
    });
    assert.equal(good.eligible, true);
    const tooShort = listenRoute.validateListenReport({
      provider: 'netease',
      song: { id: 's1', type: 'song' },
      sessionId: 'short',
      listenMs: 60000,
      durationMs: 70000,
    });
    assert.equal(tooShort.eligible, false, 'sessionId < 8 chars must fail eligibility');

    console.log('OK listen-journal');
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
