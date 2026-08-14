'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'index.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const splashJs = fs.readFileSync(
  path.join(root, 'public', 'js', 'modules', '10-shell', '03-splash.js'),
  'utf8',
);

function ruleBody(selectorPattern) {
  const match = css.match(new RegExp(`${selectorPattern}\\s*\\{([^}]+)\\}`, 'i'));
  assert.ok(match, `missing CSS rule for ${selectorPattern}`);
  return match[1];
}

test('splash wordmark uses a serif OrangeRadio lockup', () => {
  const wordmark = ruleBody('\\.splash-wordmark');
  assert.match(wordmark, /font-family:\s*"Playfair Display"/i);
  assert.match(wordmark, /font-weight:\s*900/i);
  assert.match(wordmark, /line-height:\s*1\.02/i);
  assert.match(html, />OrangeRadio</);
  assert.match(html, /Sweet memory/);
});

test('splash is a looping video player overlay instead of the sunset shader', () => {
  assert.match(html, /id="splash-video"/i);
  assert.match(html, /src="assets\/splash\/splash\.mp4"/i);
  assert.match(html, /poster="assets\/splash\/splash-poster\.jpg"/i);
  assert.match(html, /id="splash-play-btn"/i);
  assert.match(html, /id="splash-album-art"/i);
  assert.match(html, /class="splash-album-disc"/i);
  assert.match(html, /class="splash-waveform"/i);
  assert.match(html, /把日落调成你的频率/);
  assert.doesNotMatch(html, /id="splash-canvas"/i);
  assert.doesNotMatch(html, /splash-fx-orbits/i);
  assert.doesNotMatch(html, /class="splash-brand-mark"/i);
  assert.doesNotMatch(html, /TUNE THE SUNSET/i);

  assert.match(css, /@keyframes\s+splash-album-spin/i);
  assert.match(css, /@keyframes\s+splash-wave/i);
  assert.doesNotMatch(css, /@keyframes\s+splash-mark-sun-rise/i);
  assert.doesNotMatch(css, /@keyframes\s+splash-word-chroma-left/i);
});

test('splash album uses the video poster and the play button is the only control', () => {
  const albumArt = ruleBody('\\.splash-album-art');
  assert.match(albumArt, /border-radius:\s*50%/i);
  assert.match(albumArt, /object-fit:\s*cover/i);

  const play = ruleBody('\\.splash-play-btn');
  assert.match(play, /pointer-events:\s*auto/i);
  assert.match(play, /cursor:\s*pointer/i);

  const content = ruleBody('\\.splash-content');
  assert.match(content, /position:\s*absolute/i);
  assert.match(content, /pointer-events:\s*none/i);
});

test('splash ships a bundled looping mp4 and first-frame poster', () => {
  assert.equal(fs.existsSync(path.join(root, 'public', 'assets', 'splash', 'splash.mp4')), true);
  assert.equal(fs.existsSync(path.join(root, 'public', 'assets', 'splash', 'splash-poster.jpg')), true);
});

test('DIY console can replace the splash mp4 without touching wallpaper paths', () => {
  assert.match(html, /id="splash-video-panel"/);
  assert.match(html, /id="splash-video-input"[^>]*type="file"[^>]*accept="\.mp4,video\/mp4"/);
  assert.match(html, /id="splash-video-clear-btn"/);
  assert.match(splashJs, /SPLASH_VIDEO_DB_NAME\s*=\s*['"]orangesea-splash-video-v1['"]/);
  assert.match(splashJs, /SPLASH_VIDEO_META_KEY\s*=\s*['"]orangesea-splash-video-meta-v1['"]/);
  assert.match(splashJs, /function openSplashVideoPicker/);
  assert.match(splashJs, /function handleSplashVideoFile/);
  assert.match(splashJs, /function clearSplashVideo/);
  assert.match(splashJs, /assets\/splash\/splash\.mp4/);
  assert.match(splashJs, /下次启动生效/);
  assert.doesNotMatch(splashJs, /openCustomBackgroundDb|CUSTOM_BG_|wallpaper-engine|\.pak/);
});

test('splash script captures the first frame and enters on play', () => {
  assert.match(splashJs, /function captureSplashAlbumFrame/);
  assert.match(splashJs, /function stopSplashVideo/);
  assert.match(splashJs, /getElementById\('splash-play-btn'\)/);
  assert.match(splashJs, /markSplashReadyToEnter\(\)/);
  assert.doesNotMatch(splashJs, /initMineradioSplashWebgl/);
  assert.doesNotMatch(splashJs, /playMineradioIntroSound/);
  assert.doesNotMatch(splashJs, /setTimeout\(markSplashReadyToEnter,\s*1500\)/);
  assert.doesNotMatch(splashJs, /audioTide/);
});
