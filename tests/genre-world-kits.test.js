'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const visualDir = path.join(__dirname, '..', 'public', 'js', 'modules', '02-visual');
const worldDir = path.join(visualDir, 'genre-worlds');
const lyricsPath = path.join(__dirname, '..', 'public', 'js', 'modules', '06-lyrics', '08-genre-world-lyrics.js');
const modulePaths = [
  path.join(visualDir, '17-genre-world-registry.js'),
  path.join(visualDir, '18-genre-world-engine.js'),
  path.join(worldDir, '00-shared-primitives.js'),
  path.join(worldDir, '01-electronic.js'),
  path.join(worldDir, '02-rock-metal.js'),
  path.join(worldDir, '03-hiphop.js'),
  path.join(worldDir, '04-prism.js'),
  path.join(worldDir, '05-folk.js'),
  path.join(worldDir, '06-classical.js'),
  path.join(worldDir, '07-jazz-soul.js'),
  path.join(worldDir, '08-ambient.js'),
  lyricsPath,
];

for (const modulePath of modulePaths) {
  assert.ok(fs.existsSync(modulePath), `missing genre world module: ${path.basename(modulePath)}`);
}

class FakeLayers {
  constructor(mask = 1) { this.mask = mask; }
  set(layer) { this.mask = 2 ** layer; }
}

class FakeColor {
  constructor(value) {
    this.set(value == null ? 0xffffff : value);
  }
  set(value) {
    if (value instanceof FakeColor) this.value = value.value;
    else if (typeof value === 'number' && Number.isFinite(value)) this.value = value & 0xffffff;
    else if (/^#[0-9a-f]{6}$/i.test(String(value || ''))) this.value = Number.parseInt(String(value).slice(1), 16);
    else this.value = 0xffffff;
    return this;
  }
  clone() { return new FakeColor(this.value); }
  getHex() { return this.value; }
}

class FakeVector {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new FakeVector(this.x, this.y, this.z); }
  copy(other) { return this.set(other.x, other.y, other.z); }
}

class FakeEuler extends FakeVector {}

class FakeObject3D {
  constructor() {
    this.children = [];
    this.parent = null;
    this.position = new FakeVector();
    this.rotation = new FakeEuler();
    this.scale = new FakeVector(1, 1, 1);
    this.visible = true;
    this.name = '';
    this.userData = {};
    this.layers = new FakeLayers();
  }
  add(...children) {
    for (const child of children) {
      if (child.parent) child.parent.remove(child);
      this.children.push(child);
      child.parent = this;
    }
  }
  remove(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    if (child.parent === this) child.parent = null;
  }
  traverse(visitor) {
    visitor(this);
    this.children.slice().forEach((child) => child.traverse(visitor));
  }
}

class FakeGroup extends FakeObject3D {}
class FakeGeometry {
  constructor(...args) { this.args = args; this.disposed = false; }
  setDrawRange(start, count) { this.drawRange = { start, count }; }
  dispose() { this.disposed = true; }
}
class FakeMaterial {
  constructor(options = {}) {
    Object.assign(this, options);
    if (options.color != null) this.color = new FakeColor(options.color);
    if (options.emissive != null) this.emissive = new FakeColor(options.emissive);
    this.opacity = options.opacity == null ? 1 : options.opacity;
    this.disposed = false;
  }
  dispose() { this.disposed = true; }
}
class FakeMesh extends FakeObject3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}
class FakeLineSegments extends FakeMesh {}
class FakePoints extends FakeMesh {}
class FakeLight extends FakeObject3D {
  constructor(color, intensity = 1, distance = 0) {
    super();
    this.isLight = true;
    this.color = new FakeColor(color);
    this.intensity = intensity;
    this.distance = distance;
  }
}
class FakeBufferGeometry extends FakeGeometry {
  setAttribute(name, value) { this.attributes = this.attributes || {}; this.attributes[name] = value; return this; }
}
FakePoints.prototype.isPoints = true;
class FakeBufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
}

class FakeShaderMaterial extends FakeMaterial {
  constructor(options = {}) {
    super(options);
    this.uniforms = options.uniforms || {};
    this.vertexShader = options.vertexShader || '';
    this.fragmentShader = options.fragmentShader || '';
    this.isShaderMaterial = true;
  }
}
class FakeCanvasTexture {
  constructor(canvas) {
    this.image = canvas;
    this.needsUpdate = true;
    this.isTexture = true;
    this.disposed = false;
  }
  dispose() { this.disposed = true; }
}

