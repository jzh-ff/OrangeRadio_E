// ============================================================

document.body.classList.add('splash-active');
var splashAnimating = true;
var splashCanvas = null, splashCtx = null;
var splashGl = null, splashGlProgram = null, splashGlBuffer = null, splashGlUniforms = null;
var splashW = 0, splashH = 0;
var splashDust = [];
var splashStreaks = [];
var splashShards = [];
var splashPixelRatio = 1;
var splashStartedAt = performance.now();
var splashSoundPlayed = false;
var splashAudioCtx = null;
var splashSoundFallbackArmed = false;
var splashTimer = null;
var reduceSplashMotion = false;
var splashReadyToEnter = false;
var splashPointerTargetX = 0, splashPointerTargetY = 0;
var splashPointerX = 0, splashPointerY = 0;

function splashClamp01(v) { return Math.max(0, Math.min(1, v)); }
function splashSmoothstep(edge0, edge1, x) {
  var t = splashClamp01((x - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function splashEaseOutCubic(t) {
  t = splashClamp01(t);
  return 1 - Math.pow(1 - t, 3);
}
function splashTimelineElapsed(elapsed) {
  return elapsed;
}
function updateSplashParallax() {
  var easing = reduceSplashMotion ? 1 : 0.075;
  splashPointerX += (splashPointerTargetX - splashPointerX) * easing;
  splashPointerY += (splashPointerTargetY - splashPointerY) * easing;
  var splash = document.getElementById('splash');
  if (!splash) return;
  splash.style.setProperty('--splash-fx-x', (-splashPointerX * 15).toFixed(2) + 'px');
  splash.style.setProperty('--splash-fx-y', (-splashPointerY * 10).toFixed(2) + 'px');
  splash.style.setProperty('--splash-content-x', (splashPointerX * 5).toFixed(2) + 'px');
  splash.style.setProperty('--splash-content-y', (splashPointerY * 3).toFixed(2) + 'px');
}
function stopSplashIntroSound() {
  if (!splashAudioCtx) return;
  try {
    if (splashAudioCtx.close) splashAudioCtx.close();
  } catch (e) { }
  splashAudioCtx = null;
}
function releaseStartupFastSkipPreload() {
  if (!document.documentElement.classList.contains('startup-fast-skip-preload')) return false;
  document.body.classList.add('startup-fast-skip-revealing');
  // This gate hides the whole renderer (including the player console) before
  // the fast-skip splash is released. Full desktop mode briefly hides and
  // reparents the Chromium HWND; waiting for another rAF here can therefore
  // leave the gate latched forever while only the native desktop controller is
  // visible. Release the gate synchronously, then keep only the cosmetic reveal
  // class on a timer.
  document.documentElement.classList.remove('startup-fast-skip-preload');
  setTimeout(function () { document.body.classList.remove('startup-fast-skip-revealing'); }, 520);
  return true;
}

function initMineradioSplashWebgl(canvas) {
  var gl = null;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    }) || canvas.getContext('experimental-webgl');
  } catch (e) {
    gl = null;
  }
  if (!gl) return false;

  var vertexSource = [
    'attribute vec2 aPosition;',
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = aPosition * 0.5 + 0.5;',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}'
  ].join('\n');

  var fragmentSource = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform vec2 uResolution;',
    'uniform float uTime;',
    'uniform vec2 uPointer;',
    '',
    'float saturate(float v){ return clamp(v, 0.0, 1.0); }',
    'float ease(float v){ v = saturate(v); return v * v * (3.0 - 2.0 * v); }',
    'float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
    'float noise21(vec2 p){',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);',
    '}',
    'float fbm(vec2 p){',
    '  float value = 0.0;',
    '  float amp = 0.52;',
    '  for(int i = 0; i < 5; i++){',
    '    value += noise21(p) * amp;',
    '    p = mat2(1.62, -1.18, 1.18, 1.62) * p + 0.17;',
    '    amp *= 0.50;',
    '  }',
    '  return value;',
    '}',
    '',
    'void main(){',
    '  vec2 p = vUv * 2.0 - 1.0;',
    '  float aspect = uResolution.x / max(uResolution.y, 1.0);',
    '  p.x *= aspect;',
    '  float t = uTime;',
    '  p += vec2(uPointer.x * 0.032, -uPointer.y * 0.020);',
    '  float intro = ease(t / 0.95);',
    '  float horizon = -0.105;',
    '  float sunX = aspect * 0.34;',
    '',
    '  vec3 night = vec3(0.004, 0.010, 0.017);',
    '  vec3 blueHour = vec3(0.018, 0.046, 0.064);',
    '  vec3 dusk = vec3(0.145, 0.055, 0.063);',
    '  vec3 peach = vec3(0.94, 0.255, 0.105);',
    '  float skyHeight = smoothstep(horizon - 0.02, 1.04, p.y);',
    '  vec3 sky = mix(mix(dusk, blueHour, smoothstep(0.00, 0.72, skyHeight)), night, smoothstep(0.58, 1.0, skyHeight));',
    '  float horizonGlow = exp(-abs(p.y - horizon) * 5.2) * exp(-abs(p.x - sunX) * 0.42);',
    '  sky += peach * horizonGlow * 0.22;',
    '',
    '  float cloudNoise = fbm(vec2(p.x * 0.52 - t * 0.018, p.y * 2.15 + t * 0.006) + vec2(3.1, 1.7));',
    '  float cloudBand = smoothstep(0.48, 0.78, cloudNoise) * smoothstep(horizon + 0.03, horizon + 0.52, p.y) * (1.0 - smoothstep(0.50, 0.98, p.y));',
    '  sky += mix(vec3(0.08, 0.15, 0.17), vec3(0.28, 0.10, 0.09), smoothstep(-0.8, 0.8, p.x)) * cloudBand * 0.18;',
    '  float ribbonA = exp(-abs(p.y - (0.30 + sin(p.x * 1.18 + t * 0.16) * 0.072 + sin(p.x * 2.8 - t * 0.11) * 0.022)) * 19.0);',
    '  float ribbonB = exp(-abs(p.y - (0.52 + sin(p.x * 0.82 - t * 0.12 + 1.7) * 0.085)) * 15.0);',
    '  float ribbonMask = smoothstep(horizon + 0.18, horizon + 0.45, p.y) * (1.0 - smoothstep(0.74, 1.02, p.y));',
    '  sky += mix(vec3(0.04, 0.36, 0.38), vec3(0.40, 0.08, 0.18), smoothstep(-aspect * 0.45, aspect * 0.55, p.x)) * ribbonA * ribbonMask * 0.18;',
    '  sky += mix(vec3(0.08, 0.18, 0.30), vec3(0.34, 0.12, 0.14), vUv.x) * ribbonB * ribbonMask * 0.105;',
    '',
    '  vec2 starUv = vec2((p.x + aspect) * 26.0, (p.y + 1.0) * 22.0);',
    '  vec2 starCell = floor(starUv);',
    '  vec2 starLocal = fract(starUv) - 0.5;',
    '  float starSeed = hash21(starCell);',
    '  vec2 starOffset = vec2(hash21(starCell + 2.3), hash21(starCell + 7.1)) - 0.5;',
    '  float starDot = 1.0 - smoothstep(0.018, 0.070, length(starLocal - starOffset * 0.62));',
    '  float stars = starDot * step(0.945, starSeed) * (0.55 + 0.45 * sin(t * (0.7 + starSeed) + starSeed * 19.0));',
    '  stars *= smoothstep(horizon + 0.28, 0.92, p.y) * (1.0 - cloudBand);',
    '  sky += vec3(0.74, 0.88, 0.92) * stars * 0.34;',
    '',
    '  float sunRise = ease((t - 0.12) / 1.35);',
    '  vec2 sunPos = vec2(sunX, mix(horizon - 0.045, 0.115, sunRise));',
    '  float sunD = length(p - sunPos);',
    '  float sunDisc = (1.0 - smoothstep(0.186, 0.201, sunD)) * smoothstep(horizon - 0.010, horizon + 0.022, p.y);',
    '  float sunAura = exp(-sunD * 5.25) * (0.66 + 0.11 * sin(t * 0.72));',
    '  sky += vec3(1.0, 0.29, 0.10) * sunAura * 0.28 * sunRise;',
    '  vec2 sunVector = p - sunPos;',
    '  float sunAngle = atan(sunVector.y, sunVector.x);',
    '  float rayNoise = fbm(vec2(sunAngle * 2.8, sunD * 2.1 - t * 0.055));',
    '  float rays = pow(max(0.0, sin(sunAngle * 13.0 + rayNoise * 2.8 + t * 0.08)), 16.0) * exp(-sunD * 1.65);',
    '  rays *= smoothstep(0.21, 0.34, sunD) * smoothstep(horizon - 0.02, horizon + 0.20, p.y);',
    '  sky += mix(vec3(1.0, 0.22, 0.07), vec3(0.18, 0.64, 0.66), vUv.x) * rays * 0.055 * sunRise;',
    '  float ringPhase = fract(max(t - 0.18, 0.0) * 0.18);',
    '  float energyRing = exp(-abs(sunD - (0.22 + ringPhase * 0.72)) * 105.0) * pow(1.0 - ringPhase, 2.2);',
    '  sky += mix(vec3(1.0, 0.34, 0.10), vec3(0.24, 0.72, 0.74), vUv.x) * energyRing * 0.22 * sunRise;',
    '  float sunSurface = fbm(vec2((p.x - sunX) * 8.0, (p.y - sunPos.y) * 13.0 + t * 0.012));',
    '  float sunBands = 0.94 + 0.035 * sin((p.y - sunPos.y) * 175.0 + sunSurface * 3.2) + (sunSurface - 0.5) * 0.045;',
    '  vec3 sunColor = mix(vec3(1.0, 0.31, 0.075), vec3(1.0, 0.68, 0.31), smoothstep(-0.20, 0.20, p.y - sunPos.y));',
    '  float sunRim = exp(-abs(sunD - 0.194) * 82.0) * smoothstep(horizon - 0.010, horizon + 0.022, p.y);',
    '  sky = mix(sky, sunColor * sunBands, sunDisc * 0.97);',
    '  sky += vec3(1.0, 0.48, 0.20) * sunRim * 0.085 * sunRise;',
    '',
    '  float waterMask = 1.0 - smoothstep(horizon - 0.018, horizon + 0.022, p.y);',
    '  float depth = saturate((horizon - p.y) / 0.91);',
    '  vec3 water = mix(vec3(0.025, 0.055, 0.070), vec3(0.002, 0.009, 0.015), smoothstep(0.0, 1.0, depth));',
    '  float waterNoise = fbm(vec2(p.x * 0.72 + t * 0.028, p.y * 8.0 - t * 0.035));',
    '  water += vec3(0.02, 0.07, 0.082) * (waterNoise - 0.48) * (0.42 + depth * 0.58);',
    '',
    '  float reflectionBand = exp(-abs(p.x - sunX) / (0.055 + depth * 0.38));',
    '  float reflectionBreak = pow(max(0.0, sin((horizon - p.y) * (145.0 - depth * 58.0) + noise21(vec2((p.x - sunX) * 11.0, p.y * 46.0 - t * 1.5)) * 6.0)), 10.0);',
    '  float reflection = reflectionBand * reflectionBreak * (1.0 - depth * 0.72);',
    '  float reflectionCore = exp(-abs(p.x - sunX) / (0.024 + depth * 0.15)) * exp(-depth * 2.15);',
    '  water += vec3(1.0, 0.24, 0.065) * reflectionBand * exp(-depth * 1.7) * 0.055 * sunRise;',
    '  water += vec3(1.0, 0.54, 0.22) * reflectionCore * 0.12 * sunRise;',
    '  water += mix(vec3(1.0, 0.20, 0.06), vec3(1.0, 0.67, 0.34), reflectionBreak) * reflection * 0.72 * sunRise;',
    '',
    '  vec3 waveLight = vec3(0.0);',
    '  for(int i = 0; i < 8; i++){',
    '    float fi = float(i);',
    '    float laneY = horizon - 0.024 - fi * 0.046 - fi * fi * 0.0122;',
    '    float phase = p.x * (8.2 + fi * 1.55) + t * (0.52 + fi * 0.055) + fi * 1.31;',
    '    float waveY = laneY + sin(phase) * (0.0038 + fi * 0.0018) + sin(phase * 2.13 - t * 0.31) * (0.0014 + fi * 0.0007);',
    '    float crest = exp(-abs(p.y - waveY) * (300.0 / (1.0 + fi * 0.34)));',
    '    float sideFade = exp(-abs(p.x) * (0.16 + fi * 0.018));',
    '    vec3 crestColor = mix(vec3(1.0, 0.34, 0.12), vec3(0.22, 0.72, 0.76), smoothstep(-aspect * 0.35, aspect * 0.52, p.x));',
    '    waveLight += crestColor * crest * sideFade * (0.075 + fi * 0.007);',
    '  }',
    '  water += waveLight * (0.70 + 0.30 * sunRise);',
    '',
    '  float audioWaveY = horizon + sin(p.x * 8.5 - t * 1.15) * 0.0045 + sin(p.x * 21.0 + t * 0.74) * 0.0018;',
    '  float audioTide = exp(-abs(p.y - audioWaveY) * 460.0) * exp(-abs(p.x) * 0.52);',
    '  vec3 horizonColor = mix(vec3(1.0, 0.30, 0.10), vec3(0.42, 0.88, 0.88), smoothstep(-0.65, 0.78, p.x));',
    '  water += horizonColor * audioTide * (0.48 + 0.12 * sin(t * 1.4));',
    '',
    '  vec3 col = mix(sky, water, waterMask);',
    '  float skyMask = 1.0 - waterMask;',
    '  float cometCycle = fract((t + 1.8) * 0.082);',
    '  vec2 cometHead = vec2(mix(-aspect * 1.24, aspect * 1.24, cometCycle), mix(0.84, 0.24, cometCycle));',
    '  vec2 cometDelta = p - cometHead;',
    '  float cometTail = exp(-abs(cometDelta.y + cometDelta.x * 0.235) * 94.0) * exp(cometDelta.x * 3.8) * step(cometDelta.x, 0.0);',
    '  float cometCore = exp(-length(cometDelta) * 58.0);',
    '  float cometFade = smoothstep(0.03, 0.15, cometCycle) * (1.0 - smoothstep(0.78, 0.96, cometCycle));',
    '  col += mix(vec3(1.0, 0.42, 0.18), vec3(0.38, 0.88, 0.94), cometCycle) * (cometTail * 0.15 + cometCore * 0.72) * cometFade * skyMask;',
    '  vec2 shockUv = vec2((p.x - sunPos.x) / max(aspect, 1.0), (p.y - sunPos.y) * 0.86);',
    '  float shockPhase = fract(max(t - 0.18, 0.0) * 0.115);',
    '  float shockRing = exp(-abs(length(shockUv) - (0.10 + shockPhase * 1.34)) * 105.0) * pow(1.0 - shockPhase, 2.0);',
    '  col += mix(vec3(1.0, 0.20, 0.06), vec3(0.16, 0.72, 0.78), vUv.x) * shockRing * 0.075 * sunRise;',
    '  float barCell = floor((p.x + aspect) * 38.0);',
    '  float barSeed = hash21(vec2(barCell, 4.7));',
    '  float barBeat = 0.45 + 0.55 * sin(t * (1.4 + barSeed * 1.8) + barSeed * 16.0);',
    '  float barHeight = (0.006 + barSeed * 0.026) * (0.42 + barBeat * 0.58);',
    '  float spectrumBar = (1.0 - smoothstep(barHeight, barHeight + 0.003, abs(p.y - horizon))) * smoothstep(0.10, 0.48, abs(fract((p.x + aspect) * 38.0) - 0.5));',
    '  col += mix(vec3(1.0, 0.28, 0.08), vec3(0.24, 0.80, 0.84), vUv.x) * spectrumBar * 0.17;',
    '  float horizonCore = exp(-abs(p.y - horizon) * 380.0);',
    '  col += horizonColor * horizonCore * 0.32;',
    '  float lensFlare = exp(-abs(p.y - horizon) * 92.0) * exp(-abs(p.x - sunX) * 0.62);',
    '  col += mix(vec3(1.0, 0.24, 0.07), vec3(0.30, 0.78, 0.80), smoothstep(-0.6, 0.72, p.x)) * lensFlare * (0.12 + 0.035 * sin(t * 1.2));',
    '',
    '  float scan = 0.975 + 0.025 * sin((vUv.y * uResolution.y + t * 16.0) * 1.22);',
    '  float grain = hash21(vUv * uResolution.xy + fract(t * 41.0)) - 0.5;',
    '  col *= scan;',
    '  col += grain * 0.012;',
    '  float vignette = smoothstep(1.32, 0.18, length(vec2(p.x / max(aspect, 1.0), p.y) * vec2(0.92, 1.03)));',
    '  col *= 0.38 + vignette * 0.78;',
    '  col *= intro;',
    '  col = vec3(1.0) - exp(-max(col, 0.0) * 1.08);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Splash shader compile failed:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  var vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
  var fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return false;

  var program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Splash shader link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return false;
  }

  splashGl = gl;
  splashGlProgram = program;
  splashGlBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, splashGlBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  splashGlUniforms = {
    position: gl.getAttribLocation(program, 'aPosition'),
    resolution: gl.getUniformLocation(program, 'uResolution'),
    time: gl.getUniformLocation(program, 'uTime'),
    pointer: gl.getUniformLocation(program, 'uPointer')
  };
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  return true;
}

