'use strict';

/*
 * 听歌报告聚合测试
 * ----------------------------------------------------------------------------
 * vm 沙箱加载 22-listen-report.js 的纯函数 buildListenReport：
 * 周期窗口过滤、Top 歌曲/歌手排序、热力图/时段/平台聚合、空数据兜底。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modulePath = path.join(__dirname, '..', 'public', 'js', 'modules', '05-playback', '22-listen-report.js');

const sandbox = {
  console,
  escapeHtmlSafe: (s) => String(s == null ? '' : s).replace(/[<>"'&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c])),
  listenStatsState: { history: [], songs: {}, artists: {}, updatedAt: 0 },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(modulePath, 'utf8'), sandbox, { filename: modulePath });

const now = Date.now();
const dayMs = 24 * 3600 * 1000;

// 造 40 天前的旧记录（月度窗口应过滤）与近期记录
const stats = {
  history: [
    { key: 'n:old', provider: 'netease', id: 'old', name: '老歌', artist: '歌手A', source: 'netease', playedAt: now - 40 * dayMs, listenMs: 120000, completed: true },
    { key: 'n:s1', provider: 'netease', id: 's1', name: '晴天', artist: '周杰伦 / 合唱A', source: 'netease', playedAt: now - 2 * dayMs, listenMs: 240000, completed: true },
    { key: 'n:s1', provider: 'netease', id: 's1', name: '晴天', artist: '周杰伦 / 合唱A', source: 'netease', playedAt: now - 1 * dayMs, listenMs: 30000, completed: false },
    { key: 'q:q1', provider: 'qq', id: 'q1', name: '七里香', artist: '周杰伦', source: 'qq', playedAt: now - 5 * 3600 * 1000, listenMs: 180000, completed: true },
    { key: 'k:k1', provider: 'kugou', id: 'k1', name: '夜曲', artist: '周杰伦', source: 'kugou', playedAt: now - 3 * 3600 * 1000, listenMs: 90000, completed: true },
  ],
  songs: {},
  artists: {},
  updatedAt: now,
};

// ---- 月度窗口：过滤 40 天前 ----
const month = sandbox.buildListenReport(stats, 'month');
assert.equal(month.period, 'month');
assert.equal(month.plays, 4, 'month must exclude the 40-day-old record');
assert.equal(month.totalListenMs, 240000 + 30000 + 180000 + 90000, 'total listen ms must sum in-window records');
assert.equal(month.completed, 3);
assert.equal(month.uniqueSongs, 3, 'two s1 records are one unique song');

// ---- Top 歌曲：按 plays 排序 ----
assert.equal(month.topSongs.length, 3);
assert.equal(month.topSongs[0].name, '晴天', 'most played must rank first');
assert.equal(month.topSongs[0].plays, 2);
assert.equal(month.topSongs[1].name, '七里香');

// ---- Top 歌手：多歌手拆分聚合 ----
assert.equal(month.topArtists[0].name, '周杰伦', 'artist split across songs must aggregate');
assert.equal(month.topArtists[0].plays, 4, '周杰伦: 晴天x2 + 七里香 + 夜曲');
assert.ok(month.topArtists.some((a) => a.name === '合唱A'), 'slash-separated artist must split');

// ---- 时段分布 ----
const hour = new Date(now - 2 * dayMs).getHours();
assert.equal(month.hourBuckets[hour] >= 1, true, 'recent record hour must be counted');
assert.equal(month.hourBuckets.reduce((a, b) => a + b, 0), 4, 'all in-window records land in hour buckets');

// ---- 平台分布 ----
assert.equal(month.platformMap.netease, 2);
assert.equal(month.platformMap.qq, 1);
assert.equal(month.platformMap.kugou, 1);

// ---- 全年窗口：包含旧记录 ----
const year = sandbox.buildListenReport(stats, 'year');
assert.equal(year.plays, 5, 'year must include the 40-day-old record');
assert.equal(year.topSongs[0].plays, 2);

// ---- 全部窗口 ----
const all = sandbox.buildListenReport(stats, 'all');
assert.equal(all.plays, 5);

// ---- 空数据兜底 ----
const empty = sandbox.buildListenReport({ history: [], songs: {} }, 'month');
assert.equal(empty.plays, 0);
assert.equal(empty.topSongs.length, 0);
assert.equal(empty.totalListenMs, 0);
assert.equal(empty.hourBuckets.length, 24);

console.log('OK listen-report');