const THREE = {
  Color: FakeColor,
  Group: FakeGroup,
  Mesh: FakeMesh,
  LineSegments: FakeLineSegments,
  Points: FakePoints,
  BoxGeometry: FakeGeometry,
  PlaneGeometry: FakeGeometry,
  CylinderGeometry: FakeGeometry,
  TorusGeometry: FakeGeometry,
  ConeGeometry: FakeGeometry,
  OctahedronGeometry: FakeGeometry,
  IcosahedronGeometry: FakeGeometry,
  SphereGeometry: FakeGeometry,
  BufferGeometry: FakeBufferGeometry,
  Float32BufferAttribute: FakeBufferAttribute,
  MeshStandardMaterial: FakeMaterial,
  MeshBasicMaterial: FakeMaterial,
  LineBasicMaterial: FakeMaterial,
  PointsMaterial: FakeMaterial,
  ShaderMaterial: FakeShaderMaterial,
  CanvasTexture: FakeCanvasTexture,
  AmbientLight: FakeLight,
  PointLight: FakeLight,
  DirectionalLight: FakeLight,
  AdditiveBlending: 2,
  NormalBlending: 1,
  DoubleSide: 2,
  FrontSide: 0,
};

const sandbox = { console, THREE };
vm.createContext(sandbox);
for (const modulePath of modulePaths) {
  vm.runInContext(fs.readFileSync(modulePath, 'utf8'), sandbox, { filename: modulePath });
}

const primitives = sandbox.GenreWorldPrimitives;
assert.ok(primitives, 'shared primitives must be exported');
for (const api of [
  'group', 'material', 'geometry', 'light', 'particles',
  'accentColor', 'readFrame', 'smooth', 'quality', 'applyQualityBudget', 'random', 'pool',
  'shaderMaterial', 'bindCover', 'audioUniforms', 'frameCamera', 'visualizerRoot', 'tickVisualizer',
]) {
  assert.equal(typeof primitives[api], 'function', `missing shared primitive: ${api}`);
}
assert.equal(primitives.accentColor(THREE, { accent: '#12abef' }, null, 0).getHex(), 0x12abef);
assert.equal(primitives.accentColor(THREE, { accent: 'not-a-color' }, null, 0x123456).getHex(), 0x123456);
assert.deepEqual(
  JSON.parse(JSON.stringify(primitives.readFrame({ bass: 2, mid: -1, high: 0.5, beat: true }))),
  { bass: 1, energy: 0, beat: 1, low: 1, mid: 0, high: 0.5 },
);
assert.equal(primitives.random('same-seed')(), primitives.random('same-seed')(), 'seeded random must be deterministic');
assert.equal(primitives.quality('eco').level, 'low', 'project eco quality must normalize to low');
assert.equal(primitives.quality({ level: 'balanced' }).level, 'medium', 'project balanced quality must normalize to medium');
assert.equal(primitives.quality({ quality: 'ultra' }).level, 'high', 'project ultra quality must normalize to high');
assert.equal(primitives.quality('low').level, 'low', 'low alias must remain supported');
assert.equal(primitives.quality('medium').level, 'medium', 'medium alias must remain supported');
assert.equal(primitives.quality('high').level, 'high', 'high alias must remain supported');
assert.equal(typeof primitives.shaderChunks().vertUv, 'string');
const framed = { position: new FakeVector(9, 9, 9), fov: 90, lookAtCalls: [], projectionUpdates: 0, lookAt(x, y, z) { this.lookAtCalls.push([x, y, z]); }, updateProjectionMatrix() { this.projectionUpdates += 1; } };
assert.equal(primitives.frameCamera(framed, { x: 0, y: 1.2, z: 5.6, lookY: 0.4, fov: 36 }), true);
assert.equal(framed.position.z, 5.6);
assert.equal(framed.fov, 36);
assert.deepEqual(framed.lookAtCalls[0], [0, 0.4, 0]);
const coverUniforms = primitives.audioUniforms(THREE, 0xff00aa, null);
assert.equal(primitives.bindCover(coverUniforms), null, 'missing global coverTex must be a no-op');
assert.equal(coverUniforms.uHasCover.value, 0);
assert.deepEqual(
  JSON.parse(JSON.stringify(primitives.quality({
    level: 'medium',
    detail: 0.42,
    particleDensity: 0.31,
    volumetricLight: false,
    postProcessing: false,
    dprScale: 0.8,
    maxParticles: 17,
    maxLights: 2,
    maxTextures: 1,
  }))),
  {
    level: 'medium',
    detail: 0.42,
    particles: 0.31,
    particleDensity: 0.31,
    volumetricLight: false,
    postProcessing: false,
    dprScale: 0.8,
    maxParticles: 17,
    maxLights: 2,
    maxTextures: 1,
  },
  'quality normalization must retain the complete adaptive budget',
);

