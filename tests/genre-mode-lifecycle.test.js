'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const visualDir = path.join(root, 'public', 'js', 'modules', '02-visual');
const transitionPath = path.join(visualDir, '19-genre-world-transition.js');
const modePath = path.join(root, 'public', 'js', 'modules', '10-shell', '09-genre-mode.js');
const registryPath = path.join(visualDir, '17-genre-world-registry.js');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : !!force;
    if (on) this.add(name); else this.remove(name);
    return on;
  }
}

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.attributes = {};
    this.style = {
      values: {},
      setProperty: (name, value) => { this.style.values[name] = String(value); },
      removeProperty: (name) => { delete this.style.values[name]; },
    };
    this.textContent = '';
    this.listeners = {};
    this.children = [];
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }
  dispatch(type, event = {}) {
    event.target ||= this;
    event.currentTarget = this;
    event.preventDefault ||= () => {};
    (this.listeners[type] || []).forEach((handler) => handler(event));
  }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  querySelectorAll(selector) {
    if (selector === '[data-world]') return this.children.filter((child) => child.dataset.world);
    return [];
  }
  closest(selector) {
    if (selector === '[data-world]' && this.dataset.world) return this;
    return null;
  }
  getBoundingClientRect() { return { left: 10, width: 200 }; }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function makeDocument() {
  const ids = [
    'genre-overlay', 'genre-world-portal', 'genre-world-lyrics',
    'gm-hud', 'gm-world-name', 'gm-world-english', 'gm-lock-state',
    'gm-profile-source', 'gm-title', 'gm-artist', 'gm-progress',
    'gm-progress-fill', 'gm-time', 'gm-compass', 'gm-compass-toggle',
    'gm-hud-expand',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
  const body = new FakeElement('body');
  const documentElement = new FakeElement('html');
  const doc = {
    body,
    documentElement,
    getElementById(id) { return elements[id] || null; },
    createElement() { return new FakeElement(); },
    addEventListener(type, handler) { body.addEventListener(type, handler); },
    dispatch(type, event) { body.dispatch(type, event); },
  };
  const worlds = ['electronic', 'rock-metal', 'hiphop', 'prism', 'folk', 'classical', 'jazz-soul', 'ambient'];
  worlds.forEach((world) => {
    const button = new FakeElement();
    button.dataset.world = world;
    button.setAttribute('aria-pressed', 'false');
    elements['gm-compass'].appendChild(button);
  });
  return { doc, elements };
}

function runFile(filename, sandbox) {
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
}

// Registry metadata is product-facing and stable.
{
  const sandbox = { console };
  runFile(registryPath, sandbox);
  const worlds = JSON.parse(JSON.stringify(sandbox.listGenreWorlds()));
  const expected = [
    ['electronic', '霓虹反应城', 'Neon Reactive City', 'hologram-signs'],
    ['rock-metal', '裂隙铸造场', 'Rift Foundry', 'fractured-stage'],
    ['hiphop', '午夜街区', 'Midnight Block', 'architectural-type'],
    ['prism', '棱镜梦乐园', 'Prism Dreamland', 'dream-ribbons'],
    ['folk', '琥珀旷野', 'Amber Wilds', 'constellation-script'],
    ['classical', '无尽歌剧院', 'Infinite Opera House', 'spatial-score'],
    ['jazz-soul', '蓝烟俱乐部', 'Blue Smoke Club', 'improvised-anchor'],
    ['ambient', '潮汐虚境', 'Tidal Void', 'horizon-dissolve'],
  ];
  assert.deepEqual(worlds.map((world) => [
    world.id, world.designName, world.englishName, world.lyricStyle,
  ]), expected);
  worlds.forEach((world) => {
    assert.ok(world.palette && world.palette.length >= 2, `${world.id} palette`);
    assert.match(world.accent, /^#/);
  });
}

// Transition state machine: no private scheduler, transactional fallback, and explicit advancement.
{
  const { doc, elements } = makeDocument();
  const switches = [];
  const commits = [];
  const appliedContexts = [];
  let current = 'electronic';
  const sandbox = {
    console,
    document: doc,
    window: { matchMedia: () => ({ matches: false }) },
    genreWorldEngineState: { current: { record: { id: current } } },
    getGenreWorld(id) {
      return {
        id,
        lyricStyle: id === 'prism' ? 'dream-ribbons' : `${id}-lyrics`,
      };
    },
    commitGenreModeWorldResult(target, actual, failed, ctx) {
      commits.push([target, actual, failed, ctx && ctx.track && ctx.track.id]);
    },
    switchGenreWorld(id, ctx) {
      switches.push([id, ctx && ctx.track && ctx.track.id]);
      appliedContexts.push([id, ctx && ctx.lyricStyle]);
      if (id === 'ambient') return false;
      current = id;
      sandbox.genreWorldEngineState.current = { record: { id } };
      return true;
    },
  };
  runFile(transitionPath, sandbox);
  for (const api of [
    'requestGenreWorldTransition', 'advanceGenreWorldTransition',
    'cancelGenreWorldTransition', 'genreWorldTransitionSnapshot',
  ]) assert.equal(typeof sandbox[api], 'function', `missing transition API ${api}`);

  assert.equal(sandbox.requestGenreWorldTransition('electronic', { track: { id: 'same' } }), true);
  assert.deepEqual(switches.at(-1), ['electronic', 'same'], 'same world applies track immediately');
  assert.deepEqual(commits.at(-1), ['electronic', 'electronic', false, 'same']);
  assert.equal(sandbox.genreWorldTransitionSnapshot().phase, 'idle');

  assert.equal(sandbox.requestGenreWorldTransition('rock-metal', { track: { id: 'cross' } }, {
    now: 1000, duration: 2000,
  }), true);
  assert.equal(sandbox.genreWorldTransitionSnapshot().phase, 'closing');
  assert.equal(elements['genre-world-portal'].dataset.phase, 'closing');
  sandbox.advanceGenreWorldTransition(1600);
  assert.equal(sandbox.genreWorldTransitionSnapshot().phase, 'crossing');
  sandbox.advanceGenreWorldTransition(2100);
  assert.equal(current, 'rock-metal');
  assert.deepEqual(commits.at(-1), ['rock-metal', 'rock-metal', false, 'cross']);
  sandbox.advanceGenreWorldTransition(2600);
  assert.equal(sandbox.genreWorldTransitionSnapshot().phase, 'opening');
  sandbox.advanceGenreWorldTransition(3100);
  assert.equal(sandbox.genreWorldTransitionSnapshot().phase, 'idle');

  assert.equal(sandbox.requestGenreWorldTransition('ambient', { track: { id: 'bad' } }, {
    now: 4000, duration: 1500,
  }), true);
  sandbox.advanceGenreWorldTransition(4800);
  assert.equal(current, 'prism', 'failed target attempts prism fallback');
  assert.deepEqual(commits.at(-1), ['ambient', 'prism', true, 'bad']);
  assert.deepEqual(appliedContexts.at(-1), ['prism', 'dream-ribbons']);
  assert.equal(elements['genre-world-portal'].dataset.failed, 'true');
  sandbox.advanceGenreWorldTransition(5600);
  assert.equal(sandbox.genreWorldTransitionSnapshot().phase, 'idle');

  assert.equal(sandbox.requestGenreWorldTransition('hiphop', { track: { id: 'reduced' } }, {
    now: 6000, reducedMotion: true,
  }), true);
  assert.equal(sandbox.genreWorldTransitionSnapshot().reducedMotion, true);
  assert.equal(sandbox.genreWorldTransitionSnapshot().duration <= 300, true);
  sandbox.advanceGenreWorldTransition(6300);
  assert.equal(current, 'hiphop');

  sandbox.cancelGenreWorldTransition();
  assert.equal(sandbox.genreWorldTransitionSnapshot().phase, 'idle');
  const source = fs.readFileSync(transitionPath, 'utf8');
  assert.doesNotMatch(source, /requestAnimationFrame|MutationObserver/);
}

// Failed engine startup is an atomic mode-entry failure and restores displaced modes.
{
  const { doc, elements } = makeDocument();
  const store = new Map([['orangesea-genre-mode-v1', 'false']]);
  const calls = [];
  const sandbox = {
    console,
    document: doc,
    window: { matchMedia: () => ({ matches: false }) },
    localStorage: {
      getItem(key) { return store.get(key) || null; },
      setItem(key, value) { store.set(key, String(value)); },
    },
    readBooleanPreference() { return false; },
    saveBooleanPreference(key, value) { store.set(key, String(!!value)); },
    scheduleUiWarmTask(fn) { fn(); },
    currentCoverSong() { return { id: 'startup-failure', name: 'No Engine' }; },
    resolveGenreProfile() {
      return { family: 'default', world: 'prism', source: 'default', confidence: 0.15 };
    },
    startGenreWorldEngine() { calls.push(['start']); return false; },
    stopGenreWorldEngine() { calls.push(['stop']); return true; },
    resetGenreWorldAdaptiveQuality() { calls.push(['quality.reset']); },
    cancelGenreWorldTransition() { calls.push(['cancel']); },
    clearGenreWorldLyrics() { calls.push(['clearLyrics']); },
    filmRadioMode: true,
    applyFilmRadioMode(on) { calls.push(['film', on]); sandbox.filmRadioMode = on; },
    graffitiMode: true,
    applyGraffitiMode(on) { calls.push(['graffiti', on]); sandbox.graffitiMode = on; },
    showToast(message) { calls.push(['toast', message]); },
    refreshPresetGrid() {},
  };
  runFile(modePath, sandbox);
  calls.length = 0;
  store.set('orangesea-genre-mode-v1', 'stale');
  assert.equal(sandbox.applyGenreMode(true, { save: true, toast: true }), false);
  assert.equal(sandbox.genreMode, false);
  assert.equal(doc.body.classList.contains('genre-mode'), false);
  assert.equal(doc.documentElement.classList.contains('genre-mode-preload'), false);
  assert.equal(elements['genre-overlay'].getAttribute('aria-hidden'), 'true');
  assert.equal(store.get('orangesea-genre-mode-v1'), 'false');
  assert.equal(calls.filter((call) => call[0] === 'cancel').length, 1,
    'manual failed entry cancels transition during this attempt');
  assert.equal(calls.filter((call) => call[0] === 'stop').length, 1,
    'manual failed entry defensively stops engine during this attempt');
  assert.equal(calls.filter((call) => call[0] === 'clearLyrics').length, 1,
    'manual failed entry clears world lyrics during this attempt');
  assert.equal(calls.filter((call) => call[0] === 'quality.reset').length, 1,
    'manual failed entry restores ordinary render quality');
  assert.ok(calls.some((call) => call[0] === 'film' && call[1] === true), 'film mode restored');
  assert.ok(calls.some((call) => call[0] === 'graffiti' && call[1] === true), 'graffiti mode restored');
  assert.equal(sandbox.filmRadioMode, true);
  assert.equal(sandbox.graffitiMode, true);
  assert.equal(calls.some((call) => call[0] === 'toast' && /已开启/.test(call[1])), false);
}

// Persisted-on startup failure must force a durable closed state, never restore genreMode=true.
{
  const { doc, elements } = makeDocument();
  const store = new Map([['orangesea-genre-mode-v1', 'true']]);
  const calls = [];
  const sandbox = {
    console,
    document: doc,
    window: { matchMedia: () => ({ matches: false }) },
    localStorage: {
      getItem(key) { return store.get(key) || null; },
      setItem(key, value) { store.set(key, String(value)); },
    },
    readBooleanPreference(key, fallback) {
      return store.has(key) ? store.get(key) === 'true' : fallback;
    },
    saveBooleanPreference(key, value) {
      calls.push(['save', key, !!value]);
      store.set(key, String(!!value));
    },
    scheduleUiWarmTask(fn) { fn(); },
    currentCoverSong() { return { id: 'persisted-startup-failure' }; },
    resolveGenreProfile() {
      return { family: 'default', world: 'prism', source: 'default', confidence: 0.15 };
    },
    startGenreWorldEngine() { calls.push(['start']); return false; },
    stopGenreWorldEngine() { calls.push(['stop']); return true; },
    cancelGenreWorldTransition() { calls.push(['cancel']); },
    clearGenreWorldLyrics() { calls.push(['clearLyrics']); },
    filmRadioMode: true,
    applyFilmRadioMode(on) { calls.push(['film', on]); sandbox.filmRadioMode = on; },
    graffitiMode: true,
    applyGraffitiMode(on) { calls.push(['graffiti', on]); sandbox.graffitiMode = on; },
    refreshPresetGrid() {},
  };
  runFile(modePath, sandbox);
  assert.equal(sandbox.genreMode, false);
  assert.equal(doc.body.classList.contains('genre-mode'), false);
  assert.equal(doc.documentElement.classList.contains('genre-mode-preload'), false);
  assert.equal(elements['genre-overlay'].getAttribute('aria-hidden'), 'true');
  assert.equal(store.get('orangesea-genre-mode-v1'), 'false');
  assert.ok(calls.some((call) => call[0] === 'save' && call[2] === false));
  assert.ok(calls.some((call) => call[0] === 'cancel'), 'failed startup cancels transition');
  assert.ok(calls.some((call) => call[0] === 'stop'), 'failed startup defensively stops engine');
  assert.ok(calls.some((call) => call[0] === 'clearLyrics'), 'failed startup clears world lyrics');
  assert.ok(calls.some((call) => call[0] === 'film' && call[1] === true), 'film mode restored');
  assert.ok(calls.some((call) => call[0] === 'graffiti' && call[1] === true), 'graffiti mode restored');
}

// Initial entry is atomic when the real transition path cannot create target or prism.
{
  const { doc, elements } = makeDocument();
  const store = new Map([['orangesea-genre-mode-v1', 'false']]);
  const calls = [];
  const camera = {
    layers: {
      value: 7,
      set(value) { this.value = value; },
    },
  };
  const sandbox = {
    console,
    document: doc,
    window: { matchMedia: () => ({ matches: false }) },
    localStorage: {
      getItem(key) { return store.get(key) || null; },
      setItem(key, value) { store.set(key, String(value)); },
    },
    readBooleanPreference() { return false; },
    saveBooleanPreference(key, value) { store.set(key, String(!!value)); },
    scheduleUiWarmTask(fn) { fn(); },
    currentCoverSong() { return { id: 'double-world-failure' }; },
    resolveGenreProfile() {
      return { family: 'ambient', world: 'ambient', source: 'genre', confidence: 1 };
    },
    getGenreWorld(id) {
      return {
        id,
        designName: id,
        englishName: id,
        accent: '#abcdef',
        palette: ['#111111', '#abcdef'],
        lyricStyle: `${id}-lyrics`,
      };
    },
    genreWorldEngineState: { current: null },
    startGenreWorldEngine() { calls.push(['start']); camera.layers.set(29); return true; },
    switchGenreWorld(id) { calls.push(['switch', id]); return false; },
    stopGenreWorldEngine() { calls.push(['stop']); camera.layers.set(7); return true; },
    resetGenreWorldAdaptiveQuality() { calls.push(['quality.reset']); },
    clearGenreWorldLyrics() { calls.push(['clearLyrics']); },
    filmRadioMode: true,
    applyFilmRadioMode(on) { calls.push(['film', on]); sandbox.filmRadioMode = on; },
    graffitiMode: true,
    applyGraffitiMode(on) { calls.push(['graffiti', on]); sandbox.graffitiMode = on; },
    refreshPresetGrid() {},
  };
  runFile(transitionPath, sandbox);
  runFile(modePath, sandbox);
  calls.length = 0;

  assert.equal(sandbox.applyGenreMode(true, { save: true }), false);
  assert.deepEqual(
    calls.filter((call) => call[0] === 'switch').map((call) => call[1]),
    ['ambient', 'prism'],
    'real initial transition attempts target then prism',
  );
  assert.equal(sandbox.genreMode, false);
  assert.equal(camera.layers.value, 7, 'failed entry restores the pre-entry camera layer');
  assert.equal(doc.body.classList.contains('genre-mode'), false);
  assert.equal(doc.documentElement.classList.contains('genre-mode-preload'), false);
  assert.equal(elements['genre-overlay'].getAttribute('aria-hidden'), 'true');
  assert.equal(store.get('orangesea-genre-mode-v1'), 'false');
  assert.ok(calls.some((call) => call[0] === 'stop'));
  assert.ok(calls.some((call) => call[0] === 'clearLyrics'));
  assert.ok(calls.some((call) => call[0] === 'film' && call[1] === true));
  assert.ok(calls.some((call) => call[0] === 'graffiti' && call[1] === true));
}

// Mode lifecycle and HUD are driven only by explicit sync/advance calls.
{
  const { doc, elements } = makeDocument();
  const store = new Map([
    ['orangesea-genre-mode-v1', 'false'],
    ['orangesea-genre-lock-v1', 'rock'],
  ]);
  const calls = [];
  let song = { id: 'song-1', name: 'First', artist: 'Artist', genre: 'electronic' };
  const audio = { currentTime: 30, duration: 120, paused: false, ended: false, src: 'song.mp3' };
  const sandbox = {
    console,
    document: doc,
    window: { matchMedia: () => ({ matches: false }) },
    localStorage: {
      getItem(key) { return store.get(key) || null; },
      setItem(key, value) { store.set(key, String(value)); },
    },
    readBooleanPreference(key, fallback) { return store.has(key) ? store.get(key) === 'true' : fallback; },
    saveBooleanPreference(key, value) { store.set(key, String(!!value)); },
    scheduleUiWarmTask(fn) { fn(); },
    currentCoverSong() { return song; },
    resolveGenreProfile(track) {
      const familyWorld = {
        electronic: 'electronic', rock: 'rock-metal', classical: 'classical',
        jazz: 'jazz-soul', ambient: 'ambient', default: 'prism',
      };
      const family = track.genre || 'default';
      return {
        family,
        world: familyWorld[family] || 'prism',
        source: track.genre ? 'genre' : 'default',
        confidence: track.genre ? 1 : 0.15,
      };
    },
    genreProfileSignature(track) { return JSON.stringify([track.id, track.genre, track.artist, track.name]); },
    getGenreWorld(id) {
      const styles = {
        electronic: 'hologram-signs', 'rock-metal': 'fractured-stage',
        hiphop: 'architectural-type', prism: 'dream-ribbons',
        folk: 'constellation-script', classical: 'spatial-score',
        'jazz-soul': 'improvised-anchor', ambient: 'horizon-dissolve',
      };
      return {
        id,
        designName: id === 'rock-metal' ? '裂隙铸造场' : id,
        englishName: id.toUpperCase(),
        accent: id === 'prism' ? '#ff79d1' : '#abcdef',
        palette: id === 'prism' ? ['#120d25', '#72e8ff'] : ['#111111', '#abcdef'],
        lyricStyle: styles[id],
      };
    },
    startGenreWorldEngine(ctx) { calls.push(['start', ctx.track.id]); return true; },
    stopGenreWorldEngine() { calls.push(['stop']); return true; },
    syncGenreWorldAdaptiveQuality(force) { calls.push(['quality.sync', !!force]); return true; },
    resetGenreWorldAdaptiveQuality() { calls.push(['quality.reset']); return true; },
    requestGenreWorldTransition(id, ctx, opts) {
      calls.push(['transition', id, ctx.track.id, !!(opts && opts.initial)]);
      const actual = id === 'ambient' ? 'prism' : id;
      sandbox.commitGenreModeWorldResult(id, actual, actual !== id, ctx);
      return true;
    },
    cancelGenreWorldTransition() { calls.push(['cancel']); },
    clearGenreWorldLyrics() { calls.push(['clearLyrics']); },
    filmRadioMode: true,
    applyFilmRadioMode(on) { calls.push(['film', on]); sandbox.filmRadioMode = on; },
    graffitiMode: true,
    applyGraffitiMode(on) { calls.push(['graffiti', on]); sandbox.graffitiMode = on; },
    refreshPresetGrid() {},
    showToast() {},
    audio,
  };
  runFile(modePath, sandbox);

  assert.equal(sandbox.genreLock, 'rock-metal', 'legacy family lock migrates to world id');
  assert.equal(store.get('orangesea-genre-lock-v1'), 'rock-metal');
  for (const api of [
    'applyGenreMode', 'toggleGenreMode', 'initGenreMode', 'setGenreWorldLock',
    'syncGenreModeTrack', 'syncGenreModeHud', 'noteGenreHudActivity', 'updateGenreHudVisibility',
    'commitGenreModeWorldResult',
  ]) assert.equal(typeof sandbox[api], 'function', `missing mode API ${api}`);

  sandbox.applyGenreMode(true);
  assert.ok(calls.some((call) => call[0] === 'film' && call[1] === false));
  assert.ok(calls.some((call) => call[0] === 'graffiti' && call[1] === false));
  assert.ok(calls.some((call) => call[0] === 'start'));
  assert.ok(calls.some((call) => call[0] === 'transition' && call[1] === 'rock-metal'));
  assert.ok(calls.some((call) => call[0] === 'quality.sync' && call[1] === true),
    'successful entry force-syncs world quality');
  assert.equal(doc.body.classList.contains('genre-mode'), true);
  assert.equal(doc.documentElement.classList.contains('genre-mode-preload'), true);
  assert.equal(elements['genre-overlay'].getAttribute('aria-hidden'), 'false');

  sandbox.setGenreWorldLock('auto');
  assert.equal(sandbox.genreLock, 'auto');
  assert.ok(calls.some((call) => call[0] === 'transition' && call[1] === 'electronic'));
  assert.match(elements['gm-profile-source'].textContent, /标签|genre/i);
  assert.match(elements['gm-lock-state'].textContent, /自动/);

  sandbox.setGenreWorldLock('classical');
  assert.match(elements['gm-lock-state'].textContent, /锁定/);
  assert.equal(elements['genre-overlay'].dataset.world, 'classical');
  const classicalButton = elements['gm-compass'].children.find((button) => button.dataset.world === 'classical');
  assert.equal(classicalButton.getAttribute('aria-pressed'), 'true');

  sandbox.setGenreWorldLock('auto');
  const beforeAsync = calls.length;
  song.genre = 'jazz';
  sandbox.syncGenreModeTrack(false);
  assert.ok(calls.slice(beforeAsync).some((call) => call[0] === 'transition' && call[1] === 'jazz-soul'),
    'profile signature changes update the world even when title is stable');

  song.genre = 'ambient';
  const beforeFallback = calls.filter((call) => call[0] === 'transition').length;
  sandbox.syncGenreModeTrack(false);
  assert.equal(sandbox.genreActiveWorldId, 'prism', 'fallback commits the actual world');
  assert.equal(elements['genre-overlay'].dataset.world, 'prism');
  assert.equal(elements['genre-overlay'].dataset.lyricStyle, 'dream-ribbons');
  assert.equal(elements['genre-overlay'].style.values['--gm-accent'], '#ff79d1');
  assert.equal(elements['gm-world-name'].textContent, 'prism');
  sandbox.syncGenreModeTrack(false);
  assert.equal(
    calls.filter((call) => call[0] === 'transition').length,
    beforeFallback + 1,
    'same failed signature must not retry every sync',
  );
  song.genre = 'electronic';
  sandbox.syncGenreModeTrack(false);
  assert.equal(
    calls.filter((call) => call[0] === 'transition').length,
    beforeFallback + 2,
    'profile changes may retry after a fallback',
  );

  sandbox.syncGenreModeHud(true);
  assert.equal(elements['gm-title'].textContent, 'First');
  assert.equal(elements['gm-artist'].textContent, 'Artist');
  assert.equal(elements['gm-progress-fill'].style.width, '25%');
  assert.match(elements['gm-time'].textContent, /0:30.*2:00/);
  assert.equal(elements['gm-progress'].getAttribute('aria-valuenow'), '25');
  assert.match(elements['gm-progress'].getAttribute('aria-valuetext'), /0:30.*2:00/);
  elements['gm-progress'].dispatch('pointerdown', { clientX: 110, pointerId: 1 });
  assert.equal(audio.currentTime, 60, 'progress seek reads audio duration directly');
  let prevented = false;
  elements['gm-progress'].dispatch('keydown', {
    key: 'ArrowRight', preventDefault() { prevented = true; },
  });
  assert.equal(audio.currentTime, 65);
  assert.equal(prevented, true);
  elements['gm-progress'].dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(audio.currentTime, 60);
  elements['gm-progress'].dispatch('keydown', { key: 'Home' });
  assert.equal(audio.currentTime, 0);
  elements['gm-progress'].dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(audio.currentTime, 0, 'keyboard seek clamps at zero');
  elements['gm-progress'].dispatch('keydown', { key: 'End' });
  assert.equal(audio.currentTime, 120);
  elements['gm-progress'].dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(audio.currentTime, 120, 'keyboard seek clamps at duration');

  elements['gm-hud-expand'].dispatch('click');
  assert.equal(elements['genre-overlay'].classList.contains('is-compass-open'), true);
  assert.equal(elements['gm-hud-expand'].getAttribute('aria-expanded'), 'true');
  elements['gm-compass'].dispatch('click', { target: classicalButton });
  assert.equal(elements['genre-overlay'].classList.contains('is-compass-open'), false);
  assert.equal(elements['gm-hud-expand'].getAttribute('aria-expanded'), 'false');

  sandbox.noteGenreHudActivity(1000);
  sandbox.updateGenreHudVisibility(4900);
  assert.equal(elements['gm-hud'].classList.contains('is-dimmed'), false);
  sandbox.updateGenreHudVisibility(5101);
  assert.equal(elements['gm-hud'].classList.contains('is-dimmed'), true);
  doc.dispatch('pointermove', { timeStamp: 5200 });
  assert.equal(elements['gm-hud'].classList.contains('is-dimmed'), false);

  sandbox.applyGenreMode(false);
  assert.ok(calls.some((call) => call[0] === 'cancel'));
  assert.ok(calls.some((call) => call[0] === 'stop'));
  assert.ok(calls.some((call) => call[0] === 'clearLyrics'));
  assert.ok(calls.some((call) => call[0] === 'quality.reset'),
    'exit restores ordinary DPR and clears adaptive state');
  assert.equal(doc.body.classList.contains('genre-mode'), false);
  assert.equal(doc.documentElement.classList.contains('genre-mode-preload'), false);
  assert.equal(elements['genre-overlay'].getAttribute('aria-hidden'), 'true');

  const source = fs.readFileSync(modePath, 'utf8');
  assert.doesNotMatch(source, /requestAnimationFrame|MutationObserver|setTimeout\s*\([^)]*600/);
  assert.doesNotMatch(source, /gm-spectrum|gm-viz-canvas|gm-ring-bars/);
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'genre-mode.css'), 'utf8');
  assert.match(css, /\.gm-compass\s*\{[^}]*opacity:\s*0[^}]*visibility:\s*hidden/s);
  assert.match(css, /#genre-overlay\.is-compass-open \.gm-compass/);
  assert.match(css, /\.gm-portal\s*\{[^}]*z-index:\s*\d+/s);
}

console.log('OK genre mode lifecycle, transition state machine, HUD, lock migration, and direct seek');
