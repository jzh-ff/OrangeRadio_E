'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];

function check(name, fn) {
  try {
    fn();
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

function runPreload(values, throws) {
  const classes = new Set();
  const sandbox = {
    document: {
      documentElement: {
        classList: {
          add(...names) { names.forEach((name) => classes.add(name)); },
        },
      },
    },
    localStorage: {
      getItem(key) {
        if (throws) throw new Error('storage unavailable');
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/preload-mode.js'), sandbox, {
    filename: 'public/js/preload-mode.js',
  });
  return classes;
}

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : !!force;
      if (enabled) values.add(name); else values.delete(name);
      return enabled;
    },
    contains(name) { return values.has(name); },
  };
}

function makeElement(initialClasses = []) {
  return {
    classList: makeClassList(initialClasses),
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
  };
}

function runCombinedModeStartup() {
  const filmPath = 'public/js/modules/10-shell/06-film-radio.js';
  const genrePath = 'public/js/modules/10-shell/09-genre-mode.js';
  const store = new Map([
    ['orangesea-film-radio-v1', '1'],
    ['orangesea-genre-mode-v1', '1'],
    ['orangesea-genre-lock-v1', 'auto'],
  ]);
  const warmTasks = [];
  const elements = {
    'film-radio-overlay': makeElement(),
    'film-radio-btn': { ...makeElement(), title: '' },
    'genre-overlay': makeElement(),
    'gm-hud': makeElement(),
  };
  const sandbox = {
    console,
    audio: null,
    document: {
      documentElement: makeElement(['genre-mode-preload']),
      body: makeElement(),
      getElementById(id) { return elements[id] || null; },
      addEventListener() {},
    },
    localStorage: {
      getItem(key) { return store.get(key) || null; },
      setItem(key, value) { store.set(key, String(value)); },
    },
    readBooleanPreference(key, fallback) {
      return store.has(key) ? store.get(key) === '1' : fallback;
    },
    saveBooleanPreference(key, value) {
      store.set(key, value ? '1' : '0');
    },
    scheduleUiWarmTask(task, delay) { warmTasks.push({ task, delay }); },
    refreshPresetGrid() {},
    currentCoverSong() { return { id: 'startup-track', genre: 'electronic' }; },
    startGenreWorldEngine() { return true; },
    stopGenreWorldEngine() { return true; },
    cancelGenreWorldTransition() {},
    clearGenreWorldLyrics() {},
    resetGenreWorldAdaptiveQuality() {},
    syncGenreWorldAdaptiveQuality() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(read(filmPath), sandbox, { filename: filmPath });
  vm.runInContext(read(genrePath), sandbox, { filename: genrePath });

  // Keep the real mode/init functions while removing unrelated rendering work.
  sandbox.initFilmRadioProgressSeek = function () {};
  sandbox.bindFilmRadioCommentsScroll = function () {};
  sandbox.startFilmRadio = function () {};
  sandbox.stopFilmRadio = function () {};
  sandbox.bindGenreModeUi = function () {};
  sandbox.syncGenreModeHud = function () {};
  sandbox.syncGenreModeTrack = function () {};

  warmTasks.sort((a, b) => a.delay - b.delay).forEach(({ task }) => task());
  return { sandbox, store, elements };
}

check('obsolete theme table is removed', () => {
  assert.equal(
    fs.existsSync(path.join(root, 'public/js/modules/02-visual/17-genre-themes.js')),
    false,
  );
  assert.doesNotMatch(read('public/js/index-loader.js'), /17-genre-themes/);
});

check('preload gives genre priority when both modes are enabled', () => {
  const classes = runPreload({
    'orangesea-film-radio-v1': '1',
    'orangesea-genre-mode-v1': '1',
  });
  assert.equal(classes.has('genre-mode-preload'), true);
  assert.equal(classes.has('film-radio-preload'), false);
});

check('preload keeps film when genre is disabled', () => {
  const classes = runPreload({
    'orangesea-film-radio-v1': '1',
    'orangesea-genre-mode-v1': '0',
  });
  assert.equal(classes.has('film-radio-preload'), true);
  assert.equal(classes.has('genre-mode-preload'), false);
});

check('preload storage failure keeps the simple fallback', () => {
  const classes = runPreload({}, true);
  assert.equal(classes.has('simple-mode-preload'), true);
  assert.equal(classes.has('film-radio-preload'), false);
  assert.equal(classes.has('genre-mode-preload'), false);
});

check('combined persisted startup ends in genre after film warm init runs first', () => {
  const { sandbox, store, elements } = runCombinedModeStartup();
  assert.equal(sandbox.genreMode, true);
  assert.equal(sandbox.filmRadioMode, false);
  assert.equal(sandbox.document.body.classList.contains('genre-mode'), true);
  assert.equal(sandbox.document.body.classList.contains('film-radio'), false);
  assert.equal(elements['genre-overlay'].getAttribute('aria-hidden'), 'false');
  assert.equal(elements['film-radio-overlay'].getAttribute('aria-hidden'), 'true');
  assert.equal(store.get('orangesea-genre-mode-v1'), '1');
  assert.equal(store.get('orangesea-film-radio-v1'), '0');
});

check('genre mode retains only the world HUD, portal, and lyrics shell', () => {
  const mode = read('public/js/modules/10-shell/09-genre-mode.js');
  const css = read('public/css/genre-mode.css');
  const html = read('public/index.html');
  const surface = `${mode}\n${css}\n${html}`;
  assert.doesNotMatch(surface, /gm-spectrum|gm-viz-canvas|gm-ring-bars|genreActiveViz|genreObserver/);
  assert.doesNotMatch(mode, /MutationObserver|setInterval|setTimeout\s*\([^)]*600|control-title-text/);
  assert.match(html, /id="genre-world-portal"/);
  assert.match(html, /id="genre-world-lyrics"/);
  assert.match(html, /id="gm-hud"/);
});

check('film, graffiti, and ordinary presets still disable genre mode', () => {
  const film = read('public/js/modules/10-shell/06-film-radio.js');
  const graffiti = read('public/js/modules/10-shell/08-graffiti-lyrics.js');
  const presets = read('public/js/modules/07-fx/04-preset-grid-uniforms.js');
  [film, graffiti, presets].forEach((source) => {
    assert.match(source, /applyGenreMode\(false,\s*\{\s*save:\s*true\s*\}\)/);
  });
});

check('genre documentation describes world kits, not the obsolete DOM visualizer', () => {
  const docs = read('docs/GENRE_MODE.md');
  assert.match(docs, /12\s*(?:→|->)\s*8/);
  assert.match(docs, /World Kit/);
  assert.match(docs, /ownership/i);
  assert.doesNotMatch(docs, /不透明的全屏 DOM 覆盖层|bars 柱状|wave 波形|staff 五线谱|MutationObserver|独立\s*rAF/i);
});

if (failures.length) {
  throw new Error(`genre world cleanup contract failed:\n- ${failures.join('\n- ')}`);
}

console.log('OK genre world cleanup, preload exclusivity, and mode ownership');