const worldIds = ['electronic', 'rock-metal', 'hiphop', 'prism', 'folk', 'classical', 'jazz-soul', 'ambient'];
const expectedVariants = {
  electronic: 'ultraviolet',
  'rock-metal': 'cold-steel',
  hiphop: 'gold',
  prism: 'anime',
  folk: 'acoustic',
  classical: 'symphonic',
  'jazz-soul': 'jazz',
  ambient: 'tidal',
};
const expectedLyricStyles = {
  electronic: 'hologram-signs',
  'rock-metal': 'fractured-stage',
  hiphop: 'architectural-type',
  prism: 'dream-ribbons',
  folk: 'constellation-script',
  classical: 'spatial-score',
  'jazz-soul': 'improvised-anchor',
  ambient: 'horizon-dissolve',
};

for (const id of worldIds) {
  const record = sandbox.getGenreWorld(id);
  assert.ok(record && record.kit, `${id} kit must self-register`);
  for (const api of ['create', 'applyTrack', 'update', 'setQuality', 'dispose', 'renderLyrics']) {
    assert.equal(typeof record.kit[api], 'function', `${id}.${api} must exist`);
  }

  const root = new THREE.Group();
  const camera = {
    position: new FakeVector(),
    lookAtCalls: [],
    projectionUpdates: 0,
    lookAt(x, y, z) { this.lookAtCalls.push([x, y, z]); },
    fov: 50,
    updateProjectionMatrix() { this.projectionUpdates += 1; },
  };
  const ctx = { THREE, root, camera, quality: { level: 'high' } };
  const instance = record.kit.create(ctx);
  assert.ok(instance instanceof THREE.Group, `${id} create must return a real Group`);
  assert.ok(instance.children.length >= 3, `${id} needs a layered spatial hierarchy`);
  assert.ok(instance.children.some((child) => child.children.length > 0), `${id} needs nested scene structure`);
  assert.ok(root.children.includes(instance), `${id} must attach to ctx.root`);
  assert.equal(camera.lookAtCalls.length, 1, `${id} camera must aim at its authored stage focus`);
  assert.ok(camera.lookAtCalls[0].every(Number.isFinite), `${id} camera focus must be finite`);
  assert.equal(camera.projectionUpdates, 1, `${id} camera projection must update after fov setup`);

  const state = instance.userData.genreWorldState;
  assert.ok(state && state.layers && state.layers.low && state.layers.mid && state.layers.high);
  assert.ok(state.uniforms, `${id} must expose shared audio/cover uniforms`);
  if (id === 'electronic') {
    const floor = state.layers.low.children.find((node) => node.name === 'neon-grid-floor');
    const beam = state.layers.high.children.find((node) => node.name === 'vertical-laser');
    assert.ok(floor && beam, 'electronic must expose its grid floor and scan beams');
    assert.equal(primitives.isOwnedResource(floor.material), true, 'electronic floor material must be world-owned');
    assert.ok(floor.material.uniforms, 'electronic floor must use a shader material');
  }
  if (id === 'prism') {
    const hero = state.layers.mid.children.find((node) => node.name === 'prism-kaleido-cover');
    assert.ok(hero && hero.material && hero.material.uniforms, 'prism must expose a kaleidoscope cover shader');
    assert.ok(hero.material.uniforms.uCover, 'prism hero must bind a cover sampler');
  }
  const stableCoreColors = id === 'folk' || id === 'classical' || id === 'jazz-soul' || id === 'ambient'
    ? state.coreMaterials.map((material) => material.color.getHex())
    : null;
  const accentLightColor = state.accentLight ? state.accentLight.color.getHex() : null;
  record.kit.applyTrack(
    { id: `${id}-track`, accent: '#12abef', visualVariant: expectedVariants[id], genre: id === 'prism' ? 'anime' : id },
    ctx,
    instance,
  );
  assert.equal(state.accent.getHex(), 0x12abef, `${id} must apply a safe accent`);
  assert.equal(state.variant, expectedVariants[id], `${id} must update its variant`);
  if (id === 'electronic') {
    assert.equal(state.layers.high.rotation.z, 0.12, 'ultraviolet track tilts the laser crown');
    record.kit.applyTrack({ id: 'electronic-plain', genre: 'electronic' }, ctx, instance);
    assert.equal(state.layers.high.rotation.z, 0,
      'same-world ordinary track must reset the ultraviolet tilt');
  }
  if (stableCoreColors) {
    assert.deepEqual(
      state.coreMaterials.map((material) => material.color.getHex()),
      stableCoreColors,
      `${id} core materials must keep their authored world colors`,
    );
    assert.notEqual(state.accentLight.color.getHex(), accentLightColor, `${id} accent light must receive album color`);
  }

  const before = {
    low: state.layers.low.scale.x,
    mid: state.layers.mid.rotation.y,
    high: state.layers.high.position.y,
  };
  record.kit.update({ bass: 1, mid: 0.55, high: 0.8, energy: 0.7, beat: 1, time: 2 }, ctx, instance);
  assert.notEqual(state.layers.low.scale.x, before.low, `${id} bass must drive the low layer`);
  assert.notEqual(state.layers.mid.rotation.y, before.mid, `${id} mid must drive a different property`);
  assert.notEqual(state.layers.high.position.y, before.high, `${id} high must drive another property`);
  assert.notEqual(state.layers.low.scale.x, state.layers.high.scale.x, `${id} must not uniformly scale all layers`);

  const highDetailCount = state.detailNodes.filter((node) => node.visible).length;
  record.kit.setQuality({
    level: 'low',
    detail: 0.4,
    particleDensity: 0.25,
    volumetricLight: false,
    postProcessing: false,
    maxParticles: 10,
    maxLights: 1,
    maxTextures: 2,
  }, ctx, instance);
  const lowDetailCount = state.detailNodes.filter((node) => node.visible).length;
  assert.ok(lowDetailCount < highDetailCount, `${id} low quality must reduce detail`);
  assert.equal(state.qualityBudget.detail, 0.4, `${id} must record the applied detail budget`);
  assert.equal(state.qualityBudget.maxTextures, 2, `${id} records texture budget without fake disposal`);
  const points = [];
  const lights = [];
  const volumetric = [];
  instance.traverse((node) => {
    if (node.isPoints) points.push(node);
    if (node.isLight) lights.push(node);
    if (/smoke|mist|fog|volumetric/i.test(node.name || '') && (node.geometry || node.material)) volumetric.push(node);
  });
  for (const point of points) {
    assert.equal(primitives.isOwnedResource(point), true, `${id} particle object must be owned`);
    const total = point.geometry.attributes.position.array.length / 3;
    assert.ok(point.geometry.drawRange, `${id} particle draw range must be set`);
    assert.ok(point.geometry.drawRange.count <= Math.min(10, Math.floor(total * 0.25)),
      `${id} particle budget must limit actual draw count`);
  }
  assert.ok(lights.filter((light) => light.visible).length <= 1, `${id} maxLights must hide excess real lights`);
  if (volumetric.length) {
    const visibleVolumetric = volumetric.filter((node) => node.visible);
    assert.ok(visibleVolumetric.length >= 1,
      `${id} low quality must retain a cheap smoke/mist/fog identity node`);
    assert.ok(visibleVolumetric.length < volumetric.length,
      `${id} low quality must keep the high-cost volumetric population budgeted`);
  }

  assert.doesNotThrow(() => record.kit.dispose(instance, ctx));
  assert.doesNotThrow(() => record.kit.dispose(instance, ctx), `${id} dispose must be idempotent`);
  assert.doesNotThrow(() => record.kit.update({ bass: 1, mid: 1, high: 1, beat: 1 }, ctx, instance));
  assert.doesNotThrow(() => record.kit.renderLyrics({ text: 'after dispose' }, ctx, instance));
}

