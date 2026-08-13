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

// 12 family → 8 world
const expectedWorlds = {
  electronic: 'electronic',
  rock: 'rock-metal',
  metal: 'rock-metal',
  hiphop: 'hiphop',
  pop: 'prism',
  anime: 'prism',
  default: 'prism',
  folk: 'folk',
  classical: 'classical',
  jazz: 'jazz-soul',
  soul: 'jazz-soul',
  ambient: 'ambient',
};
for (const [family, world] of Object.entries(expectedWorlds)) {
  const song = family === 'default'
    ? { id: `map-${family}` }
    : { id: `map-${family}`, genre: family };
  const resolved = profile(song);
  assert.equal(resolved.family, family, `${family} family must resolve`);
  assert.equal(resolved.world, world, `${family} must map to ${world}`);
}

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
