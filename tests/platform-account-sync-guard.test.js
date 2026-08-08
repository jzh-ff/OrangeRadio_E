'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
// 拆分后：后端逻辑分布在 server.js 装配层 + server/routes/* + server/handlers/*。
// 这里聚合全部后端源码文本，使路由/能力断言不受拆分影响。
const serverFiles = ['server.js']
  .concat(fs.readdirSync(path.join(root, 'server', 'routes')).map(f => path.join('server', 'routes', f)))
  .concat(fs.readdirSync(path.join(root, 'server', 'handlers')).map(f => path.join('server', 'handlers', f)))
  .concat(['server/context.js', 'server/utils.js']);
const server = serverFiles
  .map(f => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n');
const listenStats = fs.readFileSync(
  path.join(root, 'public', 'js', 'modules', '05-playback', '02-listen-stats.js'),
  'utf8'
);
const accountActions = fs.readFileSync(
  path.join(root, 'public', 'js', 'modules', '05-playback', '06-track-detail-lyrics-actions.js'),
  'utf8'
);
const playlistDetail = fs.readFileSync(
  path.join(root, 'public', 'js', 'modules', '06-lyrics', '02-playlist-detail.js'),
  'utf8'
);

assert(
  /snapshot\.provider\s*\|\|\s*snapshot\.sourceKey\s*\|\|\s*snapshot\.resolvedPlaybackProvider/.test(listenStats),
  'listen reports must follow the song account provider before a matched playback source'
);
assert(
  /body\.provider\s*\|\|\s*song\.provider\s*\|\|\s*song\.source\s*\|\|\s*song\.sourceKey\s*\|\|\s*song\.type\s*\|\|\s*song\.resolvedPlaybackProvider/.test(server),
  'the server must preserve account-provider affinity for listen reports'
);
assert(
  /fetch\('\/api\/listen\/report'/.test(listenStats)
    && /orangesea-listen-rollup-v2/.test(listenStats)
    && /sessionId:\s*createListenSessionId\(\)/.test(listenStats),
  'local rollup and idempotent listen reporting must stay connected'
);

[
  '/api/spotify/song/like',
  '/api/spotify/playlist/add-song',
  '/api/qishui/song/like',
  '/api/qishui/playlist/add-song',
  '/api/qishui/song/comments',
  '/api/album/subscribe',
  '/api/playlist/subscribe',
  '/api/song/comments',
].forEach(endpoint => {
  assert(server.includes(endpoint), `server route missing: ${endpoint}`);
});

assert(
  /accountDurationSync:\s*'submitted_unverified'/.test(server)
    && /accountDurationSync:\s*'unsupported'/.test(server)
    && /PLATFORM_DURATION_WRITE_UNAVAILABLE/.test(server),
  'listen-time capability responses must not overstate platform support'
);
assert(
  /provider\s*\+\s*':'\s*\+\s*id/.test(accountActions),
  'liked-state identity must remain provider scoped'
);
assert(
  /\/api\/spotify\/playlist\/collect/.test(playlistDetail)
    && /\/api\/qishui\/playlist\/collect/.test(playlistDetail)
    && /\/api\/playlist\/subscribe/.test(playlistDetail),
  'playlist collection must remain wired for each supported provider'
);

console.log('[OK] Platform account actions, provider-affine listen reports, and truthful duration-sync boundaries are guarded.');