for (const id of ['folk', 'classical', 'jazz-soul', 'ambient']) {
  const record = sandbox.getGenreWorld(id);
  const root = new THREE.Group();
  const ctx = { THREE, root, camera: { position: new FakeVector(), lookAt() {} }, quality: 'high' };
  const instance = record.kit.create(ctx);
  const state = instance.userData.genreWorldState;
  const before = {
    low: state.layers.low.scale.x,
    mid: state.layers.mid.rotation.y,
    high: state.layers.high.position.y,
  };
  record.kit.update({ bass: 0.9, mid: 0.2, high: 0.1, energy: 0.65, beat: 1, time: 30 }, ctx, instance);
  const first = {
    low: state.layers.low.scale.x,
    mid: state.layers.mid.rotation.y,
    high: state.layers.high.position.y,
  };
  record.kit.update({ bass: 0.1, mid: 0.9, high: 0.8, energy: 0.65, beat: 0, time: 31 }, ctx, instance);
  assert.notDeepEqual(first, before, `${id} must react to its first frequency frame`);
  assert.notEqual(state.layers.mid.rotation.y, first.mid, `${id} must distinguish mid response`);
  assert.notEqual(state.layers.high.position.y, first.high, `${id} must distinguish high response`);
  if (id === 'folk' || id === 'ambient') {
    assert.ok(Math.abs(state.layers.low.scale.x - first.low) < 0.25, `${id} must smooth long-form energy`);
  }
  if (id === 'classical' || id === 'ambient') {
    const calmY = state.layers.low.scale.y;
    record.kit.update({ bass: 0.1, mid: 0.1, high: 0.1, energy: 0.1, beat: 1, time: 32 }, ctx, instance);
    assert.ok(Math.abs(state.layers.low.scale.y - calmY) < 0.08, `${id} must avoid beat-driven jumping`);
  }
  if (id === 'jazz-soul') {
    record.kit.applyTrack({ genre: 'soul' }, ctx, instance);
    assert.equal(state.variant, 'soul', 'jazz-soul must expose a soul variant');
    record.kit.applyTrack({ genre: 'jazz' }, ctx, instance);
    assert.equal(state.variant, 'jazz', 'jazz-soul must expose a jazz variant');
  }
  record.kit.dispose(instance, ctx);
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.mutations = 0;
    this.style = new Proxy({}, {
      set: (target, key, value) => {
        this.mutations += 1;
        target[key] = value;
        return true;
      },
    });
    this.dataset = new Proxy({}, {
      set: (target, key, value) => {
        this.mutations += 1;
        target[key] = value;
        return true;
      },
    });
    this.attributes = {};
    for (const property of ['className', 'id', 'textContent']) {
      let value = '';
      Object.defineProperty(this, property, {
        get() { return value; },
        set(next) { this.mutations += 1; value = next; },
      });
      this[property] = '';
    }
  }
  appendChild(child) { this.mutations += 1; this.children.push(child); child.parentNode = this; return child; }
  removeChild(child) {
    this.mutations += 1;
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name, value) { this.mutations += 1; this.attributes[name] = String(value); }
  removeAttribute(name) { this.mutations += 1; delete this.attributes[name]; }
}

