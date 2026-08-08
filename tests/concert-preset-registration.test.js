'use strict';

/*
 * 演唱会现场 (Concert Live) 视觉预设注册守卫
 * ----------------------------------------------------------------------------
 * 断言 8 号预设完整注册:
 * - presetMeta / presetIcons / presetDisplayOrder 均含 8 号 (第 9 个预设)
 * - 核心常量: MAX=8, CONCERT=8, SONIC=7 不变, LEGACY 哨兵迁移到 9
 * - normalizeSavedVisualPresetIndex 兼容旧存档 (9 → 音域回响 7)
 * - shader 含 uPreset < 8.5 灯海分支
 * - 聚光灯模块已注册到 index-loader, 主循环含帧门控
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const corePath = path.join(root, 'public', 'js', 'modules', '00-state', '00-core-stores.js');
const archivePath = path.join(root, 'public', 'js', 'modules', '07-fx', '00-preset-archive-data.js');
const pointerPath = path.join(root, 'public', 'js', 'modules', '02-visual', '00-pointer-cover-particles.js');
const concertStagePath = path.join(root, 'public', 'js', 'modules', '07-fx', '10-concert-live-stage.js');
const mainLoopPath = path.join(root, 'public', 'js', 'modules', '11-main-loop.js');
const orbitCameraPath = path.join(root, 'public', 'js', 'modules', '01-scene', '01-orbit-free-camera.js');
const loaderPath = path.join(root, 'public', 'js', 'index-loader.js');

// ---- 沙箱加载核心常量与预设元数据 ----
// core-stores.js 顶层调用了后续模块的读取函数, 此处打桩返回默认值
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  readAudioFadePreference() { return { fadeInMs: 800, fadeOutMs: 800 }; },
  readDiyModePreference() { return false; },
  readCustomCoverMap() { return {}; },
  readCustomLyricMap() { return {}; },
  readCustomLyricPrefs() { return {}; },
  readCustomLyricFonts() { return {}; },
  readLocalBeatMapCache() { return {}; },
  readLocalBeatPrefs() { return {}; },
  readPlaybackQualityPreference() { return {}; },
  getProviderPlaybackQuality() { return 'standard'; },
  readAudioOutputDevicePreference() { return ''; },
  readAudioOutputMirrorPreference() { return []; },
  readAudioInputBridgePreference() { return null; },
  loadListenStatsState() { return {}; },
  registerSavedCustomLyricFonts() {},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(corePath, 'utf8'), sandbox, { filename: corePath });
vm.runInContext(fs.readFileSync(archivePath, 'utf8'), sandbox, { filename: archivePath });

// ---- 预设索引常量 ----
assert.equal(sandbox.MAX_VISUAL_PRESET_INDEX, 8, 'MAX_VISUAL_PRESET_INDEX must be 8');
assert.equal(sandbox.CONCERT_PRESET_INDEX, 8, 'CONCERT_PRESET_INDEX must be 8');
assert.equal(sandbox.SONIC_PRESET_INDEX, 7, 'SONIC_PRESET_INDEX must stay 7');
assert.equal(sandbox.LEGACY_REMOVED_VISUAL_PRESET_INDEX, 9, 'legacy removed-preset sentinel must move to 9');

// ---- 旧存档归一化: 8 归新预设, 9 (旧哨兵) 归音域回响, 越界钳制 ----
assert.equal(sandbox.normalizeSavedVisualPresetIndex(8), 8, 'saved 8 must map to Concert Live preset 8');
assert.equal(sandbox.normalizeSavedVisualPresetIndex(9), 7, 'saved 9 (legacy sentinel) must map to Sonic preset 7');
assert.equal(sandbox.normalizeSavedVisualPresetIndex(99), 8, 'out-of-range must clamp to max 8');
assert.equal(sandbox.normalizeSavedVisualPresetIndex(-5), 0, 'negative must clamp to 0');
assert.equal(sandbox.normalizeSavedVisualPresetIndex(undefined), 0, 'undefined must default to 0');

// ---- presetMeta / presetIcons / presetDisplayOrder ----
assert.equal(sandbox.presetMeta.length, 9, 'presetMeta must register 9 presets');
assert.equal(sandbox.presetIcons.length, 9, 'presetIcons must register 9 icons');
const concert = sandbox.presetMeta[8];
assert.equal(concert.name, '演唱会现场', 'preset 8 name must be 演唱会现场');
assert.match(concert.nameHtml, /Concert Live/, 'preset 8 nameHtml must carry Concert Live suffix');
assert.match(concert.desc, /聚光灯/, 'preset 8 desc must mention 聚光灯');
assert.equal(
  sandbox.presetDisplayOrder.slice(0, 4).join(','),
  '0,6,7,8',
  'presetDisplayOrder must place Concert Live right after Sonic',
);
assert.ok(sandbox.presetDisplayOrder.includes(8), 'presetDisplayOrder must include preset 8');

// ---- shader 灯海分支 ----
const pointerText = fs.readFileSync(pointerPath, 'utf8');
assert.match(pointerText, /uPreset < 8\.5/, 'particle vertex shader must add the concert glowstick branch');
assert.match(pointerText, /hsv2rgb/, 'vertex shader must add the hsv2rgb helper');
assert.match(pointerText, /CONCERT_PRESET_INDEX[\s\S]{0,40}return 0/, 'background star river must hide on Concert preset');

// ---- 聚光灯层模块 ----
assert.ok(fs.existsSync(concertStagePath), '10-concert-live-stage.js must exist');
const concertStageText = fs.readFileSync(concertStagePath, 'utf8');
assert.match(concertStageText, /function updateConcertStage/, 'concert stage module must expose updateConcertStage');
assert.match(concertStageText, /CONCERT_PRESET_INDEX/, 'concert stage must key off CONCERT_PRESET_INDEX');
assert.match(concertStageText, /AdditiveBlending/, 'spotlight beams must use additive blending');

// ---- index-loader 注册 ----
const loaderText = fs.readFileSync(loaderPath, 'utf8');
assert.match(loaderText, /07-fx\/10-concert-live-stage\.js/, 'index-loader must register the concert stage module');

// ---- 主循环帧门控 ----
const mainLoopText = fs.readFileSync(mainLoopPath, 'utf8');
assert.match(mainLoopText, /mainFrameGates\.concertStage/, 'main loop must gate concert stage updates');
assert.match(mainLoopText, /updateConcertStage\(/, 'main loop must call updateConcertStage');

// ---- 相机基线 ----
const orbitCameraText = fs.readFileSync(orbitCameraPath, 'utf8');
assert.match(orbitCameraText, /p === 8\) return \{ theta: 0\.0, phi: 0\.15, radius: 7\.8 \}/, 'orbit camera must add Concert baseline');

console.log('OK concert-preset-registration');
