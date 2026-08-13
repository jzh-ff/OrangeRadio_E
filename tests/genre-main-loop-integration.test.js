'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const visualDir = path.join(root, 'public', 'js', 'modules', '02-visual');
const performancePath = path.join(visualDir, '20-genre-world-performance.js');
const loaderPath = path.join(root, 'public', 'js', 'index-loader.js');
const mainLoopPath = path.join(root, 'public', 'js', 'modules', '11-main-loop.js');
const modePath = path.join(root, 'public', 'js', 'modules', '10-shell', '09-genre-mode.js');
const transitionPath = path.join(visualDir, '19-genre-world-transition.js');
const worldDir = path.join(visualDir, 'genre-worlds');

assert.ok(fs.existsSync(performancePath), 'genre performance module must exist');

const qualityCalls = [];
const rendererCalls = [];
const sandbox = {
  console,
  fx: { performanceQuality: 'ultra' },
  adaptiveFrameLoadState: { level: 0, pressure: 0 },
  genreMode: true,
  innerWidth: 1600,
  innerHeight: 900,
  window: {
    innerWidth: 1600,
    innerHeight: 900,
    matchMedia: () => ({ matches: false }),
  },
  renderer: {
    ratio: 1,
    getPixelRatio() { return this.ratio; },
    setPixelRatio(value) { this.ratio = value; rendererCalls.push(['ratio', value]); },
    setSize(width, height, updateStyle) { rendererCalls.push(['size', width, height, updateStyle]); },
  },
  getRenderPixelRatio() { return 1.2; },
  setGenreWorldQuality(profile) { qualityCalls.push(JSON.parse(JSON.stringify(profile))); },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(performancePath, 'utf8'), sandbox, { filename: performancePath });

for (const api of [
  'resolveGenreWorldQualityProfile',
  'syncGenreWorldAdaptiveQuality',
  'resetGenreWorldAdaptiveQuality',
]) {
  assert.equal(typeof sandbox[api], 'function', `missing performance API ${api}`);
}

const profile = (quality, pressure, reduced = false) =>
  JSON.parse(JSON.stringify(sandbox.resolveGenreWorldQualityProfile(quality, pressure, reduced)));

for (const [quality, expected] of [
  ['eco', 'low'],
  ['balanced', 'medium'],
  ['high', 'high'],
  ['ultra', 'high'],
]) {
  assert.equal(profile(quality, 0).level, expected, `${quality} base level`);
}
assert.equal(profile('ultra', 1).level, 'medium');
assert.equal(profile('ultra', 2).level, 'low');
assert.equal(profile('balanced', 1).level, 'low');
assert.equal(profile('balanced', 2).level, 'low');
assert.equal(profile('eco', 1).level, 'low');
assert.equal(profile('eco', 2).level, 'low');

for (const pressure of [0, 1, 2]) {
  const resolved = profile('ultra', pressure);
  for (const key of [
    'particleDensity', 'detail', 'volumetricLight', 'postProcessing',
    'dprScale', 'maxParticles', 'maxLights', 'maxTextures',
  ]) assert.ok(Object.hasOwn(resolved, key), `profile must expose ${key}`);
}
const high = profile('ultra', 0);
const medium = profile('ultra', 1);
const low = profile('ultra', 2);
assert.ok(high.particleDensity > medium.particleDensity && medium.particleDensity > low.particleDensity);
assert.ok(high.detail > medium.detail && medium.detail > low.detail);
assert.equal(high.postProcessing, true);
assert.equal(medium.postProcessing, false, 'pressure level 1 immediately disables post processing');
assert.equal(low.volumetricLight, false, 'pressure level 2 disables volumetric light');
assert.ok(high.maxParticles > medium.maxParticles && medium.maxParticles > low.maxParticles);
const reduced = profile('ultra', 0, true);
assert.equal(reduced.postProcessing, false);
assert.equal(reduced.volumetricLight, false);
assert.ok(reduced.particleDensity < high.particleDensity);

