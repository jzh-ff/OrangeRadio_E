'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const visualDir = path.join(__dirname, '..', 'public', 'js', 'modules', '02-visual');
const registryPath = path.join(visualDir, '17-genre-world-registry.js');
const enginePath = path.join(visualDir, '18-genre-world-engine.js');

const sandbox = { console };
vm.createContext(sandbox);
for (const modulePath of [registryPath, enginePath]) {
  if (fs.existsSync(modulePath)) {
    vm.runInContext(fs.readFileSync(modulePath, 'utf8'), sandbox, { filename: modulePath });
  }
}

for (const api of [
  'registerGenreWorld',
  'getGenreWorld',
  'genreWorldForFamily',
  'listGenreWorlds',
  'startGenreWorldEngine',
  'switchGenreWorld',
  'tickGenreWorld',
  'setGenreWorldQuality',
  'stopGenreWorldEngine',
]) {
  assert.equal(typeof sandbox[api], 'function', `missing genre world API: ${api}`);
}

const expectedWorldIds = [
  'electronic',
  'rock-metal',
  'hiphop',
  'prism',
  'folk',
  'classical',
  'jazz-soul',
  'ambient',
];
assert.deepEqual(
  Array.from(sandbox.listGenreWorlds(), (world) => world.id),
  expectedWorldIds,
  'registry must expose the eight world metadata records in stable order',
);

const expectedFamilyWorlds = {
  electronic: 'electronic',
  rock: 'rock-metal',
  metal: 'rock-metal',
  hiphop: 'hiphop',
  pop: 'prism',
  anime: 'prism',
  default: 'prism',
  folk: 'folk',
  classical: 'classical',
  jazz: 'jazz-soul',
  soul: 'jazz-soul',
  ambient: 'ambient',
};
for (const [family, worldId] of Object.entries(expectedFamilyWorlds)) {
  assert.equal(sandbox.genreWorldForFamily(family).id, worldId, `${family} family mapping`);
}
assert.equal(sandbox.genreWorldForFamily('unknown-family').id, 'prism');

assert.equal(sandbox.registerGenreWorld('', { create() {} }), false, 'empty id must fail');
assert.equal(sandbox.registerGenreWorld('bad-null', null), false, 'null kit must fail');
assert.equal(sandbox.registerGenreWorld('bad-create', { update() {} }), false, 'create is required');

class FakeLayers {
  constructor(mask = 1) {
    this.mask = mask;
  }

  set(layer) {
    this.mask = 2 ** layer;
  }
}

class FakeVector {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  clone() {
    return new FakeVector(this.x, this.y, this.z);
  }

  copy(other) {
    this.x = other.x;
    this.y = other.y;
    this.z = other.z;
    return this;
  }
}

class FakeGroup {
  constructor() {
    this.children = [];
    this.parent = null;
    this.layers = new FakeLayers();
    this.name = '';
  }

  add(child) {
    if (child.parent) child.parent.remove(child);
    this.children.push(child);
    child.parent = this;
  }

  remove(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    if (child.parent === this) child.parent = null;
  }

  traverse(visitor) {
    visitor(this);
    this.children.slice().forEach((child) => {
      if (typeof child.traverse === 'function') child.traverse(visitor);
      else visitor(child);
    });
  }
}

const THREE = { Group: FakeGroup };
const scene = new FakeGroup();
scene.name = 'scene';
const camera = {
  layers: new FakeLayers(0b10101),
  position: new FakeVector(1, 2, 3),
  up: new FakeVector(0, 1, 0),
  zoom: 1.25,
  fov: 60,
  aspect: 16 / 9,
  near: 0.1,
  far: 2000,
  projectionUpdates: 0,
  updateProjectionMatrix() {
    this.projectionUpdates += 1;
  },
};
const initialCamera = {
  mask: camera.layers.mask,
  position: camera.position.clone(),
  zoom: camera.zoom,
  fov: camera.fov,
  aspect: camera.aspect,
  near: camera.near,
  far: camera.far,
};

