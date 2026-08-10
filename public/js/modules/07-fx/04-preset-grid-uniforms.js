function buildPresetGrid() {
  var grid = document.getElementById('preset-grid');
  if (!grid) return;
  var seen = {};
  var order = presetDisplayOrder.filter(function (id) {
    var ok = id >= 0 && id < presetMeta.length && !seen[id];
    seen[id] = true;
    return ok;
  });
  presetMeta.forEach(function (_, id) {
    if (!seen[id]) order.push(id);
  });
  grid.innerHTML = order.map(function (i) {
    var p = presetMeta[i];
    var name = p.nameHtml || p.name;
    var desc = p.descHtml || p.desc;
    return '<div class="preset-card" data-preset="' + i + '" onclick="setPreset(' + i + ')">' +
      '<div class="pc-icon">' + presetIcons[i] + '</div>' +
      '<div class="pc-name">' + name + '</div>' +
      '<div class="pc-desc">' + desc + '</div>' +
      '</div>';
  }).join('') + buildFilmRadioPresetCard();
  refreshPresetGrid();
}

/* 胶片电台：独立于数值预设之外的特殊卡片，点击切换全屏黑胶播放器 */
function buildFilmRadioPresetCard() {
  return '<div class="preset-card film-radio-card" data-film-radio="1" onclick="toggleFilmRadioMode()" title="胶片电台">' +
    '<div class="pc-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/><path d="M14.9 4.6a7.2 7.2 0 0 1 4.5 4.5"/></svg></div>' +
    '<div class="pc-name">胶片电台</div>' +
    '<div class="pc-desc">黑胶 · 居中歌词</div>' +
    '</div>';
}