assert.equal(sandbox.syncGenreWorldAdaptiveQuality(true), true);
assert.equal(qualityCalls.length, 1);
assert.deepEqual(rendererCalls, [['ratio', 1.2], ['size', 1600, 900, false]]);
assert.equal(sandbox.syncGenreWorldAdaptiveQuality(false), false, 'same signature is mutation-free');
assert.equal(qualityCalls.length, 1);
assert.equal(rendererCalls.length, 2);
sandbox.adaptiveFrameLoadState.level = 1;
sandbox.adaptiveFrameLoadState.pressure = 2.5;
assert.equal(sandbox.syncGenreWorldAdaptiveQuality(false), true);
assert.equal(qualityCalls.length, 2);
assert.ok(rendererCalls.at(-2)[1] < 1.2, 'pressure lowers DPR');
sandbox.adaptiveFrameLoadState.level = 0;
sandbox.adaptiveFrameLoadState.pressure = 4;
assert.equal(sandbox.syncGenreWorldAdaptiveQuality(false), true, 'raw pressure escalates immediately');
assert.equal(qualityCalls.at(-1).level, 'low');
sandbox.resetGenreWorldAdaptiveQuality();
assert.equal(rendererCalls.at(-2)[1], 1.2, 'reset restores normal DPR');

const loaderSource = fs.readFileSync(loaderPath, 'utf8');
const transitionIndex = loaderSource.indexOf('02-visual/19-genre-world-transition.js');
const performanceIndex = loaderSource.indexOf('02-visual/20-genre-world-performance.js');
const primitivesIndex = loaderSource.indexOf('02-visual/genre-worlds/00-shared-primitives.js');
assert.ok(transitionIndex < performanceIndex && performanceIndex < primitivesIndex,
  'performance module loads after transition and before primitives');

const mainSource = fs.readFileSync(mainLoopPath, 'utf8');
const genreBranchIndex = mainSource.indexOf('if (runGenreWorldMainLoopFrame(');
const presetRemapIndex = mainSource.indexOf('if (fx.preset >= 4)');
const ordinaryUniformIndex = mainSource.indexOf('uniforms.uVinylSpin.value');
assert.ok(genreBranchIndex > 0 && genreBranchIndex < presetRemapIndex,
  'genre branch must run before ordinary preset/DJ visual remapping');
assert.ok(mainSource.indexOf('uniforms.uTime.value += dt') > genreBranchIndex);
assert.ok(mainSource.indexOf('pointerParallax.x +=') > genreBranchIndex);
for (const call of [
  'syncGenreModeTrack(false)', 'advanceGenreWorldTransition(now)',
  'syncGenreModeHud(false)', 'updateGenreHudVisibility(now)',
  'syncGenreWorldAdaptiveQuality(false)', 'tickGenreWorld(genreFrame)',
  'renderer.render(scene, camera)',
]) assert.ok(mainSource.includes(call), `main loop missing ${call}`);
assert.match(mainSource, /function buildGenreWorldFrame[\s\S]*?time:[\s\S]*?dt:[\s\S]*?bass:[\s\S]*?low:[\s\S]*?mid:[\s\S]*?high:[\s\S]*?energy:[\s\S]*?beat:[\s\S]*?frequencyData:[\s\S]*?timeDomainData:[\s\S]*?lyrics:/);
assert.match(mainSource, /function runGenreWorldMainLoopFrame[\s\S]*?tickGenreWorld\(genreFrame\)[\s\S]*?renderer\.render\(scene, camera\)[\s\S]*?sampleAdaptiveFrameCost[\s\S]*?return true;/);
assert.ok(mainSource.includes('findStageLyricIndexAtTime'));
assert.ok(mainSource.includes('getAdjustedLyricPlaybackTime'));
assert.match(mainSource, /genreTrack:\s*createFrameGate/);
assert.match(mainSource, /genreHud:\s*createFrameGate/);
assert.match(mainSource, /genreQuality:\s*createFrameGate/);
assert.doesNotMatch(mainSource.slice(genreBranchIndex, ordinaryUniformIndex), /updateStageLyrics3D|updateRipples|updateCinema|updateConcertStage|OrangeseaSonicTopography\.update/);
assert.doesNotMatch(mainSource.match(/function isMainSceneCoveredByOverlay\(\)[\s\S]*?\n\}/)[0], /genreMode/);