const calls = [];
let electronicGeometryDisposals = 0;
let electronicMaterialDisposals = 0;
let sharedTextureDisposals = 0;
let emissiveTextureDisposals = 0;
let uniformTextureDisposals = 0;
let fakeTextureDisposals = 0;
const sharedTexture = {
  isTexture: true,
  __genreWorldOwned: true,
  dispose() { sharedTextureDisposals += 1; },
};
const throwingTexture = {
  isTexture: true,
  __genreWorldOwned: true,
  dispose() { throw new Error('texture dispose failed'); },
};
const emissiveTexture = {
  isTexture: true,
  __genreWorldOwned: true,
  dispose() { emissiveTextureDisposals += 1; },
};
const uniformTexture = {
  isTexture: true,
  __genreWorldOwned: true,
  dispose() { uniformTextureDisposals += 1; },
};
const fakeTexture = {
  isTexture: false,
  dispose() { fakeTextureDisposals += 1; },
};
const electronicKit = {
  create(ctx) {
    calls.push(['electronic.create', ctx.world.id]);
    const group = new FakeGroup();
    group.geometry = {
      __genreWorldOwned: true,
      dispose() { electronicGeometryDisposals += 1; },
    };
    group.material = {
      __genreWorldOwned: true,
      map: sharedTexture,
      normalMap: sharedTexture,
      roughnessMap: throwingTexture,
      emissiveMap: emissiveTexture,
      alphaMap: { isTexture: true },
      envMap: fakeTexture,
      uniforms: {
        diffuseTexture: { value: uniformTexture },
        textureArray: { value: [sharedTexture, uniformTexture, null] },
        malformed: null,
      },
      dispose() { electronicMaterialDisposals += 1; },
    };
    camera.position.x = 40;
    return group;
  },
  applyTrack(track, applyContext, instance) {
    calls.push(['electronic.applyTrack', track.id, applyContext.contextMarker, instance]);
  },
  update(frame, updateContext) {
    calls.push(['electronic.update', frame.time, updateContext.contextMarker]);
  },
  renderLyrics(frame) {
    calls.push(['electronic.renderLyrics', frame.lyrics]);
  },
  setQuality(profile) {
    calls.push(['electronic.setQuality', profile.level]);
  },
  dispose(instance) {
    calls.push(['electronic.dispose']);
    sandbox.disposeGenreWorldObject(instance);
  },
};
const prismKit = {
  create() {
    calls.push(['prism.create']);
    camera.zoom = 2;
    return new FakeGroup();
  },
  dispose() {
    calls.push(['prism.dispose']);
  },
};
const failingKit = {
  create() {
    camera.position.x = 999;
    throw new Error('candidate create failed');
  },
  dispose() {
    calls.push(['ambient.failed.dispose']);
  },
};

assert.equal(sandbox.registerGenreWorld('electronic', electronicKit), true);
assert.equal(sandbox.registerGenreWorld('electronic', electronicKit), false, 'duplicate id must fail');
assert.equal(sandbox.getGenreWorld('electronic').kit, electronicKit);
assert.equal(sandbox.registerGenreWorld('ambient', failingKit), true);

const ctx = { scene, camera, THREE, track: { id: 'track-1' } };
assert.equal(sandbox.startGenreWorldEngine(ctx), true);
assert.equal(sandbox.startGenreWorldEngine(ctx), true, 'repeated start must be idempotent');
assert.equal(scene.children.filter((child) => child.name === 'genreWorldRoot').length, 1);
assert.equal(camera.layers.mask, 2 ** sandbox.GENRE_WORLD_LAYER);

assert.equal(sandbox.switchGenreWorld('electronic', ctx), true);
const root = scene.children.find((child) => child.name === 'genreWorldRoot');
assert.ok(root);
assert.equal(root.children.length, 1);
root.traverse((object) => {
  assert.equal(object.layers.mask, 2 ** sandbox.GENRE_WORLD_LAYER, 'all world nodes use isolated layer');
});
assert.deepEqual(calls.slice(0, 2), [
  ['electronic.create', 'electronic'],
  ['electronic.applyTrack', 'track-1', undefined, root.children[0].children[0]],
]);

