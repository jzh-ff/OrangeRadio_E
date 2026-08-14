'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modulePath = path.join(
  __dirname,
  '..',
  'public',
  'js',
  'modules',
  '02-visual',
  '16-genre-resolve.js',
);

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(modulePath, 'utf8'), sandbox, { filename: modulePath });

assert.equal(typeof sandbox.resolveGenreProfile, 'function', 'must expose resolveGenreProfile(song)');

function profile(song) {
  return JSON.parse(JSON.stringify(sandbox.resolveGenreProfile(song)));
}

// 中英文显式标签与英文 token 边界
assert.equal(profile({ id: 'zh-rock', genre: '华语摇滚' }).family, 'rock');
assert.equal(profile({ id: 'zh-electronic', genre: '电子舞曲' }).family, 'electronic');
assert.equal(profile({ id: 'popular', genre: 'popular music' }).family, 'default');
assert.equal(profile({ id: 'independent', genre: 'independent music' }).family, 'default');
assert.equal(profile({ id: 'pop', genre: 'mainstream pop' }).family, 'pop');
assert.equal(profile({ id: 'indie', genre: 'indie rock' }).family, 'rock');

// 错误艺人锚点不能永久覆盖；Taylor Swift 无显式标签时不应被判为 folk
const taylor = profile({ id: 'taylor', artist: 'Taylor Swift', name: 'Anti-Hero' });
assert.notEqual(taylor.family, 'folk');
assert.equal(taylor.source, 'default');

// 来源与置信度可区分
const explicit = profile({ id: 'explicit', genre: 'jazz' });
const podcast = profile({ id: 'podcast', type: 'podcast', category: '人文民谣' });
const keyword = profile({ id: 'keyword', artist: 'Miles Davis', name: 'So What' });
const fallback = profile({ id: 'fallback', artist: 'Unknown Artist', name: 'Untitled' });
assert.equal(explicit.source, 'genre');
assert.equal(podcast.source, 'category');
assert.equal(keyword.source, 'keyword');
assert.equal(fallback.source, 'default');
assert.ok(explicit.confidence > podcast.confidence);
assert.ok(podcast.confidence > keyword.confidence);
assert.ok(keyword.confidence > fallback.confidence);
assert.ok(fallback.confidence <= 0.25, 'default confidence must remain low');
assert.equal(typeof explicit.version, 'string');
assert.ok(explicit.version.length > 0);

// 12 family → 8 world；未识别 default 不固定 prism，按曲目身份稳定随机
const expectedWorlds = {
  electronic: 'electronic',
  rock: 'rock-metal',
  metal: 'rock-metal',
  hiphop: 'hiphop',
  pop: 'prism',
  anime: 'prism',
  folk: 'folk',
  classical: 'classical',
  jazz: 'jazz-soul',
  soul: 'jazz-soul',
  ambient: 'ambient',
};
const worldIds = sandbox.GENRE_WORLD_IDS;
assert.ok(Array.isArray(worldIds) && worldIds.length === 8);
for (const [family, world] of Object.entries(expectedWorlds)) {
  const resolved = profile({ id: `map-${family}`, genre: family });
  assert.equal(resolved.family, family, `${family} family must resolve`);
  assert.equal(resolved.world, world, `${family} must map to ${world}`);
}
const unidentified = profile({ id: 'map-default', artist: 'Unknown Artist', name: 'Untitled' });
assert.equal(unidentified.family, 'default');
assert.equal(unidentified.source, 'default');
assert.ok(worldIds.includes(unidentified.world), 'unidentified world must be one of eight');
const unidentifiedAgain = profile({ id: 'map-default', artist: 'Unknown Artist', name: 'Untitled' });
assert.equal(unidentifiedAgain.world, unidentified.world, 'same unidentified song must keep the same world');
const spread = new Set();
for (let i = 0; i < 48; i++) {
  spread.add(profile({ id: `spread-${i}`, artist: 'Unknown', name: `Track ${i}` }).world);
}
assert.ok(spread.size >= 4, 'unidentified songs should spread across worlds');