function refreshPresetGrid() {
  document.querySelectorAll('.preset-card').forEach(function (el) {
    var filmRadio = el.getAttribute('data-film-radio');
    if (filmRadio) {
      el.classList.toggle('active', !!(typeof filmRadioMode !== 'undefined' && filmRadioMode));
      return;
    }
    el.classList.toggle('active', Number(el.dataset.preset) === fx.preset);
  });
}
function triggerPresetParticleTransition(fromPreset, toPreset) {
  presetTransition.active = true;
  presetTransition.start = uniforms.uTime.value;
  presetTransition.duration = toPreset === 5 ? 0.30 : 0.24;
  presetTransition.from = fromPreset;
  presetTransition.to = toPreset;
  var newVisual = toPreset >= 4;
  var wallpaperFlow = toPreset === 5;
  uniforms.uScatter.value = Math.max(uniforms.uScatter.value, fx.scatter + (newVisual ? (wallpaperFlow ? 0.008 : 0.024) : 0.12));
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, wallpaperFlow ? 0.05 : 0.15);
  camPunch = Math.max(camPunch, wallpaperFlow ? 0.04 : 0.12);
  for (var i = 0; i < 3; i++) {
    triggerRipple((Math.random() - 0.5) * 3.4, (Math.random() - 0.5) * 3.4, 0.58 + Math.random() * 0.32);
  }
  var card = document.querySelector('.preset-card[data-preset="' + toPreset + '"]');
  if (card) {
    card.classList.remove('switching');
    void card.offsetWidth;
    card.classList.add('switching');
    setTimeout(function () { card.classList.remove('switching'); }, 760);
  }
}
function tickPresetTransition() {
  if (!presetTransition.active) return;
  var raw = (uniforms.uTime.value - presetTransition.start) / presetTransition.duration;
  var t = Math.max(0, Math.min(1, raw));
  var wave = Math.sin(t * Math.PI);
  var newVisual = presetTransition.to >= 4;
  var wallpaperFlow = presetTransition.to === 5;
  uniforms.uScatter.value = Math.max(uniforms.uScatter.value, fx.scatter + wave * (newVisual ? (wallpaperFlow ? 0.008 : 0.026) : 0.16));
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, wave * (wallpaperFlow ? 0.045 : (newVisual ? 0.12 : 0.15)));
  uniforms.uPointScale.value = fx.point * (1 + wave * (wallpaperFlow ? 0.016 : 0.048));
  if (raw >= 1) {
    presetTransition.active = false;
    syncFxUniforms();
  }
}
function setPreset(p, opts) {
  opts = opts || {};
  p = Math.max(0, Math.min(presetMeta.length - 1, Number(p) || 0));
  var prev = fx.preset;
  var changed = prev !== p;
  // 切换到其他预设时退出胶片电台（全屏黑胶播放器）
  if (changed && typeof filmRadioMode !== 'undefined' && filmRadioMode && typeof applyFilmRadioMode === 'function') {
    applyFilmRadioMode(false, { save: true });
  }
  fx.preset = p;
  if (changed && prev === SKULL_PRESET_INDEX && p !== SKULL_PRESET_INDEX) clearSkullPresetResidue();
  if (p === SKULL_PRESET_INDEX) loadSkullParticleAsset();
  if (changed && window.OrangeseaSonicTopography) OrangeseaSonicTopography.onPresetChange(prev, p, { scene: scene, fx: fx });
  uniforms.uPreset.value = p;
  // 演唱会预设: 立即创建荧光棒灯海 (主循环可能被 vsync 跟随节流跳过, 导致灯海不出现)
  if (p === CONCERT_PRESET_INDEX && typeof updateConcertStage === 'function') {
    try { updateConcertStage(0.016); } catch (e) { if (typeof console !== 'undefined') console.warn('[concert] immediate build failed', e); }
  }
  refreshPresetGrid();
  if (typeof updateSonicSeriesControlVisibility === 'function') updateSonicSeriesControlVisibility();
  if (typeof updateSonicWorkshopColorControls === 'function') updateSonicWorkshopColorControls();
  if (changed && !opts.skipTransition) triggerPresetParticleTransition(prev, p);
  // 每个预设对应的相机基线 (改 userOrbit)
  if (changed && !opts.preserveCamera) {
    if (p === 5) {
      captureCurrentOrbitAsBaseline();
      requestStageLyricCameraSnap(12);
    } else if (typeof applyPresetOrbitBaseline === 'function') {
      applyPresetOrbitBaseline(p);
    }
  }
  if (changed && !opts.silent) showToast('视觉预设: ' + presetMeta[p].name);
  var shouldCommitPlaybackPreset = !!opts.commitPlaybackPreset || !opts.noSave;
  if (shouldCommitPlaybackPreset) {
    playbackVisualPreset = p;
    startupVisualPreviewActive = false;
  }
  if (!opts.noSave) {
    saveLyricLayout({ user: !opts.silent, reason: 'preset' });
  }
}

function syncFxUniforms() {
  uniforms.uPreset.value = fx.preset;
  uniforms.uIntensity.value = fx.intensity;
  uniforms.uDepth.value = fx.depth;
  uniforms.uPointScale.value = fx.point;
  uniforms.uSpeed.value = fx.speed;
  uniforms.uTwist.value = fx.twist;
  uniforms.uColorBoost.value = fx.color;
  uniforms.uScatter.value = fx.scatter;
  uniforms.uCoverRes.value = normalizeCoverResolution(fx.coverResolution);
  uniforms.uBgFade.value = fx.bgFade;
  uniforms.uBloomStrength.value = fx.bloom ? fx.bloomStrength : 0;
  if (bloomParticles) bloomParticles.visible = fx.bloom && fx.bloomStrength > 0.01;
  uniforms.uEdgeEnabled.value = fx.edge ? 1 : 0;
  if (uniforms.uTintColor) uniforms.uTintColor.value.set(normalizeHexColor(fx.visualTintColor || '#ff9c6e'));
  if (uniforms.uTintStrength) uniforms.uTintStrength.value = fx.visualTintMode === 'custom' ? 0.42 : 0;
  syncSkullParticleColors();
}
