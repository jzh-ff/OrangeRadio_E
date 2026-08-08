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

test('splash wordmark uses a clean Latin font with enough descender room', () => {
  const wordmark = ruleBody('\\.splash-wordmark');
  assert.match(wordmark, /font-family:\s*"Inter",\s*"Segoe UI",\s*Arial,\s*sans-serif/i);
  assert.match(wordmark, /line-height:\s*1\.06/i);
  assert.match(wordmark, /font-weight:\s*700/i);

  const layers = ruleBody('\\.splash-word-mine,\\s*\\.splash-word-radio');
  assert.match(layers, /padding:\s*\.09em\s+0\s+\.14em/i);
  assert.match(layers, /transform:\s*translate\(-50%,\s*-50%\)/i);
});

test('splash carries the OrangeSea sunset-and-tide brand system', () => {
  assert.match(html, /class="splash-brand-mark"/i);
  assert.match(html, /class="splash-brand-meta"/i);
  assert.match(html, /class="splash-mark-sun"/i);
  assert.match(html, /class="splash-fx"/i);
  assert.match(html, /class="splash-fx-orbits"/i);
  assert.match(html, /class="splash-fx-grid"/i);
  assert.match(html, /把日落调成你的频率/);
  assert.match(html, /TUNE THE SUNSET/i);

  assert.match(css, /@keyframes\s+splash-mark-sun-rise/i);
  assert.match(css, /@keyframes\s+splash-word-chroma-left/i);
  assert.match(css, /@keyframes\s+splash-word-chroma-right/i);
  assert.match(css, /@keyframes\s+splash-horizon-signal/i);
  assert.match(css, /@keyframes\s+splash-fx-sweep-across/i);
  assert.match(css, /@keyframes\s+splash-fx-grid-flow/i);
});

test('splash shader renders a cyber sunset sea instead of the old abstract loop', () => {
  assert.match(splashJs, /audioTide/);
  assert.match(splashJs, /energyRing/);
  assert.match(splashJs, /ribbonA/);
  assert.match(splashJs, /reflectionBand/);
  assert.match(splashJs, /reflectionCore/);
  assert.match(splashJs, /sunSurface/);
  assert.match(splashJs, /cometTail/);
  assert.match(splashJs, /shockRing/);
  assert.match(splashJs, /spectrumBar/);
  assert.doesNotMatch(splashJs, /animatedLoop/);
});
test('splash keeps the full sunset visible beside the brand', () => {
  const content = ruleBody('\\.splash-content');
  assert.match(content, /position:\s*absolute/i);
  assert.match(content, /left:\s*clamp\(58px,\s*8vw,\s*138px\)/i);
  assert.match(content, /align-items:\s*flex-start/i);

  const orbits = ruleBody('\\.splash-fx-orbits');
  assert.match(orbits, /left:\s*68%/i);
  assert.match(splashJs, /float sunX = aspect \* 0\.34/);
  assert.match(splashJs, /vec2 sunPos = vec2\(sunX,/);
  assert.match(splashJs, /reflectionBand = exp\(-abs\(p\.x - sunX\)/);
  assert.match(splashJs, /sunX2d = splashW \* 0\.68/);
});