function resetMutations(element) {
  element.mutations = 0;
  element.children.forEach(resetMutations);
}

function countMutations(element) {
  return element.mutations + element.children.reduce((total, child) => total + countMutations(child), 0);
}

const lyricHost = new FakeElement('main');
const fakeDocument = {
  body: lyricHost,
  createElement(tagName) { return new FakeElement(tagName); },
  getElementById(id) {
    return lyricHost.children.find((child) => child.id === id) || null;
  },
};
const lyricCtx = { document: fakeDocument, reducedMotion: false };
for (const api of [
  'normalizeGenreWorldLyricFrame',
  'ensureGenreWorldLyricSurface',
  'renderGenreWorldLyrics',
  'clearGenreWorldLyrics',
]) {
  assert.equal(typeof sandbox[api], 'function', `missing shared lyric API: ${api}`);
}
const normalizedEmpty = sandbox.normalizeGenreWorldLyricFrame(null, lyricCtx);
assert.equal(normalizedEmpty.text, '');
assert.equal(normalizedEmpty.translation, '');
const surface = sandbox.ensureGenreWorldLyricSurface(lyricCtx);
assert.equal(surface.id, 'genre-world-lyrics');
assert.equal(surface.children.length, 2, 'lyric surface must contain main and translated lines');
assert.equal(surface.attributes.role, 'status');
assert.equal(surface.attributes['aria-live'], 'polite');
assert.equal(surface.attributes['aria-atomic'], 'true');
assert.equal(surface.children[0].attributes['aria-live'], undefined, 'live region belongs on the containing surface');
const injectedSurface = new FakeElement('section');
assert.equal(
  sandbox.ensureGenreWorldLyricSurface({ document: fakeDocument, lyricElement: injectedSurface }),
  injectedSurface,
  'ctx.lyricElement must take priority over document lookup',
);
sandbox.renderGenreWorldLyrics('hologram-signs', { text: '<img src=x onerror=alert(1)>', translation: '<b>译文</b>', seekId: 1 }, lyricCtx);
assert.equal(surface.children[0].textContent, '<img src=x onerror=alert(1)>', 'main lyric must use textContent');
assert.equal(surface.children[1].textContent, '<b>译文</b>', 'translation must use textContent');
assert.equal(surface.dataset.style, 'hologram-signs');
assert.equal(surface.dataset.preset, 'hologram-signs');
assert.ok(surface.className.includes('genre-world-lyrics--hologram-signs'));
assert.equal(surface.dataset.seek, '1');
resetMutations(surface);
sandbox.renderGenreWorldLyrics('hologram-signs', { text: '<img src=x onerror=alert(1)>', translation: '<b>译文</b>', seekId: 1 }, lyricCtx);
assert.equal(countMutations(surface), 0, 'identical lyric signature must not mutate DOM');
sandbox.renderGenreWorldLyrics('dream-ribbons', { text: '立即替换', translation: '', seekId: 2 }, lyricCtx);
assert.equal(surface.children[0].textContent, '立即替换', 'fast seek must replace text immediately');
assert.equal(surface.children[1].textContent, '');
assert.equal(surface.dataset.seek, '2');
assert.ok(countMutations(surface) > 0, 'seek or text changes must update immediately');
const presetSignatures = new Set();
for (const style of Object.values(expectedLyricStyles)) {
  sandbox.renderGenreWorldLyrics(style, { text: style, seekId: style }, lyricCtx);
  presetSignatures.add([
    surface.className,
    surface.style.textAlign,
    surface.style.maxWidth,
    surface.style.left,
    surface.style.bottom,
    surface.style.letterSpacing,
    surface.style.transform,
    surface.children[0].style.fontFamily,
  ].join('|'));
}
assert.equal(presetSignatures.size, 8, 'all eight lyric presets need observably distinct structure');
sandbox.lyricFontStackForKey = function (key) {
  return key === 'mashan' ? '"Ma Shan Zheng",cursive' : 'Inter,sans-serif';
};
sandbox.lyricFontWeightValue = function () { return sandbox.fx && sandbox.fx.lyricWeight || 700; };
sandbox.fx = { lyricFont: 'sans', lyricWeight: 700 };
sandbox.renderGenreWorldLyrics('dream-ribbons', { text: 'font-follow', seekId: 'font-a' }, lyricCtx);
assert.equal(surface.children[0].style.fontFamily, 'Inter,sans-serif', 'genre lyrics must follow DIY lyricFont');
assert.equal(surface.children[0].style.fontWeight, '700');
resetMutations(surface);
sandbox.renderGenreWorldLyrics('dream-ribbons', { text: 'font-follow', seekId: 'font-a' }, lyricCtx);
assert.equal(countMutations(surface), 0, 'unchanged DIY font must not mutate lyric DOM');
sandbox.fx = { lyricFont: 'mashan', lyricWeight: 400 };
sandbox.renderGenreWorldLyrics('dream-ribbons', { text: 'font-follow', seekId: 'font-a' }, lyricCtx);
assert.equal(surface.children[0].style.fontFamily, '"Ma Shan Zheng",cursive', 'DIY font changes must update genre lyrics live');
assert.equal(surface.children[0].style.fontWeight, '400');
delete sandbox.lyricFontStackForKey;
delete sandbox.lyricFontWeightValue;
delete sandbox.fx;
const translationOnly = { text: '', translation: 'Translation only', seekId: 'translation-only' };
sandbox.renderGenreWorldLyrics('spatial-score', translationOnly, lyricCtx);
assert.equal(surface.style.opacity, '1', 'translation-only lyrics must remain visible');
assert.equal(surface.children[1].style.display, '');
assert.equal(surface.children[1].attributes['aria-hidden'], 'false');
lyricCtx.reducedMotion = true;
sandbox.renderGenreWorldLyrics('horizon-dissolve', { text: '静止', translation: 'Still' }, lyricCtx);
assert.equal(surface.dataset.motion, 'reduced', 'reduced motion must disable lyric transitions');
lyricCtx.reducedMotion = false;
sandbox.window = { matchMedia: () => ({ matches: true }) };
assert.equal(
  sandbox.normalizeGenreWorldLyricFrame({ text: 'global preference' }, { document: fakeDocument }).reducedMotion,
  true,
  'normalization must fall back to global window.matchMedia',
);
delete sandbox.window;
for (const id of worldIds) {
  const record = sandbox.getGenreWorld(id);
  record.kit.renderLyrics({ text: id }, lyricCtx, null);
  assert.equal(surface.dataset.style, expectedLyricStyles[id], `${id} must select its dedicated lyric style`);
  assert.equal(surface.children[0].textContent, id);
}
sandbox.clearGenreWorldLyrics(lyricCtx);
assert.equal(surface.children[0].textContent, '');
assert.equal(surface.children[1].textContent, '');
resetMutations(surface);
sandbox.clearGenreWorldLyrics(lyricCtx);
assert.equal(countMutations(surface), 0, 'repeated clear must be mutation-free');