const secondTrackContext = {
  scene,
  camera,
  THREE,
  track: { id: 'track-2' },
  contextMarker: 'second-track',
};
const electronicCreateCount = calls.filter((call) => call[0] === 'electronic.create').length;
assert.equal(sandbox.switchGenreWorld('electronic', secondTrackContext), true);
assert.equal(
  calls.filter((call) => call[0] === 'electronic.create').length,
  electronicCreateCount,
  'same-world track update must reuse the current instance',
);
assert.deepEqual(calls.at(-1), [
  'electronic.applyTrack',
  'track-2',
  'second-track',
  root.children[0].children[0],
]);

sandbox.tickGenreWorld({ time: 12, lyrics: 'line' });
sandbox.setGenreWorldQuality({ level: 'low' });
assert.ok(calls.some(
  (call) => call[0] === 'electronic.update' && call[1] === 12 && call[2] === 'second-track',
));
assert.ok(calls.some((call) => call[0] === 'electronic.renderLyrics' && call[1] === 'line'));
assert.ok(calls.some((call) => call[0] === 'electronic.setQuality' && call[1] === 'low'));

const electronicChild = root.children[0];
assert.equal(sandbox.switchGenreWorld('missing-world', ctx), false, 'unknown world without prism fails');
assert.equal(root.children[0], electronicChild, 'unknown world must preserve the current world');
assert.equal(calls.some((call) => call[0] === 'electronic.dispose'), false);

assert.equal(sandbox.registerGenreWorld('prism', prismKit), true);
assert.equal(sandbox.switchGenreWorld('missing-world', ctx), true, 'registered prism is fallback');
assert.equal(root.children.length, 1);
assert.ok(calls.some((call) => call[0] === 'electronic.dispose'));
assert.equal(electronicGeometryDisposals, 1);
assert.equal(electronicMaterialDisposals, 1);
assert.equal(sharedTextureDisposals, 1, 'shared texture is disposed exactly once');
assert.equal(emissiveTextureDisposals, 1, 'common material texture properties are disposed');
assert.equal(uniformTextureDisposals, 1, 'shader uniform textures are disposed exactly once');
assert.equal(fakeTextureDisposals, 0, 'texture-like fake objects are ignored');

const prismChild = root.children[0];
const prismDisposeCount = calls.filter((call) => call[0] === 'prism.dispose').length;
const cameraXBeforeFailure = camera.position.x;
assert.equal(sandbox.switchGenreWorld('ambient', ctx), false, 'failed candidate must roll back');
assert.equal(root.children[0], prismChild, 'old world must remain attached after failure');
assert.equal(
  calls.filter((call) => call[0] === 'prism.dispose').length,
  prismDisposeCount,
  'old kit must not be disposed on failed switch',
);
assert.equal(camera.position.x, cameraXBeforeFailure, 'failed switch must restore candidate camera mutations');

camera.aspect = 4 / 3;
const projectionUpdatesBeforeStop = camera.projectionUpdates;
assert.equal(sandbox.stopGenreWorldEngine(), true);
assert.equal(scene.children.includes(root), false, 'stop removes root from scene');
assert.ok(calls.some((call) => call[0] === 'prism.dispose'));
assert.equal(camera.layers.mask, initialCamera.mask);
assert.deepEqual(camera.position, initialCamera.position);
assert.equal(camera.zoom, initialCamera.zoom);
assert.equal(camera.fov, initialCamera.fov);
assert.equal(camera.aspect, 4 / 3, 'stop preserves the latest viewport aspect from genre mode');
assert.equal(camera.near, initialCamera.near);
assert.equal(camera.far, initialCamera.far);
assert.equal(camera.projectionUpdates, projectionUpdatesBeforeStop + 1);

const qualityCallsBeforeRestart = calls.filter((call) => call[0] === 'electronic.setQuality').length;
const restartContext = { scene, camera, THREE, track: { id: 'track-after-restart' } };
assert.equal(sandbox.startGenreWorldEngine(restartContext), true);
assert.equal(sandbox.switchGenreWorld('electronic', restartContext), true);
assert.equal(
  calls.filter((call) => call[0] === 'electronic.setQuality').length,
  qualityCallsBeforeRestart,
  'stop must clear quality before a later session',
);
assert.equal(sandbox.stopGenreWorldEngine(), true);
assert.equal(sandbox.stopGenreWorldEngine(), true, 'repeated stop must be harmless');

console.log('OK genre world registry and transactional engine lifecycle');
