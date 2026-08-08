'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
  path.resolve(__dirname, '..', 'public', 'css', 'index.css'),
  'utf8',
);

function ruleBody(selectorPattern) {
  const match = css.match(new RegExp(`${selectorPattern}\\s*\\{([^}]+)\\}`, 'i'));
  assert.ok(match, `missing CSS rule for ${selectorPattern}`);
  return match[1];
}

test('desktop bottom bar has enough wide-screen room for all three control clusters', () => {
  const desktopRule = ruleBody(
    'body\\.desktop-shell\\.diy-mode #bottom-bar,\\s*body\\.desktop-shell\\.diy-mode #bottom-bar\\.stage-mode',
  );
  assert.match(desktopRule, /width:\s*min\(1360px,\s*calc\(100vw\s*-\s*72px\)\)/i);

  const viewportWidth = 1440;
  const barWidth = Math.min(1360, viewportWidth - 72);
  const horizontalPadding = 24 * 2;
  const gridGaps = 18 * 2;
  const transportWidth = (5 * 36) + 58 + (5 * 13);
  const modesWidth = (8 * 36) + (7 * 13) + 13 + 86;
  const sideColumnWidth = (barWidth - horizontalPadding - gridGaps - transportWidth) / 2;

  assert.equal(transportWidth, 303);
  assert.equal(modesWidth, 478);
  assert.equal(sideColumnWidth, 486.5);
  assert.ok(
    sideColumnWidth >= modesWidth,
    'the right modes cluster must not overflow left into the transport cluster',
  );
});

test('narrower desktop widths shed low-priority items before clusters can overlap', () => {
  assert.match(
    css,
    /@media\s*\(max-width:\s*1420px\)\s*\{[^]*?#controls-hide-btn\s*\{[^}]*display:\s*none\s*!important/i,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*1320px\)\s*\{[^]*?#time-display\s*\{[^}]*display:\s*none/i,
  );
  assert.match(
    css,
    /#controls,\s*body\.simple-mode #controls,\s*body\.diy-mode #controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content\s+minmax\(0,\s*1fr\)/i,
  );
  assert.match(
    css,
    /\.control-cluster\.transport\s*\{[^}]*width:\s*max-content/i,
  );
});
