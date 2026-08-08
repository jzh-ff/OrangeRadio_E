'use strict';

/*
 * 睡眠定时器模块测试
 * ----------------------------------------------------------------------------
 * vm 沙箱加载 20-sleep-timer.js，验证：倒计时格式、分钟模式到点暂停、
 * 曲末模式挂 ended 钩子、取消清理、按钮高亮状态。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const modulePath = path.join(__dirname, '..', 'public', 'js', 'modules', '05-playback', '20-sleep-timer.js');

function makeClassList() {
  const values = new Set();
  return {
    add(name) { values.add(name); },
    remove(name) { values.delete(name); },
    contains(name) { return values.has(name); },
  };
}

function makeEl(id) {
  return {
    id,
    style: {},
    classList: makeClassList(),
    title: '',
    textContent: '',
    display: '',
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    removeEventListener(type) { delete this.listeners[type]; },
    setAttribute() {},
    querySelectorAll() { return []; },
  };
}

const elements = {};
['sleep-timer-btn', 'sleep-timer-popover', 'sleep-timer-countdown', 'sleep-timer-cancel'].forEach((id) => {
  elements[id] = makeEl(id);
});
elements['sleep-timer-popover'].style.display = 'none';
elements['sleep-timer-btn'].classList.add('ctrl-btn');
elements['sleep-timer-cancel'].addEventListener('click', () => {});

const pauses = [];
const toasts = [];
const timers = [];

const sandbox = {
  console,
  audio: {
    paused: false,
    addEventListener(type, fn) { this.listeners = this.listeners || {}; this.listeners[type] = fn; },
    removeEventListener(type) { if (this.listeners) delete this.listeners[type]; },
  },
  playing: true,
  fadeOutAndPauseAudio() { pauses.push('fade'); },
  setPlayIcon(v) { pauses.push('icon:' + v); },
  hideLoading() {},
  showToast(msg) { toasts.push(msg); },
  safePlaybackStep(_name, fn) { if (fn) fn(); },
  updateListenStatsTick() {},
  setInterval(fn, ms) { timers.push({ fn, ms }); return timers.length; },
  clearInterval() {},
  setTimeout(fn, ms) { timers.push({ fn, ms, timeout: true }); return timers.length; },
  clearTimeout() {},
  document: {
    getElementById(id) { return elements[id] || null; },
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(modulePath, 'utf8'), sandbox, { filename: modulePath });

// ---- 倒计时格式 ----
assert.equal(sandbox.formatSleepTimerRemaining(15 * 60 * 1000), '15:00');
assert.equal(sandbox.formatSleepTimerRemaining(90 * 60 * 1000), '90:00');
assert.equal(sandbox.formatSleepTimerRemaining(65 * 1000), '1:05');
assert.equal(sandbox.formatSleepTimerRemaining(0), '00');
assert.equal(sandbox.formatSleepTimerRemaining(-5000), '00');

// ---- 初始 off ----
assert.equal(sandbox.sleepTimerState.mode, 'off');
assert.equal(sandbox.sleepTimerActive(), false);

// ---- 分钟模式：设置后挂定时器与 UI 刷新 ----
sandbox.setSleepTimerMinutes(15);
assert.equal(sandbox.sleepTimerState.mode, 'minutes');
assert.equal(sandbox.sleepTimerState.minutes, 15);
assert.ok(sandbox.sleepTimerState.endsAt > Date.now());
assert.equal(sandbox.sleepTimerActive(), true);
assert.equal(elements['sleep-timer-countdown'].textContent.indexOf('剩余') >= 0, true, 'countdown must render');
// 1 个到点 timeout + 1 个 1s tick
assert.equal(timers.filter((t) => t.timeout).length, 1);
assert.equal(timers.filter((t) => !t.timeout).length, 1);
assert.equal(timers.filter((t) => !t.timeout)[0].ms, 1000);

// ---- 到点触发暂停 ----
sandbox.sleepTimerState.timeoutId = 0; // 避免真实等待
sandbox.fireSleepTimerPause('minutes');
assert.equal(pauses.includes('fade'), true, 'must fade out audio');
assert.equal(pauses.includes('icon:false'), true, 'must update play icon');
assert.equal(sandbox.sleepTimerState.mode, 'off', 'timer must reset after firing');
assert.ok(toasts.some((t) => t.indexOf('到点') >= 0), 'must toast on fire');

// ---- 曲末模式：挂 ended 钩子 ----
sandbox.setSleepTimerTrackEnd();
assert.equal(sandbox.sleepTimerState.mode, 'track-end');
assert.equal(typeof sandbox.sleepTimerState.endedHook, 'function');
assert.equal(typeof sandbox.audio.listeners.ended, 'function', 'ended listener must attach');
// 模拟曲目结束
sandbox.audio.listeners.ended();
assert.equal(sandbox.sleepTimerState.mode, 'off');
assert.equal(typeof sandbox.audio.listeners.ended, 'undefined', 'ended listener must detach after firing');
assert.ok(toasts.some((t) => t.indexOf('曲目已结束') >= 0));

// ---- 取消 ----
sandbox.setSleepTimerMinutes(30);
sandbox.cancelSleepTimer();
assert.equal(sandbox.sleepTimerState.mode, 'off');
assert.equal(elements['sleep-timer-popover'].style.display, 'none', 'panel must close on cancel');

// ---- 弹层开关 ----
elements['sleep-timer-popover'].style.display = 'none';
sandbox.toggleSleepTimerPanel();
assert.equal(elements['sleep-timer-popover'].style.display, 'block', 'panel must open');
sandbox.toggleSleepTimerPanel();
assert.equal(elements['sleep-timer-popover'].style.display, 'none', 'panel must close on second toggle');

console.log('OK sleep-timer');
