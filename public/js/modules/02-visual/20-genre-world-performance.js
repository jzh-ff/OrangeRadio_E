/* =========================================================================
   OrangeSea · 风格世界自适应质量
   复用主渲染器、普通 DPR 与全局帧压力，不创建独立调度器。
   ========================================================================= */

var genreWorldAdaptiveQualityState = {
  profileSignature: '',
  pixelRatio: null,
  appliedRank: -1,
  rankStableCount: 0
};

/* DPR 档位滞回阈值：连续 N 次采样指向同一新档位才切换，避免帧耗时抖动导致反复重建 drawing buffer */
var GENRE_WORLD_RANK_HYSTERESIS = 3;

function resolveGenreWorldQualityProfile(baseQuality, pressureLevel, reducedMotion) {
  var quality = typeof normalizePerformanceQuality === 'function'
    ? normalizePerformanceQuality(baseQuality)
    : String(baseQuality || 'balanced').toLowerCase();
  var baseRank = quality === 'ultra' || quality === 'high' ? 2 : (quality === 'eco' ? 0 : 1);
  var pressure = Math.max(0, Math.min(2, Math.floor(Number(pressureLevel) || 0)));
  var rank = Math.max(0, baseRank - pressure);
  var profiles = [
    {
      level: 'low',
      particleDensity: 0.42,
      detail: 0.46,
      volumetricLight: false,
      postProcessing: false,
      dprScale: 0.72,
      maxParticles: 640,
      maxLights: 3,
      maxTextures: 3
    },
    {
      level: 'medium',
      particleDensity: 0.70,
      detail: 0.72,
      volumetricLight: true,
      postProcessing: false,
      dprScale: 0.86,
      maxParticles: 1280,
      maxLights: 5,
      maxTextures: 5
    },
    {
      level: 'high',
      particleDensity: 1,
      detail: 1,
      volumetricLight: true,
      postProcessing: true,
      dprScale: 1,
      maxParticles: 2200,
      maxLights: 8,
      maxTextures: 8
    }
  ];
  var source = profiles[rank];
  var result = {};
  for (var key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key];
  }
  if (reducedMotion) {
    result.particleDensity = Math.min(result.particleDensity, 0.30);
    result.detail = Math.min(result.detail, 0.62);
    result.volumetricLight = false;
    result.postProcessing = false;
    result.maxParticles = Math.min(result.maxParticles, 480);
  }
  return result;
}

function genreWorldReducedMotionEnabled() {
  if (typeof genreModePrefersReducedMotion === 'function') {
    try { return !!genreModePrefersReducedMotion(); } catch (err) {}
  }
  var targetWindow = typeof window !== 'undefined' ? window : null;
  if (!targetWindow || typeof targetWindow.matchMedia !== 'function') return false;
  try {
    return !!targetWindow.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    return false;
  }
}

function genreWorldOrdinaryPixelRatio() {
  if (typeof getRenderPixelRatio !== 'function') return 1;
  var value;
  try { value = Number(getRenderPixelRatio()); } catch (err) { value = 1; }
  return isFinite(value) && value > 0 ? value : 1;
}

function applyGenreWorldPixelRatio(value, force) {
  if (typeof renderer === 'undefined' || !renderer ||
    typeof renderer.setPixelRatio !== 'function') return false;
  value = Math.max(0.25, Number(value) || 1);
  var current = typeof renderer.getPixelRatio === 'function'
    ? Number(renderer.getPixelRatio())
    : genreWorldAdaptiveQualityState.pixelRatio;
  if (!force && isFinite(current) && Math.abs(current - value) < 0.015) return false;
  try {
    /* 单一所有权：genre 激活期间标记 renderer，主系统 applyRendererPowerMode 不再覆盖 */
    if (renderer.userData) renderer.userData.pixelRatioOwner = 'genre';
    renderer.setPixelRatio(value);
    var width = typeof innerWidth !== 'undefined'
      ? Number(innerWidth)
      : (typeof window !== 'undefined' ? Number(window.innerWidth) : 0);
    var height = typeof innerHeight !== 'undefined'
      ? Number(innerHeight)
      : (typeof window !== 'undefined' ? Number(window.innerHeight) : 0);
    if (typeof renderer.setSize === 'function' && width > 0 && height > 0) {
      renderer.setSize(width, height, false);
    }
    genreWorldAdaptiveQualityState.pixelRatio = value;
    return true;
  } catch (err) {
    return false;
  }
}

function syncGenreWorldAdaptiveQuality(force) {
  var state = genreWorldAdaptiveQualityState;
  var frameState = typeof adaptiveFrameLoadState !== 'undefined' && adaptiveFrameLoadState
    ? adaptiveFrameLoadState
    : {};
  var pressureValue = Math.max(0, Number(frameState.pressure) || 0);
  var pressureFromValue = pressureValue >= 4 ? 2 : (pressureValue >= 2 ? 1 : 0);
  var pressureLevel = Math.max(
    pressureFromValue,
    Math.max(0, Math.min(2, Math.floor(Number(frameState.level) || 0)))
  );
  var baseQuality = typeof fx !== 'undefined' && fx ? fx.performanceQuality : 'balanced';
  var profile = resolveGenreWorldQualityProfile(
    baseQuality,
    pressureLevel,
    genreWorldReducedMotionEnabled()
  );
  var rank = profile.level === 'high' ? 2 : (profile.level === 'medium' ? 1 : 0);

  /* 档位滞回：降档（压力恶化）立即应用以保护帧率；升档（恢复）需连续多次
     采样指向同一新档位才切换，吸收帧耗时边界抖动，避免反复重建 drawing buffer */
  if (rank !== state.appliedRank) {
    var degrading = rank < state.appliedRank;
    if (force || degrading) {
      state.rankStableCount = GENRE_WORLD_RANK_HYSTERESIS;
    } else {
      state.rankStableCount = (state.rankStableCount || 0) + 1;
    }
    if (state.rankStableCount < GENRE_WORLD_RANK_HYSTERESIS) return false;
  } else {
    state.rankStableCount = 0;
  }
  state.appliedRank = rank;

  var signature = JSON.stringify(profile);
  var changed = false;
  if (force || signature !== state.profileSignature) {
    state.profileSignature = signature;
    if (typeof setGenreWorldQuality === 'function') {
      try { setGenreWorldQuality(profile); } catch (err) {}
    }
    changed = true;
  }
  var ordinaryDpr = genreWorldOrdinaryPixelRatio();
  if (applyGenreWorldPixelRatio(ordinaryDpr * profile.dprScale, !!force)) changed = true;
  return changed;
}

function resetGenreWorldAdaptiveQuality() {
  /* 释放 renderer 所有权，交还主系统 */
  if (typeof renderer !== 'undefined' && renderer && renderer.userData) {
    renderer.userData.pixelRatioOwner = '';
  }
  var ordinaryDpr = genreWorldOrdinaryPixelRatio();
  var changed = applyGenreWorldPixelRatio(ordinaryDpr, false);
  genreWorldAdaptiveQualityState.profileSignature = '';
  genreWorldAdaptiveQualityState.pixelRatio = null;
  genreWorldAdaptiveQualityState.appliedRank = -1;
  genreWorldAdaptiveQualityState.rankStableCount = 0;
  /* 触发主系统按当前状态重应用一次（幂等，仅当值不同才真正写 renderer） */
  if (typeof applyRendererPowerMode === 'function') {
    try { applyRendererPowerMode(); } catch (err) {}
  }
  return changed;
}