const scene = new THREE.Group();
scene.name = 'integration-scene';
const initialLayerMask = 0b10101;
const camera = {
  layers: new FakeLayers(initialLayerMask),
  position: new FakeVector(2, 4, 12),
  rotation: new FakeVector(0.1, 0.2, 0.3),
  up: new FakeVector(0, 1, 0),
  scale: new FakeVector(1, 1, 1),
  fov: 55,
  near: 0.1,
  far: 1800,
  updateProjectionMatrix() {},
};
const initialCameraPosition = camera.position.clone();
const firstContext = {
  THREE,
  scene,
  camera,
  track: { id: 'engine-electronic-a', genre: 'electronic', accent: '#00ccff' },
  contextMarker: 'first-context',
};

assert.equal(sandbox.startGenreWorldEngine(firstContext), true, 'real engine must start with Fake THREE scene');
const engineRoot = scene.children.find((child) => child.name === 'genreWorldRoot');
assert.ok(engineRoot, 'engine root must mount into scene');
assert.equal(camera.layers.mask, 2 ** sandbox.GENRE_WORLD_LAYER, 'engine must isolate camera layer');
const expectedWorldLayerMask = 2 ** sandbox.GENRE_WORLD_LAYER;
function assertWorldLayerTree(root, label) {
  root.traverse((node) => {
    assert.ok(node.layers, `${label} node ${node.name || '<unnamed>'} must expose layers`);
    assert.equal(
      node.layers.mask,
      expectedWorldLayerMask,
      `${label} node ${node.name || '<unnamed>'} must use GENRE_WORLD_LAYER`,
    );
  });
}

