/* =========================================================================
   OrangeSea · 风格世界自适应质量
   复用主渲染器、普通 DPR 与全局帧压力，不创建独立调度器。
   ========================================================================= */

var genreWorldAdaptiveQualityState = {
  profileSignature: '',
  pixelRatio: null
};

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
  var signature = JSON.stringify(profile);
  var changed = false;
  if (force || signature !== genreWorldAdaptiveQualityState.profileSignature) {
    genreWorldAdaptiveQualityState.profileSignature = signature;
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
  var ordinaryDpr = genreWorldOrdinaryPixelRatio();
  var changed = applyGenreWorldPixelRatio(ordinaryDpr, false);
  genreWorldAdaptiveQualityState.profileSignature = '';
  genreWorldAdaptiveQualityState.pixelRatio = null;
  return changed;
}
