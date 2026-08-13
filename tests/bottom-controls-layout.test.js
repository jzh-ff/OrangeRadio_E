'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
  path.resolve(__dirname, '..', 'public', 'css', 'index.css'),
  'utf8',
);
const html = fs.readFileSync(
  path.resolve(__dirname, '..', 'public', 'index.html'),
  'utf8',
);
const loader = fs.readFileSync(
  path.resolve(__dirname, '..', 'public', 'js', 'index-loader.js'),
  'utf8',
);
const fitModulePath = path.resolve(
  __dirname,
  '..',
  'public',
  'js',
  'modules',
  '01-scene',
  '05-modes-controls-fit.js',
);

function ruleBody(selectorPattern) {
  const match = css.match(new RegExp(`${selectorPattern}\\s*\\{([^}]+)\\}`, 'i'));
  assert.ok(match, `missing CSS rule for ${selectorPattern}`);
  return match[1];
}

test('bottom controls no longer use an overflow menu or measurement module', () => {
  assert.doesNotMatch(html, /id="modes-overflow-/i);
  assert.doesNotMatch(loader, /05-modes-controls-fit\.js/i);
  assert.equal(fs.existsSync(fitModulePath), false);
});

test('all three control clusters participate in one nowrap flex row', () => {
  const controlsRule = ruleBody(
    '#controls,\\s*body\\.simple-mode #controls,\\s*body\\.diy-mode #controls',
  );
  assert.match(controlsRule, /display:\s*flex/i);
  assert.match(controlsRule, /flex-wrap:\s*nowrap/i);

  const clusterRule = ruleBody('#controls > \\.control-cluster');
  assert.match(clusterRule, /display:\s*contents/i);
  assert.doesNotMatch(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content\s+minmax\(0,\s*1fr\)/i);
});

test('track info absorbs spare room while ordinary controls share one flex contract', () => {
  const trackRule = ruleBody('#controls \\.control-track');
  assert.match(trackRule, /flex:\s*1\s+1/i);
  assert.match(trackRule, /min-width:\s*0/i);

  const ordinaryRule = ruleBody(
    '#controls > \\.control-cluster > :not\\(\\.control-track\\):not\\(#prev-btn\\):not\\(#play-btn\\):not\\(#next-btn\\):not\\(#time-display\\)',
  );
  assert.match(ordinaryRule, /flex:\s*1\s+1/i);
  assert.match(ordinaryRule, /min-width:\s*0/i);
  assert.match(ordinaryRule, /max-width:\s*36px/i);
});

test('previous play and next remain the only emphasized playback controls', () => {
  const edgeRule = ruleBody('#controls #prev-btn,\\s*#controls #next-btn');
  const playRule = ruleBody('#controls #play-btn');
  assert.match(edgeRule, /flex:\s*0\s+1/i);
  assert.match(playRule, /flex:\s*0\s+1/i);
  assert.match(playRule, /width:\s*clamp\(/i);
});

test('responsive modes do not hide ordinary playback controls', () => {
  [
    '#controls-hide-btn',
    '#sleep-timer-control',
    '#eq-control',
    '#mini-player-btn',
    '#desktop-lyrics-bar-btn',
    '.fullscreen-toggle-btn',
  ].forEach((selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(
      css,
      new RegExp(`${escaped}[^,{]*\\{[^}]*display:\\s*none\\s*!important`, 'i'),
    );
  });
});
