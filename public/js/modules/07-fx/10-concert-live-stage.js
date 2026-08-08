// ============================================================
//  演唱会现场 — 聚光灯层 (CONCERT_PRESET_INDEX = 8)
//  ------------------------------------------------------------
//  三道暖白聚光灯从顶部打向舞台中央, 随低音/鼓点呼吸:
//  - 整体亮度 = 0.15 + bass*0.30 + beatPulse*0.16 (平滑逼近)
//  - 光束宽度随鼓点脉冲, 角度随高音微摆
//  常驻场景 (与 backCoverGroup 同模式), 仅该预设激活时可见。
//  粒子灯海本体由 00-pointer-cover-particles.js 的
//  uPreset < 8.5 shader 分支负责。
// ============================================================

var concertSpotlightGroup = null;
var concertSpotlightTexture = null;
var concertSpotlightOpacity = 0;

// 128x512 锥形渐变: 顶部亮暖白 → 四周透明 (光柱柔和衰减)
function buildConcertSpotlightTexture() {
  if (concertSpotlightTexture) return concertSpotlightTexture;
  var canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  var ctx = canvas.getContext('2d');
  var grad = ctx.createRadialGradient(64, 0, 6, 64, 0, 512);
  grad.addColorStop(0, 'rgba(255, 246, 228, 0.95)');
  grad.addColorStop(0.35, 'rgba(255, 238, 208, 0.55)');
  grad.addColorStop(0.72, 'rgba(255, 230, 196, 0.16)');
  grad.addColorStop(1, 'rgba(255, 224, 190, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 512);
  concertSpotlightTexture = new THREE.CanvasTexture(canvas);
  return concertSpotlightTexture;
}

// 单道光柱: 顶部光源 y≈3.5, 向下延伸 7.5
function buildConcertSpotlightBeam(x, z, tilt) {
  var mat = new THREE.MeshBasicMaterial({
    map: buildConcertSpotlightTexture(),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    opacity: 0
  });
  var mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 7.5), mat);
  mesh.position.set(x, 3.5, z);
  mesh.rotation.z = tilt;
  mesh.renderOrder = -1; // 画在背景星河之上、粒子灯海之下
  return mesh;
}

function ensureConcertSpotlightGroup() {
  if (concertSpotlightGroup || !scene || !THREE) return;
  concertSpotlightGroup = new THREE.Group();
  concertSpotlightGroup.visible = false;
  // 中央直射 + 左右两道向内倾斜的侧光
  concertSpotlightGroup.add(buildConcertSpotlightBeam(0, 0.55, 0));
  concertSpotlightGroup.add(buildConcertSpotlightBeam(-2.5, 0.35, -0.30));
  concertSpotlightGroup.add(buildConcertSpotlightBeam(2.5, 0.35, 0.30));
  scene.add(concertSpotlightGroup);
}

function updateConcertStage(dt) {
  ensureConcertSpotlightGroup();
  if (!concertSpotlightGroup) return;
  var active = typeof CONCERT_PRESET_INDEX !== 'undefined' && fx && Number(fx.preset) === CONCERT_PRESET_INDEX;
  concertSpotlightGroup.visible = active;
  if (!active) return;
  // 亮度平滑逼近, 避免光柱骤亮骤灭
  var target = 0.15 + bass * 0.30 + beatPulse * 0.16;
  concertSpotlightOpacity += (target - concertSpotlightOpacity) * Math.min(1, 0.12 * Math.max(1, (dt || 0.016) * 60));
  var beatScale = 1 + beatPulse * 0.35;
  for (var i = 0; i < concertSpotlightGroup.children.length; i++) {
    var beam = concertSpotlightGroup.children[i];
    var baseTilt = i === 0 ? 0 : (i === 1 ? -0.30 : 0.30);
    beam.material.opacity = concertSpotlightOpacity;
    beam.scale.x = beatScale;
    beam.rotation.z = baseTilt + Math.sin(uniforms.uTime.value * 1.3 + i * 2.1) * treble * 0.06;
  }
}