assert.equal(sandbox.switchGenreWorld('electronic', firstContext), true, 'engine must create real electronic kit');
assert.equal(engineRoot.children.length, 1, 'one world container must be mounted');
const electronicContainer = engineRoot.children[0];
const electronicInstance = electronicContainer.children[0];
const electronicState = electronicInstance.userData.genreWorldState;
assert.ok(electronicState, 'real kit state must exist through engine');
assertWorldLayerTree(engineRoot, 'engine root');
assertWorldLayerTree(electronicContainer, 'electronic container');
assertWorldLayerTree(electronicInstance, 'electronic kit');
const midRotationBeforeTick = electronicState.layers.mid.rotation.y;
assert.equal(sandbox.tickGenreWorld({ bass: 0.9, mid: 0.7, high: 0.8, energy: 0.75, beat: 1 }), true);
assert.notEqual(electronicState.layers.mid.rotation.y, midRotationBeforeTick, 'engine tick must reach real kit update');

const secondContext = {
  THREE,
  scene,
  camera,
  track: { id: 'engine-electronic-b', genre: 'electronic', accent: '#ff3366' },
  contextMarker: 'updated-context',
};
assert.equal(sandbox.switchGenreWorld('electronic', secondContext), true, 'same world must reuse and apply track');
assert.equal(engineRoot.children[0], electronicContainer, 'same world must preserve mounted instance');
assert.equal(electronicState.accent.getHex(), 0xff3366, 'same-world switch must apply the new track accent');
assert.equal(
  sandbox.genreWorldEngineState.current.context.contextMarker,
  'updated-context',
  'same-world switch must update engine context',
);