// 流媒体无 genre 时：艺人数组、标题风格词、专辑风格词仍能离开 default
const artistsArrayJazz = profile({ id: 'artists-array', artists: [{ name: 'Miles Davis' }] });
assert.equal(artistsArrayJazz.family, 'jazz');
assert.equal(artistsArrayJazz.source, 'keyword');
const titleJazz = profile({ id: 'title-jazz', name: 'Jazz Night Live' });
assert.equal(titleJazz.family, 'jazz');
assert.equal(titleJazz.source, 'keyword');
assert.equal(titleJazz.world, 'jazz-soul');
const albumMetal = profile({ id: 'album-metal', album: 'Metal Covers' });
assert.equal(albumMetal.family, 'metal');
assert.equal(albumMetal.world, 'rock-metal');
const singerFolk = profile({ id: 'singer-folk', singer: '赵雷', title: '成都' });
assert.equal(singerFolk.family, 'folk');
assert.equal(singerFolk.world, 'folk');
const pianoTitle = profile({ id: 'piano-title', name: '夜的钢琴曲' });
assert.equal(pianoTitle.family, 'classical');

// 「华语/国语/情歌」不能再把整库推进 pop → prism
const mandopopCatchall = profile({ id: 'catchall-huayu', album: '华语金曲精选', artist: 'Unknown Artist' });
assert.equal(mandopopCatchall.family, 'default');
assert.ok(worldIds.includes(mandopopCatchall.world), 'unidentified mandopop catchall still picks a world');
assert.equal(mandopopCatchall.source, 'default');
const explicitMandopop = profile({ id: 'explicit-huayu', genre: '华语' });
assert.equal(explicitMandopop.family, 'pop');
assert.equal(explicitMandopop.source, 'genre');

// 流行艺人仍进棱镜；未识别英文流行仍保持 default，不能误判 folk
assert.equal(profile({ id: 'jay', artist: '周杰伦', name: '晴天' }).family, 'pop');
assert.equal(profile({ id: 'jay', artist: '周杰伦', name: '晴天' }).world, 'prism');

// 缓存随身份和解析输入签名变化：异步补 genre 后重算，同名不同曲不串缓存
const asyncSong = { id: 'async-song', artist: 'Unknown', name: 'Shared Name' };
assert.equal(profile(asyncSong).family, 'default');
asyncSong.genre = '古典';
assert.equal(profile(asyncSong).family, 'classical');

const sameNameRock = { id: 'track-rock', name: 'Same Name', genre: 'rock' };
const sameNameJazz = { id: 'track-jazz', name: 'Same Name', genre: 'jazz' };
assert.equal(profile(sameNameRock).family, 'rock');
assert.equal(profile(sameNameJazz).family, 'jazz');

// 旧 visualGenre 缓存可迁移，但后补显式 genre 必须覆盖旧值
const legacyVisualGenre = { id: 'legacy-visual-genre', visualGenre: 'rock' };
const migratedLegacyProfile = profile(legacyVisualGenre);
assert.equal(migratedLegacyProfile.family, 'rock');
assert.equal(migratedLegacyProfile.world, 'rock-metal');
assert.equal(migratedLegacyProfile.source, 'legacy');
legacyVisualGenre.genre = '爵士';
const refreshedLegacyProfile = profile(legacyVisualGenre);
assert.equal(refreshedLegacyProfile.family, 'jazz');
assert.equal(refreshedLegacyProfile.source, 'genre');

// 播客分类候选应依次尝试，不能被前面的未知非空字段短路
const podcastCategoryFallback = profile({
  id: 'podcast-category-fallback',
  type: 'podcast',
  radioCategory: 'Unclassified Talk',
  category: '爵士音乐',
  album: '古典音乐',
});
assert.equal(podcastCategoryFallback.family, 'jazz');
assert.equal(podcastCategoryFallback.source, 'category');
const podcastAlbumFallback = profile({
  id: 'podcast-album-fallback',
  type: 'podcast',
  radioCategory: 'Unclassified Talk',
  category: 'Unknown Channel',
  album: '古典音乐',
});
assert.equal(podcastAlbumFallback.family, 'classical');

// 旧入口与展示辅助保持兼容
assert.equal(sandbox.inferGenreFamily({ id: 'compat', genre: 'soul' }), 'soul');
assert.equal(sandbox.genreFamilyLabel('ambient'), '氛围');
assert.equal(sandbox.songGenreDisplayText({ id: 'display-raw', genre: '爵士' }), '爵士');
assert.equal(sandbox.songGenreDisplayText({ id: 'display-inferred', artist: 'Miles Davis' }), '爵士');

console.log('OK genre resolve profiles, boundaries, cache signatures, and compatibility');
