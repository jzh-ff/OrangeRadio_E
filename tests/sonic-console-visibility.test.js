'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const consolePath = path.join(root, 'public', 'js', 'modules', '07-fx', '09-console-workspace.js');
const performancePath = path.join(root, 'public', 'js', 'modules', '07-fx', '05-fx-panel-performance.js');
const consoleSource = fs.readFileSync(consolePath, 'utf8');
const performanceSource = fs.readFileSync(performancePath, 'utf8');

function namedFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected function ${name}()`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}()`);
}

function makeGroup() {
  const classes = new Set();
  const attributes = {};
  return {
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    classes,
    attributes,
  };
}

test('all Sonic-only console groups hide and restore together', () => {
  assert.match(consoleSource, /motion:sonic-terrain/);
  assert.match(consoleSource, /motion:sonic-audio/);
  assert.match(consoleSource, /motion:sonic-blocks/);

  const groups = {
    'motion:sonic-terrain': makeGroup(),
    'motion:sonic-audio': makeGroup(),
    'motion:sonic-blocks': makeGroup(),
  };
  const sandbox = {
    SONIC_FX_CONSOLE_GROUP_KEYS: Object.keys(groups),
    fxConsoleGroups: groups,
  };
  vm.runInNewContext(
    `${namedFunctionSource(consoleSource, 'setSonicFxConsoleGroupsHidden')}
     this.setHidden = setSonicFxConsoleGroupsHidden;`,
    sandbox,
  );

  sandbox.setHidden(true);
  Object.values(groups).forEach((group) => {
    assert.equal(group.classes.has('fx-sonic-hidden'), true);
    assert.equal(group.attributes['aria-hidden'], 'true');
  });

  sandbox.setHidden(false);
  Object.values(groups).forEach((group) => {
    assert.equal(group.classes.has('fx-sonic-hidden'), false);
    assert.equal(group.attributes['aria-hidden'], 'false');
  });
});

test('hidden Sonic groups are excluded from console search visibility', () => {
  const visibleGroup = makeGroup();
  const hiddenGroup = makeGroup();
  hiddenGroup.classList.toggle('fx-sonic-hidden', true);
  const sandbox = {
    fxConsoleGroups: {
      'motion:sonic-terrain': hiddenGroup,
      'motion:particles': visibleGroup,
    },
  };
  vm.runInNewContext(
    `${namedFunctionSource(consoleSource, 'fxConsoleEntryIsVisible')}
     this.isVisible = fxConsoleEntryIsVisible;`,
    sandbox,
  );

  assert.equal(sandbox.isVisible({ tab: 'motion', group: 'sonic-terrain' }), false);
  assert.equal(sandbox.isVisible({ tab: 'motion', group: 'particles' }), true);
  assert.equal(sandbox.isVisible({ tab: 'motion', group: 'not-built-yet' }), true);
  assert.match(
    namedFunctionSource(consoleSource, 'renderFxConsoleSearchResults'),
    /fxConsoleEntryIsVisible\(entry\)/,
  );
});

test('an open console search refreshes when Sonic group visibility changes', () => {
  const search = { value: '音域' };
  const results = { hidden: false };
  const refreshedQueries = [];
  const sandbox = {
    SONIC_FX_CONSOLE_GROUP_KEYS: ['motion:sonic-terrain'],
    fxConsoleGroups: { 'motion:sonic-terrain': makeGroup() },
    document: {
      getElementById(id) {
        if (id === 'fx-console-search') return search;
        if (id === 'fx-console-search-results') return results;
        return null;
      },
    },
    renderFxConsoleSearchResults(query) {
      refreshedQueries.push(query);
    },
  };
  vm.runInNewContext(
    `${namedFunctionSource(consoleSource, 'setSonicFxConsoleGroupsHidden')}
     this.setHidden = setSonicFxConsoleGroupsHidden;`,
    sandbox,
  );

  sandbox.setHidden(true);

  assert.deepEqual(refreshedQueries, ['音域']);
});

test('preset visibility sync hides ordinary presets and restores Sonic preset', () => {
  const groupHiddenCalls = [];
  const controlHiddenCalls = [];
  const sandbox = {
    fx: { preset: 0 },
    SONIC_PRESET_INDEX: 7,
    SONIC_ORIGINAL_FX_CONTROL_IDS: [],
    setFxPanelControlsHidden(ids, hidden) {
      controlHiddenCalls.push({ ids, hidden });
    },
    setSonicFxConsoleGroupsHidden(hidden) {
      groupHiddenCalls.push(hidden);
    },
  };
  vm.runInNewContext(
    `${namedFunctionSource(performanceSource, 'updateSonicSeriesControlVisibility')}
     this.syncVisibility = updateSonicSeriesControlVisibility;`,
    sandbox,
  );

  sandbox.syncVisibility();
  sandbox.fx.preset = 7;
  sandbox.syncVisibility();

  assert.deepEqual(groupHiddenCalls, [true, false]);
  assert.equal(controlHiddenCalls[0].hidden, true, 'legacy controls should still hide as fallback');
  assert.equal(controlHiddenCalls[2].hidden, false, 'legacy controls should restore for Sonic preset');
});

console.log('OK sonic-console-visibility');