const helperStart = mainSource.indexOf('// GENRE_WORLD_FRAME_HELPERS_BEGIN');
const helperEnd = mainSource.indexOf('// GENRE_WORLD_FRAME_HELPERS_END');
const mainCalls = [];
let clock = 100;
const mainVm = {
  console,
  genreMode: true,
  fx: { preset: 0 },
  bass: 0.7,
  mid: 0.4,
  treble: 0.2,
  audioEnergy: 0.8,
  beatPulse: 1,
  frequencyData: new Uint8Array([1, 2]),
  timeDomainData: new Uint8Array([128, 129]),
  audio: { currentTime: 12 },
  lyricsLines: [{ text: '前句' }, { text: '当前', translation: 'Current', seekId: 'line-2' }],
  getAdjustedLyricPlaybackTime(time) { return time + 0.25; },
  findStageLyricIndexAtTime(time) { assert.equal(time, 12.25); return 1; },
  mainFrameGates: { genreTrack: {}, genreHud: {}, genreQuality: {} },
  targetMainGenreTrackFps() { return 6; },
  targetMainGenreHudFps() { return 12; },
  targetMainGenreQualityFps() { return 8; },
  consumeFrameGate(gate, now, dt, fps, force, name) {
    mainCalls.push(['gate', name, fps]);
    return dt;
  },
  syncGenreModeTrack(force) { mainCalls.push(['track', force]); },
  advanceGenreWorldTransition(now) { mainCalls.push(['transition', now]); },
  syncGenreModeHud(force) { mainCalls.push(['hud', force]); },
  updateGenreHudVisibility(now) { mainCalls.push(['visibility', now]); },
  syncGenreWorldAdaptiveQuality(force) { mainCalls.push(['quality', force]); },
  tickGenreWorld(frame) { mainCalls.push(['tick', JSON.parse(JSON.stringify(frame))]); },
  renderer: { render(scene, camera) { mainCalls.push(['render', scene, camera]); } },
  scene: { id: 'scene' },
  camera: { id: 'camera' },
  performance: { now() { clock += 1; return clock; } },
  sampleAdaptiveFrameCost(cost, fps) {
    mainCalls.push(['sample', cost, fps]);
    return { avgMs: cost, level: 1 };
  },
  renderPerfState: { targetFps: 60, displayHz: 60 },
  updateRipples() { mainCalls.push(['ordinary']); },
  updateCinema() { mainCalls.push(['ordinary']); },
  updateStageLyrics3D() { mainCalls.push(['ordinary']); },
};
vm.createContext(mainVm);
vm.runInContext(mainSource.slice(helperStart, helperEnd), mainVm);
const vmFrame = JSON.parse(JSON.stringify(mainVm.buildGenreWorldFrame(2500, 0.016)));
assert.deepEqual(vmFrame, {
  time: 2.5,
  dt: 0.016,
  bass: 0.7,
  low: 0.7,
  mid: 0.4,
  high: 0.2,
  energy: 0.8,
  beat: 1,
  frequencyData: { 0: 1, 1: 2 },
  timeDomainData: { 0: 128, 1: 129 },
  lyrics: { text: '当前', translation: 'Current', seekId: 'line-2' },
});
mainVm.lyricsLines = [];
assert.deepEqual(
  JSON.parse(JSON.stringify(mainVm.buildGenreWorldFrame(2600, 0.02).lyrics)),
  { text: '', translation: '', seekId: -1 },
);
mainVm.lyricsLines = [{ text: '前句' }, { text: '当前', translation: 'Current', seekId: 'line-2' }];
const runForPreset = (preset) => {
  mainVm.fx.preset = preset;
  const before = mainCalls.length;
  assert.equal(mainVm.runGenreWorldMainLoopFrame(2500, 0.016, 90, null), true);
  return mainCalls.slice(before);
};
const presetZeroCalls = runForPreset(0);
const presetFiveCalls = runForPreset(5);
const presetZeroFrame = presetZeroCalls.find((call) => call[0] === 'tick')[1];
const presetFiveFrame = presetFiveCalls.find((call) => call[0] === 'tick')[1];
assert.deepEqual(presetFiveFrame, presetZeroFrame, 'genre frame must ignore ordinary fx.preset remapping');
for (const expected of ['track', 'transition', 'hud', 'visibility', 'quality', 'tick', 'render', 'sample']) {
  assert.ok(presetZeroCalls.some((call) => call[0] === expected), `VM genre branch missing ${expected}`);
}
assert.equal(mainCalls.some((call) => call[0] === 'ordinary'), false,
  'genre branch must not invoke ordinary stage updates');

const modeSource = fs.readFileSync(modePath, 'utf8');
assert.match(modeSource, /syncGenreWorldAdaptiveQuality\(true\)/);
assert.ok((modeSource.match(/resetGenreWorldAdaptiveQuality\(\)/g) || []).length >= 2,
  'exit and failed startup both reset adaptive quality');

for (const sourcePath of [
  modePath,
  transitionPath,
  ...fs.readdirSync(worldDir).filter((name) => name.endsWith('.js')).map((name) => path.join(worldDir, name)),
]) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.doesNotMatch(source, /requestAnimationFrame|MutationObserver|ResizeObserver/,
    `${path.basename(sourcePath)} must not add a private loop/observer`);
}

console.log('OK genre quality, DPR, main-loop gate, lifecycle, and scheduler contracts');
