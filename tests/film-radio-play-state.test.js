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
  '10-shell',
  '06-film-radio.js',
);

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    toggle(name, on) { if (on) values.add(name); else values.delete(name); },
    contains(name) { return values.has(name); },
  };
}

const elements = {
  'fr-play': { innerHTML: '', classList: makeClassList(['fr-btn', 'fr-play']) },
  'fr-vinyl': { classList: makeClassList(['fr-vinyl']) },
  'heart-btn': { classList: makeClassList() },
  'fr-heart': { classList: makeClassList() },
};

const sandbox = {
  console,
  audio: { src: 'http://localhost/audio', paused: false, ended: false },
  readBooleanPreference() { return false; },
  scheduleUiWarmTask() {},
  document: {
    getElementById(id) { return elements[id] || null; },
    documentElement: { classList: makeClassList() },
    body: { classList: makeClassList() },
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(modulePath, 'utf8'), sandbox, { filename: modulePath });

sandbox.syncFilmRadioPlayState();
assert.equal(elements['fr-play'].classList.contains('is-playing'), true);
assert.equal(elements['fr-vinyl'].classList.contains('is-paused'), false);
assert.match(elements['fr-play'].innerHTML, /M6 5h4v14H6/);

sandbox.audio.paused = true;
sandbox.syncFilmRadioPlayState();
assert.equal(elements['fr-play'].classList.contains('is-playing'), false);
assert.equal(elements['fr-vinyl'].classList.contains('is-paused'), true);
assert.match(elements['fr-play'].innerHTML, /M8 5v14l11-7z/);

let startupWarmTask = null;
let startupRadioStarted = 0;
const startupHtmlClasses = makeClassList(['film-radio-preload']);
const startupBodyClasses = makeClassList();
const startupButtonClasses = makeClassList();
const startupOverlay = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
const startupSandbox = {
  console,
  audio: null,
  readBooleanPreference() { return true; },
  saveBooleanPreference() {},
  scheduleUiWarmTask(task) { startupWarmTask = task; },
  setTimeout,
  clearTimeout,
  requestAnimationFrame() { return 1; },
  cancelAnimationFrame() {},
  MutationObserver: class { observe() {} disconnect() {} },
  document: {
    getElementById(id) {
      if (id === 'film-radio-overlay') return startupOverlay;
      if (id === 'film-radio-btn') {
        return {
          classList: startupButtonClasses,
          setAttribute() {},
          title: '',
        };
      }
      return null;
    },
    documentElement: { classList: startupHtmlClasses },
    body: { classList: startupBodyClasses },
  },
};
vm.createContext(startupSandbox);
vm.runInContext(fs.readFileSync(modulePath, 'utf8'), startupSandbox, { filename: modulePath });
startupSandbox.startFilmRadio = function () { startupRadioStarted++; };
assert.equal(typeof startupWarmTask, 'function');
startupWarmTask();
assert.equal(startupBodyClasses.contains('film-radio'), true);
assert.equal(startupHtmlClasses.contains('film-radio-preload'), true);
assert.equal(startupButtonClasses.contains('on'), true);
assert.equal(startupRadioStarted, 1);

console.log('OK film radio reflects playback and restores its complete startup UI state');