for (const id of ['folk', 'classical', 'jazz-soul', 'ambient']) {
  assert.equal(sandbox.switchGenreWorld(id, {
    THREE,
    scene,
    camera,
    track: { id: `engine-${id}`, genre: id === 'jazz-soul' ? 'soul' : id },
    contextMarker: `${id}-context`,
  }), true, `engine must switch through the real ${id} kit`);
  assert.equal(engineRoot.children.length, 1);
  assert.equal(engineRoot.children[0].name, `genreWorld:${id}`);
  const realInstance = engineRoot.children[0].children[0];
  assert.ok(realInstance.userData.genreWorldState, `${id} state must exist through engine`);
  assertWorldLayerTree(realInstance, `${id} engine kit`);
  assert.equal(sandbox.tickGenreWorld({
    bass: 0.45, mid: 0.65, high: 0.35, energy: 0.55, beat: 1, time: 8, text: id,
  }), true, `${id} engine tick must update and render lyrics without throwing`);
}

assert.equal(sandbox.switchGenreWorld('rock-metal', {
  THREE,
  scene,
  camera,
  track: { id: 'engine-metal', genre: 'metal', accent: '#9aa4b2' },
  contextMarker: 'rock-context',
}), true, 'engine must switch to a second real kit');
assert.equal(engineRoot.children.length, 1, 'switch must leave exactly one mounted world');
assert.equal(engineRoot.children[0].name, 'genreWorld:rock-metal');
const rockContainer = engineRoot.children[0];
const rockInstance = rockContainer.children[0];
const rockState = rockInstance.userData.genreWorldState;
assert.ok(rockState, 'rock-metal state must exist before stop');
assertWorldLayerTree(engineRoot, 'switched engine root');
assertWorldLayerTree(rockContainer, 'rock-metal container');
assertWorldLayerTree(rockInstance, 'rock-metal kit');
assert.equal(electronicInstance.parent, null, 'previous real kit root must be detached');
assert.equal(electronicState.disposed, true, 'previous real kit must be disposed');

let rockGeometry = null;
let rockMaterial = null;
rockInstance.traverse((node) => {
  if (!rockGeometry && node.geometry) rockGeometry = node.geometry;
  if (!rockMaterial && node.material) {
    rockMaterial = Array.isArray(node.material) ? node.material[0] : node.material;
  }
});
assert.ok(rockGeometry, 'rock-metal kit must expose a geometry resource for disposal verification');
assert.ok(rockMaterial, 'rock-metal kit must expose a material resource for disposal verification');
assert.doesNotThrow(() => sandbox.stopGenreWorldEngine(), 'real kit engine stop must cleanly dispose');
assert.equal(scene.children.includes(engineRoot), false, 'stop must detach engine root');
assert.equal(rockState.disposed, true, 'stop must dispose the current rock-metal kit state');
assert.equal(rockGeometry.disposed, true, 'stop must dispose current rock-metal geometry');
assert.equal(rockMaterial.disposed, true, 'stop must dispose current rock-metal material');
assert.equal(camera.layers.mask, initialLayerMask, 'stop must restore original camera layer mask');
assert.deepEqual(camera.position, initialCameraPosition, 'stop must restore camera position changed by kits');

console.log('OK eight genre world kits and shared lyrics expose complete lifecycles');
