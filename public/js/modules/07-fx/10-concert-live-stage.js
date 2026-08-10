// ============================================================
//  演唱会现场 — 简约暗调灯海 (CONCERT_PRESET_INDEX = 8)
//  ------------------------------------------------------------
//  简约克制: 少量稀疏的暖光点, 低饱和, 低亮度。
//  不是密集的过曝橙黄, 而是远处若隐若现的微光。
//  preset 8 时压暗 DOM 专辑背景, 灯海成为安静的氛围。
// ============================================================

var concertStageGroup = null;
var concertSticks = null;
var concertMasterOpacity = 0;

var _stickTex = null;
function buildStickTexture() {
  if (_stickTex) return _stickTex;
  var c = document.createElement('canvas');
  c.width = 32; c.height = 64;
  var ctx = c.getContext('2d');
  var img = ctx.createImageData(32, 64);
  for (var y = 0; y < 64; y++) {
    var ya = y / 63;                  // 0(顶) .. 1(底)
    for (var x = 0; x < 32; x++) {
      var xa = (x - 16) / 16;
      var horiz = Math.exp(-xa * xa * 10.0);
      var fade = (1.0 - ya) * 0.85 + 0.15;
      var glow = horiz * fade * 0.55; // 整体偏暗, 克制
      var idx = (y * 32 + x) * 4;
      // 低饱和暖白 (不刺眼)
      img.data[idx] = 255;
      img.data[idx + 1] = 235 - ya * 25;
      img.data[idx + 2] = 205 - ya * 45;
      img.data[idx + 3] = Math.min(255, glow * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  _stickTex = new THREE.CanvasTexture(c);
  _stickTex.minFilter = THREE.LinearFilter;
  _stickTex.magFilter = THREE.LinearFilter;
  return _stickTex;
}

// ---------- 稀疏灯海 (少量, 克制) ----------
function buildGlowstickSea() {
  var COUNT = 280;                     // 少量, 稀疏
  var geo = new THREE.BufferGeometry();
  var pos = new Float32Array(COUNT * 3);
  var col = new Float32Array(COUNT * 3);
  var seeds = [];

  var rng = 0.5;
  function rand() { rng = (rng * 9301 + 49297) % 233280; return rng / 233280; }

  for (var i = 0; i < COUNT; i++) {
    var row = Math.floor(rand() * 7);
    var rowN = row / 6;
    var ang = (i % 40) / 40 * Math.PI * 2 + row * 0.9 + rand() * 0.4;
    var rad = 2.6 + rowN * 5.5 + rand() * 0.9;
    var seatY = -1.3 + rowN * 2.8 + (rand() - 0.5) * 0.4;
    pos[i * 3] = Math.cos(ang) * rad * 1.2;
    pos[i * 3 + 1] = seatY;
    pos[i * 3 + 2] = Math.sin(ang) * rad * 0.85 - 0.5;

    // 低饱和暖色, 大部分偏暗, 极少数略亮
    var v = rand();
    var brightness = 0.45 + v * 0.35;   // 整体偏暗
    col[i * 3] = brightness;
    col[i * 3 + 1] = brightness * 0.92;
    col[i * 3 + 2] = brightness * 0.78;
    seeds.push({ rowN: rowN, ang: ang, phase: rand() * Math.PI * 2, jitter: rand() });
  }
  geo.addAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.addAttribute('color', new THREE.BufferAttribute(col, 3));

  var mat = new THREE.PointsMaterial({
    map: buildStickTexture(), size: 0.6, sizeAttenuation: true,
    transparent: true, vertexColors: true,
    depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, opacity: 0
  });
  var pts = new THREE.Points(geo, mat);
  pts.userData.seeds = seeds;
  pts.renderOrder = 2;
  return pts;
}

function ensureConcertStageGroup() {
  if (concertStageGroup || !scene || !THREE) return;
  concertStageGroup = new THREE.Group();
  concertStageGroup.visible = false;
  concertSticks = buildGlowstickSea();
  concertStageGroup.add(concertSticks);
  scene.add(concertStageGroup);
}

function updateConcertStage(dt) {
  ensureConcertStageGroup();
  if (!concertStageGroup) return;
  var active = typeof CONCERT_PRESET_INDEX !== 'undefined' && fx && Number(fx.preset) === CONCERT_PRESET_INDEX;
  concertStageGroup.visible = active;

  // 压暗 DOM 专辑背景 (简约氛围)
  var bgEl = document.getElementById('album-bg');
  var bgNextEl = document.getElementById('album-bg-next');
  if (active) {
    document.body.classList.add('custom-background-override');
    if (bgEl) bgEl.style.filter = 'blur(120px) brightness(0.04) saturate(0.5)';
    if (bgNextEl) bgNextEl.style.filter = 'blur(120px) brightness(0.04) saturate(0.5)';
  } else {
    document.body.classList.remove('custom-background-override');
    if (bgEl) bgEl.style.filter = '';
    if (bgNextEl) bgNextEl.style.filter = '';
    concertMasterOpacity = 0;
    return;
  }

  var t = uniforms.uTime.value;
  var beat = beatPulse || 0;
  var bassV = bass || 0;

  if (concertMasterOpacity < 0.85) {
    concertMasterOpacity = Math.min(0.95, concertMasterOpacity + 0.30 * Math.max(1, (dt || 0.016) * 60));
  } else {
    concertMasterOpacity += (1 - concertMasterOpacity) * Math.min(1, 0.16 * Math.max(1, (dt || 0.016) * 60));
  }
  var ma = concertMasterOpacity;

  // 稀疏灯海: 缓慢挥舞, 低亮度 (克制不刺眼)
  if (concertSticks) {
    // opacity 上限低 (0.38), 保持暗调
    concertSticks.material.opacity = ma * 0.38 * (1.0 + beat * 0.15);
    concertSticks.material.size = 0.6 + beat * 0.12 + bassV * 0.08;
    var posAttr = concertSticks.geometry.attributes.position;
    var seeds = concertSticks.userData.seeds;
    var arr = posAttr.array;
    var basePositions = concertSticks.userData.basePositions;
    if (!basePositions) {
      basePositions = new Float32Array(arr);
      concertSticks.userData.basePositions = basePositions;
    }
    for (var n = 0; n < seeds.length; n++) {
      var s = seeds[n];
      var bx = basePositions[n * 3];
      var by = basePositions[n * 3 + 1];
      // 缓慢海浪 (幅度小, 克制)
      var wavePhase = s.ang * 0.9 - s.rowN * 2.0 + t * 1.3;
      var lift = Math.sin(wavePhase) * (0.18 + bassV * 0.30);
      var beatLift = Math.pow(Math.min(1, Math.max(0, (beat - 0.25) / 0.7)), 1.6) * 0.35;
      var jitter = Math.sin(t * (1.8 + s.jitter) + s.phase) * 0.05;
      arr[n * 3] = bx + jitter;
      arr[n * 3 + 1] = by + lift + beatLift + jitter * 0.5;
    }
    posAttr.needsUpdate = true;
  }
}
