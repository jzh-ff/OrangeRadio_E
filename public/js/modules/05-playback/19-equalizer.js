/* =========================================================================
   OrangeSea · 10 段均衡器（Equalizer）
   节点链插入点：analyser → [EQ链] → gainNode/analysisSinkNode → destination
   持久化：独立 key orangesea-equalizer-v1（不耦合视觉 fx 存档）
   ========================================================================= */

var EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
var EQ_FREQUENCY_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
var EQ_STORE_KEY = 'orangesea-equalizer-v1';

var EQ_PRESETS = {
  flat:      { name: '平直',     bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bassBoost: { name: '低音增强', bands: [8, 6, 4, 2, 0, 0, 0, 0, 0, 0] },
  vocal:     { name: '人声',     bands: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  treble:    { name: '高音清澈', bands: [0, 0, 0, 0, 0, 1, 2, 4, 6, 8] }
};

// 全局 EQ 状态（节点跨音频图重建复用，不置 null）
var eqNodes = [];
var eqChainInput = null;
var eqChainOutput = null;
var eqEnabled = true;
var eqPresetName = 'flat';
var eqBands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/* ---------- 持久化（照抄 AUDIO_FADE 范式） ---------- */
function normalizeEqBandGain(v) {
  var n = Number(v);
  if (!isFinite(n)) return 0;
  return Math.max(-12, Math.min(12, n));
}

function readEqPreference() {
  try {
    var raw = JSON.parse(localStorage.getItem(EQ_STORE_KEY) || '{}');
    var bands = Array.isArray(raw.bands) && raw.bands.length === 10
      ? raw.bands.map(normalizeEqBandGain)
      : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    return {
      enabled: raw.enabled !== false,
      presetName: raw.presetName || 'flat',
      bands: bands
    };
  } catch (e) {
    return { enabled: true, presetName: 'flat', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  }
}

function saveEqPreference() {
  try {
    localStorage.setItem(EQ_STORE_KEY, JSON.stringify({
      schema: 'equalizer-v1',
      enabled: eqEnabled,
      presetName: eqPresetName,
      bands: eqBands
    }));
  } catch (e) { }
}

/* ---------- 启动时加载持久化状态 ---------- */
(function initEqState() {
  var pref = readEqPreference();
  eqEnabled = pref.enabled;
  eqPresetName = pref.presetName;
  eqBands = pref.bands;
})();

/* ---------- EQ 节点链管理 ---------- */
function ensureEqChain(ctx) {
  if (!ctx || !ctx.createBiquadFilter) return;

  // AudioNode cannot be reused across AudioContext instances.
  var contextChanged = !!(
    eqNodes.length
    && eqNodes[0]
    && eqNodes[0].context
    && eqNodes[0].context !== ctx
  );
  if (contextChanged) {
    disconnectEqChain();
    eqNodes = [];
    eqChainInput = null;
    eqChainOutput = null;
  }

  if (!eqNodes.length) {
    for (var i = 0; i < 10; i++) {
      var f = ctx.createBiquadFilter();
      f.type = (i === 0) ? 'lowshelf' : (i === 9) ? 'highshelf' : 'peaking';
      f.frequency.value = EQ_FREQUENCIES[i];
      f.Q.value = 1.2;
      f.gain.value = 0;
      eqNodes.push(f);
    }
  } else {
    // Graph recovery disconnects every EQ node, including the internal chain.
    disconnectEqChain();
  }

  // Always restore the internal chain before initAudio connects its endpoints.
  for (var j = 0; j < eqNodes.length - 1; j++) eqNodes[j].connect(eqNodes[j + 1]);
  eqChainInput = eqNodes[0] || null;
  eqChainOutput = eqNodes[eqNodes.length - 1] || null;
  applyEqGains();
}

function disconnectEqChain() {
  for (var i = 0; i < eqNodes.length; i++) {
    try { eqNodes[i] && eqNodes[i].disconnect(); } catch (e) { }
  }
  // Keep nodes for the same context; ensureEqChain restores their connections.
}

function applyEqGains() {
  var target = eqEnabled ? eqBands : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (var i = 0; i < eqNodes.length; i++) {
    if (eqNodes[i]) {
      try { eqNodes[i].gain.value = target[i] || 0; } catch (e) { }
    }
  }
}

/* ---------- EQ 设置 API ---------- */
function setEqBand(index, dB) {
  if (index < 0 || index >= 10) return;
  eqBands[index] = normalizeEqBandGain(dB);
  eqPresetName = 'custom';  // 手动调节后标记为自定义
  if (eqEnabled) {
    try { eqNodes[index] && (eqNodes[index].gain.value = eqBands[index]); } catch (e) { }
  }
  syncEqPresetButtons();
  saveEqPreference();
}

function setEqPreset(name) {
  var preset = EQ_PRESETS[name];
  if (!preset) return;
  eqPresetName = name;
  eqBands = preset.bands.slice();
  applyEqGains();
  syncEqSliders();
  syncEqPresetButtons();
  saveEqPreference();
}

function setEqEnabled(on) {
  eqEnabled = !!on;
  if (!eqEnabled) eqPresetName = eqPresetName === 'custom' ? 'custom' : eqPresetName;
  applyEqGains();
  syncEqToggle();
  saveEqPreference();
}

function toggleEqEnabled() {
  setEqEnabled(!eqEnabled);
}

/* ---------- UI 同步 ---------- */
function syncEqSliders() {
  for (var i = 0; i < 10; i++) {
    var slider = document.getElementById('eq-slider-' + i);
    if (slider) slider.value = String(eqBands[i]);
    var val = document.getElementById('eq-value-' + i);
    if (val) val.textContent = (eqBands[i] > 0 ? '+' : '') + eqBands[i].toFixed(1);
  }
}

function syncEqPresetButtons() {
  var buttons = document.querySelectorAll('.eq-preset-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle('active', buttons[i].dataset.preset === eqPresetName);
  }
}

function syncEqToggle() {
  var toggle = document.getElementById('eq-toggle-btn');
  if (toggle) {
    toggle.classList.toggle('on', eqEnabled);
    toggle.setAttribute('aria-pressed', eqEnabled ? 'true' : 'false');
  }
  var popover = document.getElementById('eq-control');
  if (popover) popover.classList.toggle('eq-disabled', !eqEnabled);
}

/* 检测当前是否处于 captureStream 降级模式（EQ 无效） */
function eqIsCaptureDegraded() {
  try {
    return !!(source && source.__mineradioUsesCapture);
  } catch (e) {
    return false;
  }
}

function syncEqDegradedState() {
  var popover = document.getElementById('eq-control');
  if (!popover) return;
  var degraded = eqIsCaptureDegraded();
  popover.classList.toggle('eq-degraded', degraded);
  var warn = document.getElementById('eq-degraded-warn');
  if (warn) warn.style.display = degraded ? '' : 'none';
}

/* ---------- UI 绑定 ---------- */
function bindEqualizerControls() {
  // 10 个滑块
  for (var i = 0; i < 10; i++) {
    var slider = document.getElementById('eq-slider-' + i);
    if (slider && !slider.dataset.eqBound) {
      slider.dataset.eqBound = '1';
      (function (idx) {
        slider.addEventListener('input', function (e) {
          setEqBand(idx, parseFloat(e.target.value));
          var val = document.getElementById('eq-value-' + idx);
          if (val) {
            var v = parseFloat(e.target.value);
            val.textContent = (v > 0 ? '+' : '') + v.toFixed(1);
          }
        });
      })(i);
    }
  }
  // 预设按钮
  var presetBtns = document.querySelectorAll('.eq-preset-btn');
  for (var j = 0; j < presetBtns.length; j++) {
    if (!presetBtns[j].dataset.eqBound) {
      presetBtns[j].dataset.eqBound = '1';
      (function (btn) {
        btn.addEventListener('click', function () {
          setEqPreset(btn.dataset.preset);
        });
      })(presetBtns[j]);
    }
  }
  // 开关
  var toggle = document.getElementById('eq-toggle-btn');
  if (toggle && !toggle.dataset.eqBound) {
    toggle.dataset.eqBound = '1';
    toggle.addEventListener('click', toggleEqEnabled);
  }
  // 初始同步
  syncEqSliders();
  syncEqPresetButtons();
  syncEqToggle();
}

/* ---------- 面板开关（仿 toggleVolumePanel） ---------- */
function toggleEqPanel(e) {
  if (e) e.stopPropagation();
  var control = document.getElementById('eq-control');
  if (!control) return;
  control.classList.toggle('open');
  if (control.classList.contains('open')) {
    syncEqSliders();
    syncEqPresetButtons();
    syncEqToggle();
    syncEqDegradedState();
  }
}