function drawMineradioSplashWebgl(elapsed) {
  var gl = splashGl;
  if (!gl || !splashGlProgram || !splashGlUniforms) return;
  gl.viewport(0, 0, splashCanvas.width, splashCanvas.height);
  gl.useProgram(splashGlProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, splashGlBuffer);
  gl.enableVertexAttribArray(splashGlUniforms.position);
  gl.vertexAttribPointer(splashGlUniforms.position, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(splashGlUniforms.resolution, splashCanvas.width, splashCanvas.height);
  gl.uniform1f(splashGlUniforms.time, elapsed);
  gl.uniform2f(splashGlUniforms.pointer, splashPointerX, splashPointerY);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

(function initMineradioSplashCanvas() {
  splashCanvas = document.getElementById('splash-canvas');
  if (!splashCanvas) return;
  if (!reduceSplashMotion && initMineradioSplashWebgl(splashCanvas)) {
    splashCtx = null;
  } else {
    splashCtx = splashCanvas.getContext('2d');
  }
  function resize() {
    splashPixelRatio = Math.min(1.6, Math.max(1, window.devicePixelRatio || 1));
    splashW = window.innerWidth;
    splashH = window.innerHeight;
    splashCanvas.width = Math.max(1, Math.floor(splashW * splashPixelRatio));
    splashCanvas.height = Math.max(1, Math.floor(splashH * splashPixelRatio));
    if (splashCtx) splashCtx.setTransform(splashPixelRatio, 0, 0, splashPixelRatio, 0, 0);
    if (splashGl) splashGl.viewport(0, 0, splashCanvas.width, splashCanvas.height);
    splashDust = [];
    splashStreaks = [];
    splashShards = [];
    var count = reduceSplashMotion ? 28 : 84;
    for (var i = 0; i < count; i++) {
      splashDust.push({
        x: Math.random() * splashW,
        y: Math.random() * splashH,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.11,
        r: Math.random() * 1.35 + 0.28,
        a: Math.random() * 0.105 + 0.025,
        p: Math.random() * Math.PI * 2
      });
    }
    var streakColors = [
      'rgba(244,210,138,',
      'rgba(122,215,194,',
      'rgba(255,83,103,',
      'rgba(157,184,207,'
    ];
    var streakCount = reduceSplashMotion ? 6 : 22;
    for (var s = 0; s < streakCount; s++) {
      splashStreaks.push({
        x: Math.random() * splashW,
        y: splashH * (0.20 + Math.random() * 0.62),
        len: splashW * (0.12 + Math.random() * 0.24),
        width: 0.75 + Math.random() * 2.1,
        speed: splashW * (0.00028 + Math.random() * 0.00042),
        angle: (-10 + Math.random() * 20) * Math.PI / 180,
        phase: Math.random() * Math.PI * 2,
        color: streakColors[s % streakColors.length],
        delay: Math.random() * 1.1,
        alpha: 0.18 + Math.random() * 0.36
      });
    }
    var shardCount = reduceSplashMotion ? 10 : 34;
    for (var h = 0; h < shardCount; h++) {
      splashShards.push({
        ox: (Math.random() - 0.5) * splashW * 0.92,
        oy: (Math.random() - 0.5) * splashH * 0.22,
        w: 18 + Math.random() * 86,
        h: 1 + Math.random() * 5,
        skew: (Math.random() - 0.5) * 20,
        phase: Math.random() * Math.PI * 2,
        color: streakColors[h % streakColors.length],
        alpha: 0.10 + Math.random() * 0.24
      });
    }
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', function (event) {
    if (!splashAnimating || reduceSplashMotion) return;
    splashPointerTargetX = splashClamp01(event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    splashPointerTargetY = splashClamp01(event.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
  }, { passive: true });
  window.addEventListener('pointerleave', function () {
    splashPointerTargetX = 0;
    splashPointerTargetY = 0;
  }, { passive: true });
  drawMineradioSplash();
})();

function drawMineradioSplash() {
  if (!splashAnimating || (!splashCtx && !splashGl)) return;
  requestAnimationFrame(drawMineradioSplash);
  var elapsed = splashTimelineElapsed((performance.now() - splashStartedAt) / 1000);
  updateSplashParallax();
  if (splashGl && splashGlProgram) {
    drawMineradioSplashWebgl(elapsed);
    return;
  }

  splashCtx.clearRect(0, 0, splashW, splashH);
  var intro = splashSmoothstep(0, 0.95, elapsed);
  var horizon = splashH * 0.555;
  var rise = splashSmoothstep(0.10, 1.45, elapsed);
  var sunY = horizon + 34 - rise * Math.min(116, splashH * 0.145);
  var sunR = Math.min(splashW, splashH) * 0.098;
  var sunX2d = splashW * 0.68;

  splashCtx.save();
  splashCtx.globalAlpha = intro;

  var sky = splashCtx.createLinearGradient(0, 0, 0, horizon + 1);
  sky.addColorStop(0, '#02070c');
  sky.addColorStop(0.44, '#07151d');
  sky.addColorStop(0.78, '#291319');
  sky.addColorStop(1, '#7d2818');
  splashCtx.fillStyle = sky;
  splashCtx.fillRect(0, 0, splashW, horizon + 1);

  var glow = splashCtx.createRadialGradient(sunX2d, sunY, 0, sunX2d, sunY, Math.max(splashW * 0.34, 320));
  glow.addColorStop(0, 'rgba(255,118,55,.26)');
  glow.addColorStop(0.28, 'rgba(255,105,48,.10)');
  glow.addColorStop(1, 'rgba(255,92,42,0)');
  splashCtx.fillStyle = glow;
  splashCtx.fillRect(0, 0, splashW, horizon + 1);

  for (var di = 0; di < splashDust.length; di++) {
    var dust = splashDust[di];
    if (dust.y > horizon - 30) continue;
    dust.x += dust.vx * 0.28;
    dust.y += dust.vy * 0.18;
    var twinkle = dust.a * (0.28 + Math.sin(dust.p + elapsed * 0.75) * 0.18);
    splashCtx.fillStyle = 'rgba(214,235,238,' + Math.max(0, twinkle).toFixed(3) + ')';
    splashCtx.fillRect(dust.x, dust.y, Math.max(.7, dust.r * .7), Math.max(.7, dust.r * .7));
  }

  var aura = splashCtx.createRadialGradient(sunX2d, sunY, sunR * 0.5, sunX2d, sunY, sunR * 2.9);
  aura.addColorStop(0, 'rgba(255,120,57,.34)');
  aura.addColorStop(1, 'rgba(255,98,43,0)');
  splashCtx.fillStyle = aura;
  splashCtx.beginPath();
  splashCtx.arc(sunX2d, sunY, sunR * 2.9, 0, Math.PI * 2);
  splashCtx.fill();

  splashCtx.fillStyle = '#ff7135';
  splashCtx.shadowColor = 'rgba(255,111,48,.48)';
  splashCtx.shadowBlur = 34;
  splashCtx.beginPath();
  splashCtx.arc(sunX2d, sunY, sunR, 0, Math.PI * 2);
  splashCtx.fill();
  splashCtx.shadowBlur = 0;

  var water = splashCtx.createLinearGradient(0, horizon, 0, splashH);
  water.addColorStop(0, '#09202a');
  water.addColorStop(0.28, '#04131b');
  water.addColorStop(1, '#010609');
  splashCtx.fillStyle = water;
  splashCtx.fillRect(0, horizon, splashW, splashH - horizon);

  splashCtx.save();
  splashCtx.globalCompositeOperation = 'lighter';
  var reflectionRows = reduceSplashMotion ? 18 : 42;
  for (var ri = 0; ri < reflectionRows; ri++) {
    var depth = ri / Math.max(1, reflectionRows - 1);
    var ry = horizon + 8 + depth * depth * (splashH - horizon - 12);
    var jitter = Math.sin(ri * 2.7 + elapsed * 1.4) * (3 + depth * 19);
    var halfW = (18 + depth * splashW * 0.16) * (0.46 + Math.abs(Math.sin(ri * 4.1 + elapsed * .55)) * .54);
    var refAlpha = (1 - depth) * (0.10 + Math.abs(Math.sin(ri * 1.9)) * 0.09);
    var rg = splashCtx.createLinearGradient(sunX2d - halfW, 0, sunX2d + halfW, 0);
    rg.addColorStop(0, 'rgba(255,91,37,0)');
    rg.addColorStop(.5, 'rgba(255,152,79,' + refAlpha.toFixed(3) + ')');
    rg.addColorStop(1, 'rgba(255,194,123,0)');
    splashCtx.strokeStyle = rg;
    splashCtx.lineWidth = 1 + depth * 1.5;
    splashCtx.beginPath();
    splashCtx.moveTo(sunX2d - halfW + jitter, ry);
    splashCtx.lineTo(sunX2d + halfW + jitter, ry);
    splashCtx.stroke();
  }

  var waveCount = reduceSplashMotion ? 5 : 9;
  for (var wi = 0; wi < waveCount; wi++) {
    var waveDepth = wi / Math.max(1, waveCount - 1);
    var baseY = horizon + 8 + waveDepth * waveDepth * (splashH - horizon - 18);
    var amp = 1.4 + waveDepth * 6.2;
    var freq = 0.012 + waveDepth * 0.007;
    splashCtx.strokeStyle = wi % 3 === 0
      ? 'rgba(255,116,56,' + (0.10 - waveDepth * 0.035).toFixed(3) + ')'
      : 'rgba(87,188,193,' + (0.075 - waveDepth * 0.025).toFixed(3) + ')';
    splashCtx.lineWidth = .7 + waveDepth * .65;
    splashCtx.beginPath();
    for (var x = -20; x <= splashW + 20; x += 8) {
      var y = baseY + Math.sin(x * freq + elapsed * (.55 + waveDepth * .32) + wi * 1.15) * amp;
      y += Math.sin(x * freq * 2.16 - elapsed * .31) * amp * .24;
      if (x === -20) splashCtx.moveTo(x, y);
      else splashCtx.lineTo(x, y);
    }
    splashCtx.stroke();
  }

  var audioWaveAlpha = .38 + Math.sin(elapsed * 1.4) * .08;
  var horizonGradient = splashCtx.createLinearGradient(splashW * .18, 0, splashW * .82, 0);
  horizonGradient.addColorStop(0, 'rgba(255,105,47,0)');
  horizonGradient.addColorStop(.34, 'rgba(255,110,51,' + audioWaveAlpha.toFixed(3) + ')');
  horizonGradient.addColorStop(.60, 'rgba(255,219,177,' + (audioWaveAlpha * .85).toFixed(3) + ')');
  horizonGradient.addColorStop(1, 'rgba(89,194,198,0)');
  splashCtx.strokeStyle = horizonGradient;
  splashCtx.lineWidth = 1.2;
  splashCtx.shadowColor = 'rgba(255,111,50,.32)';
  splashCtx.shadowBlur = 20;
  splashCtx.beginPath();
  for (var hx = splashW * .18; hx <= splashW * .82; hx += 5) {
    var hy = horizon + Math.sin(hx * .018 - elapsed * 1.1) * 1.7 + Math.sin(hx * .044 + elapsed * .7) * .55;
    if (hx === splashW * .18) splashCtx.moveTo(hx, hy);
    else splashCtx.lineTo(hx, hy);
  }
  splashCtx.stroke();
  splashCtx.restore();

  var vignette = splashCtx.createRadialGradient(splashW * .5, splashH * .5, Math.min(splashW, splashH) * .16, splashW * .5, splashH * .5, Math.max(splashW, splashH) * .72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(.72, 'rgba(0,0,0,.18)');
  vignette.addColorStop(1, 'rgba(0,0,0,.68)');
  splashCtx.fillStyle = vignette;
  splashCtx.fillRect(0, 0, splashW, splashH);

  splashCtx.globalAlpha = .055;
  splashCtx.fillStyle = '#fff';
  var scanOffset = (elapsed * 14) % 5;
  for (var sy = -scanOffset; sy < splashH; sy += 5) splashCtx.fillRect(0, sy, splashW, .45);
  splashCtx.restore();
}
function playMineradioIntroSound() {
  if (splashSoundPlayed) return;
  try {
    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    var ctx = splashAudioCtx || new AudioContextCtor();
    splashAudioCtx = ctx;
    if (ctx.state === 'suspended' && ctx.resume) {
      ctx.resume().then(function () {
        if (!splashSoundPlayed) playMineradioIntroSound();
      }).catch(function () { });
      if (ctx.state === 'suspended') return;
    }
    splashSoundPlayed = true;

    var now = ctx.currentTime + 0.02;
    var master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.052, now + 0.16);
    master.gain.exponentialRampToValueAtTime(0.034, now + 3.35);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 5.28);
    master.connect(ctx.destination);

    var noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2.45), ctx.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
      var tail = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(tail, 1.35);
    }
    var noise = ctx.createBufferSource();
    var noiseGain = ctx.createGain();
    var noiseFilter = ctx.createBiquadFilter();
    noise.buffer = noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(720, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(2400, now + 2.2);
    noiseFilter.Q.setValueAtTime(0.72, now);
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.020, now + 0.12);
    noiseGain.gain.exponentialRampToValueAtTime(0.010, now + 1.60);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.42);
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(master);
    noise.start(now); noise.stop(now + 2.46);

    var low = ctx.createOscillator();
    var lowGain = ctx.createGain();
    low.type = 'sine';
    low.frequency.setValueAtTime(86, now + 0.18);
    low.frequency.exponentialRampToValueAtTime(43, now + 1.18);
    lowGain.gain.setValueAtTime(0.0001, now + 0.12);
    lowGain.gain.exponentialRampToValueAtTime(0.032, now + 0.30);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.34);
    low.connect(lowGain); lowGain.connect(master);
    low.start(now + 0.12); low.stop(now + 1.40);

    function retroChord(frequencies, startAt, dur, peak) {
      frequencies.forEach(function (frequency, index) {
        var start = now + startAt + index * 0.036;
        var end = now + startAt + dur + index * 0.018;
        var body = ctx.createOscillator();
        var edge = ctx.createOscillator();
        var filter = ctx.createBiquadFilter();
        var gain = ctx.createGain();
        var edgeGain = ctx.createGain();
        body.type = 'triangle';
        edge.type = 'square';
        body.frequency.setValueAtTime(frequency, start);
        edge.frequency.setValueAtTime(frequency * 2, start);
        body.detune.setValueAtTime(index % 2 ? 2.5 : -2.5, start);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2350, start);
        filter.frequency.exponentialRampToValueAtTime(1450, end);
        filter.Q.setValueAtTime(0.72, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + 0.026);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        edgeGain.gain.setValueAtTime(0.0001, start);
        edgeGain.gain.linearRampToValueAtTime(peak * 0.11, start + 0.012);
        edgeGain.gain.exponentialRampToValueAtTime(0.0001, Math.min(end, start + 0.34));
        body.connect(filter); filter.connect(gain); gain.connect(master);
        edge.connect(edgeGain); edgeGain.connect(master);
        body.start(start); edge.start(start);
        body.stop(end + 0.04); edge.stop(end + 0.04);
      });
    }
    // Soft four-voice console chords: Am7 -> Fmaj7 -> Cmaj7 -> G6.
    retroChord([220.00, 261.63, 329.63, 392.00], 0.48, 0.92, 0.013);
    retroChord([174.61, 220.00, 261.63, 329.63], 1.48, 0.96, 0.012);
    retroChord([261.63, 329.63, 392.00, 493.88], 2.50, 0.98, 0.0115);
    retroChord([196.00, 246.94, 293.66, 329.63], 3.54, 1.12, 0.0125);
  } catch (e) { }
}
function armSplashSoundFallback() {
  if (splashSoundFallbackArmed) return;
  splashSoundFallbackArmed = true;
  function unlock() {
    if (!splashSoundPlayed) playMineradioIntroSound();
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
}

function finishSplashReveal(forceLoad, opts) {
  opts = opts || {};
  markAppPerf('home-revealed');
  // Never make the renderer's visibility depend on the next animation frame.
  // The desktop HWND may already be in its native handoff at this point.
  releaseStartupFastSkipPreload();
  requestAnimationFrame(function () {
    var homeShown = updateEmptyHomeVisibility({ forceLoad: forceLoad !== false });
    if (!homeShown && shouldForceEmptyHomeAfterSplash()) {
      homeSuppressed = false;
      homeForcedOpen = true;
      homeShown = updateEmptyHomeVisibility({ forceLoad: forceLoad !== false });
    }
    requestAnimationFrame(function () {
      markStartupHomeReadyForAutoplay(opts.reason || 'splash', opts.fastSkip ? 240 : 100);
      var guideStarted = maybeRunStartupVisualGuide('splash');
      if (!guideStarted && !hasAnyPlatformLogin()) maybeRunStartupLoginGuide('splash');
      else if (!guideStarted && !homeShown) maybeRunStartupLoginGuide('splash');
      setTimeout(maybeShowUploadTipOnce, 5200);
    });
  });
}

function dismissSplash(opts) {
  opts = opts || {};
  var s = document.getElementById('splash');
  if (!s || s.classList.contains('hide') || s.classList.contains('exiting')) return;
  var instant = !!opts.instant;
  markAppPerf(instant ? 'splash-skip' : 'splash-dismiss');
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  splashReadyToEnter = false;
  s.classList.remove('ready');
  setTimeout(stopSplashIntroSound, instant ? 0 : 240);
  if (instant) {
    s.classList.add('hide');
    s.style.display = 'none';
    splashAnimating = false;
    document.body.classList.remove('splash-active');
    document.body.classList.remove('splash-revealing');
    revealIdleParticles(0, 520);
    finishSplashReveal(true, { fastSkip: true, reason: 'fast-skip' });
    return;
  }
  if (typeof shouldUseIdleWallpaperPreview === 'function'
    ? shouldUseIdleWallpaperPreview(true)
    : (typeof shouldShowEmptyHomeAfterSplash === 'function' && shouldShowEmptyHomeAfterSplash())) {
    activateHomeWallpaperPreview();
  }
  revealIdleParticles(0, reduceSplashMotion ? 520 : 920);
  document.body.classList.add('splash-revealing');
  s.classList.add('exiting');

  var content = s.querySelector('.splash-content');
  if (content) {
    content.style.transition = 'opacity 360ms cubic-bezier(.22,1,.36,1), transform 520ms cubic-bezier(.22,1,.36,1)';
    content.style.opacity = '0';
    content.style.transform = 'translateY(-10px) scale(.992)';
  }

  setTimeout(function () {
    s.classList.add('hide');
    splashAnimating = false;
    document.body.classList.remove('splash-active');
    document.body.classList.remove('splash-revealing');
    if (s && s.parentNode) s.style.display = 'none';
    finishSplashReveal(true, { reason: 'splash-dismiss' });
  }, 620);
}

function markSplashReadyToEnter() {
  var s = document.getElementById('splash');
  if (!s || s.classList.contains('hide') || s.classList.contains('exiting')) return;
  markAppPerf('splash-ready');
  splashReadyToEnter = true;
  splashTimer = null;
  s.classList.add('ready');
  s.setAttribute('role', 'button');
  s.setAttribute('tabindex', '0');
  s.setAttribute('aria-label', '点击进入 OrangeSea');
}

function bindSplashEnterFlow() {
  var s = document.getElementById('splash');
  if (!s) return;
  markAppPerf('dom-content-loaded');
  if (startupFastSkipPreference) {
    dismissSplash({ instant: true });
    return;
  }
  armSplashSoundFallback();
  prewarmHomeWallpaperPreview();
  function requestSplashEnter() {
    playMineradioIntroSound();
    if (splashReadyToEnter) dismissSplash();
  }
  s.addEventListener('click', requestSplashEnter);
  document.addEventListener('keydown', function (e) {
    if (!document.body.classList.contains('splash-active')) return;
    if (e.key === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      requestSplashEnter();
    }
  });
  if (reduceSplashMotion) {
    s.classList.add('reduce-motion');
    splashTimer = setTimeout(markSplashReadyToEnter, 650);
    return;
  }
  playMineradioIntroSound();
  splashTimer = setTimeout(markSplashReadyToEnter, 1500);
}

// index-loader 异步注入时 DOM 可能已就绪：事件监听会错过，需按 readyState 直接执行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindSplashEnterFlow);
} else {
  bindSplashEnterFlow();
}
