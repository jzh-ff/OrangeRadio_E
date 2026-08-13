'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const threePath = path.join(root, 'public', 'vendor', 'three.r128.min.js');
const visualDir = path.join(root, 'public', 'js', 'modules', '02-visual');
const registryPath = path.join(visualDir, '17-genre-world-registry.js');
const enginePath = path.join(visualDir, '18-genre-world-engine.js');
const primitivesPath = path.join(visualDir, 'genre-worlds', '00-shared-primitives.js');

const THREE = require(threePath);
assert.equal(THREE.REVISION, '128', 'ownership integration must use production Three r128');

function runFile(file, sandbox) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

function makeSandbox(worldFiles = []) {
  const sandbox = { console, THREE };
  vm.createContext(sandbox);
  for (const file of [registryPath, enginePath, primitivesPath, ...worldFiles]) runFile(file, sandbox);
  return sandbox;
}

function makeRuntime() {
  return {
    THREE,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000),
    track: { id: 'ownership-track', genre: 'electronic' },
  };
}

function collectDisposableResources(rootObject) {
  const resources = [];
  rootObject.traverse((node) => {
    if (node.geometry && !resources.includes(node.geometry)) resources.push(node.geometry);
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (material && !resources.includes(material)) resources.push(material);
    }
  });
  return resources;
}

function countDisposeEvents(resource) {
  let count = 0;
  resource.addEventListener('dispose', () => { count += 1; });
  return () => count;
}

// Nested and repeated scope endings cannot leak registration into later work.
{
  const sandbox = makeSandbox();
  const P = sandbox.GenreWorldPrimitives;
  const container = new THREE.Group();
  const outerScope = P.beginOwnedResourceScope(container);
  const outerMaterial = P.material(THREE, 'MeshBasicMaterial', {});
  const nestedScope = P.beginOwnedResourceScope(container);
  const nestedGeometry = P.geometry(THREE, 'BoxGeometry', [1, 1, 1]);
  const outerCount = countDisposeEvents(outerMaterial);
  const nestedCount = countDisposeEvents(nestedGeometry);
  assert.equal(P.endOwnedResourceScope(outerScope), true);
  assert.equal(P.endOwnedResourceScope(nestedScope), false, 'outer end closes abandoned descendants');
  assert.equal(P.endOwnedResourceScope(outerScope), false, 'repeated end is harmless');
  const afterScopeMaterial = P.material(THREE, 'MeshBasicMaterial', {});
  const borrowedMaterial = new THREE.MeshBasicMaterial();
  const afterScopeCount = countDisposeEvents(afterScopeMaterial);
  const borrowedCount = countDisposeEvents(borrowedMaterial);
  sandbox.disposeGenreWorldObject(container);
  assert.equal(outerCount(), 1);
  assert.equal(nestedCount(), 1);
  assert.equal(afterScopeCount(), 0, 'closed nested scopes cannot capture later owned resources');
  assert.equal(borrowedCount(), 0);
}

// Every production kit gets an isolated registry/engine VM to avoid registration
// and engine-state leakage while still sharing the already-loaded Three module.
const productionKits = [
  ['electronic', '01-electronic.js'],
  ['rock-metal', '02-rock-metal.js'],
  ['hiphop', '03-hiphop.js'],
  ['prism', '04-prism.js'],
  ['folk', '05-folk.js'],
  ['classical', '06-classical.js'],
  ['jazz-soul', '07-jazz-soul.js'],
  ['ambient', '08-ambient.js'],
];
for (const [worldId, filename] of productionKits) {
  const sandbox = makeSandbox([path.join(visualDir, 'genre-worlds', filename)]);
  assert.equal(typeof sandbox.GenreWorldPrimitives.ownResource, 'function');
  assert.equal(typeof sandbox.GenreWorldPrimitives.isOwnedResource, 'function');
  const ctx = makeRuntime();
  ctx.track = { id: `ownership-${worldId}`, genre: worldId };
  assert.equal(sandbox.startGenreWorldEngine(ctx), true);
  assert.equal(sandbox.switchGenreWorld(worldId, ctx), true, `${worldId} must mount through engine switch`);
  const instance = sandbox.genreWorldEngineState.current.instance;
  const resources = collectDisposableResources(instance);
  const geometry = resources.find((resource) => resource.isBufferGeometry);
  const material = resources.find((resource) => resource.isMaterial);
  assert.ok(geometry, `${worldId} must expose a representative geometry`);
  assert.ok(material, `${worldId} must expose a representative material`);
  assert.equal(sandbox.GenreWorldPrimitives.isOwnedResource(geometry), true);
  assert.equal(sandbox.GenreWorldPrimitives.isOwnedResource(material), true);
  const geometryCount = countDisposeEvents(geometry);
  const materialCount = countDisposeEvents(material);
  assert.equal(sandbox.stopGenreWorldEngine(), true);
  assert.equal(geometryCount(), 1, `${worldId} geometry must dispose exactly once`);
  assert.equal(materialCount(), 1, `${worldId} material must dispose exactly once`);
  assert.equal(sandbox.stopGenreWorldEngine(), true);
  assert.equal(geometryCount(), 1, `${worldId} idempotent stop must not redispose geometry`);
  assert.equal(materialCount(), 1, `${worldId} idempotent stop must not redispose material`);
}

// Borrowed/shared resources survive fallback cleanup when a kit has no dispose.
{
  const sandbox = makeSandbox();
  const P = sandbox.GenreWorldPrimitives;
  const ctx = makeRuntime();
  const borrowedGeometry = new THREE.BoxGeometry(1, 1, 1);
  const borrowedMaterial = new THREE.MeshBasicMaterial();
  const borrowedTexture = new THREE.Texture();
  const ownedGeometry = P.geometry(THREE, 'BoxGeometry', [0.5, 0.5, 0.5]);
  const ownedMaterial = P.material(THREE, 'MeshBasicMaterial', {});
  borrowedMaterial.map = borrowedTexture;
  const geometryCount = countDisposeEvents(borrowedGeometry);
  const materialCount = countDisposeEvents(borrowedMaterial);
  const textureCount = countDisposeEvents(borrowedTexture);
  const ownedGeometryCount = countDisposeEvents(ownedGeometry);
  const ownedMaterialCount = countDisposeEvents(ownedMaterial);
  sandbox.registerGenreWorld('electronic', {
    create(callCtx) {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(borrowedGeometry, borrowedMaterial));
      group.add(new THREE.Mesh(ownedGeometry, ownedMaterial));
      callCtx.root.add(group);
      return group;
    },
  });
  sandbox.registerGenreWorld('prism', { create() { return new THREE.Group(); }, dispose() {} });
  assert.equal(sandbox.startGenreWorldEngine(ctx), true);
  assert.equal(sandbox.switchGenreWorld('electronic', ctx), true);
  assert.equal(sandbox.switchGenreWorld('prism', ctx), true);
  assert.equal(geometryCount(), 0);
  assert.equal(materialCount(), 0);
  assert.equal(textureCount(), 0, 'borrowed texture must never be disposed by engine fallback');
  assert.equal(ownedGeometryCount(), 1);
  assert.equal(ownedMaterialCount(), 1, 'missing kit.dispose must fall back to owned resources');
  sandbox.stopGenreWorldEngine();
}

// A throwing dispose triggers owned-only fallback, including owned texture graphs.
{
  const sandbox = makeSandbox();
  const P = sandbox.GenreWorldPrimitives;
  const ctx = makeRuntime();
  let ownedGeometry;
  let ownedMaterial;
  let ownedTexture;
  let geometryCount;
  let materialCount;
  let textureCount;
  let candidateGeometryCount;
  let candidateMaterialCount;
  let nullCandidateDisposeCalls = 0;
  let unmountedMaterialCount;
  let borrowedUnmountedMaterialCount;
  sandbox.registerGenreWorld('electronic', {
    create(callCtx) {
      ownedGeometry = P.geometry(THREE, 'BoxGeometry', [1, 1, 1]);
      ownedMaterial = P.material(THREE, 'MeshBasicMaterial', {});
      ownedTexture = P.ownResource(new THREE.Texture());
      ownedMaterial.map = ownedTexture;
      const group = P.group(THREE, 'throwing-owned-kit', callCtx.root);
      group.add(new THREE.Mesh(ownedGeometry, ownedMaterial));
      geometryCount = countDisposeEvents(ownedGeometry);
      materialCount = countDisposeEvents(ownedMaterial);
      textureCount = countDisposeEvents(ownedTexture);
      return group;
    },
    dispose() { throw new Error('intentional dispose failure'); },
  });
  sandbox.registerGenreWorld('prism', { create() { return new THREE.Group(); }, dispose() {} });
  sandbox.registerGenreWorld('ambient', {
    create(callCtx) {
      const geometry = P.geometry(THREE, 'BoxGeometry', [2, 2, 2]);
      const material = P.material(THREE, 'MeshBasicMaterial', {});
      candidateGeometryCount = countDisposeEvents(geometry);
      candidateMaterialCount = countDisposeEvents(material);
      const partial = P.group(THREE, 'failed-owned-candidate', callCtx.root);
      partial.add(new THREE.Mesh(geometry, material));
      callCtx.camera.position.x = 404;
      throw new Error('intentional candidate failure');
    },
    dispose(instance) {
      assert.equal(instance, null);
      nullCandidateDisposeCalls += 1;
    },
  });
  sandbox.registerGenreWorld('folk', {
    create(callCtx) {
      const borrowedMaterial = new THREE.MeshBasicMaterial();
      const unmountedMaterial = P.material(THREE, 'MeshBasicMaterial', {});
      borrowedUnmountedMaterialCount = countDisposeEvents(borrowedMaterial);
      unmountedMaterialCount = countDisposeEvents(unmountedMaterial);
      P.geometry(THREE, 'MissingProductionGeometry', []);
      return callCtx.root;
    },
    dispose() {
      throw new Error('unmounted candidate must use generic cleanup');
    },
  });
  assert.equal(sandbox.startGenreWorldEngine(ctx), true);
  assert.equal(sandbox.switchGenreWorld('electronic', ctx), true);
  assert.equal(sandbox.switchGenreWorld('prism', ctx), true);
  assert.equal(geometryCount(), 1);
  assert.equal(materialCount(), 1);
  assert.equal(textureCount(), 1, 'owned material texture graph is disposed exactly once');
  const activeCameraX = ctx.camera.position.x;
  assert.equal(sandbox.switchGenreWorld('ambient', ctx), false);
  assert.equal(sandbox.genreWorldEngineState.current.record.id, 'prism',
    'failed candidate must preserve the active world');
  assert.equal(ctx.camera.position.x, activeCameraX,
    'failed construction must preserve the active camera');
  assert.equal(nullCandidateDisposeCalls, 0,
    'dispose(null) cannot claim cleanup of an unreachable candidate instance');
  assert.equal(candidateGeometryCount(), 1);
  assert.equal(candidateMaterialCount(), 1,
    'failed candidate owned resources use exactly-once fallback cleanup');
  assert.equal(sandbox.switchGenreWorld('folk', ctx), false);
  assert.equal(sandbox.genreWorldEngineState.current.record.id, 'prism');
  assert.equal(unmountedMaterialCount(), 1,
    'owned material allocated before geometry failure must dispose exactly once');
  assert.equal(borrowedUnmountedMaterialCount(), 0,
    'borrowed unmounted material must not enter candidate cleanup');
  const afterFailedScope = P.material(THREE, 'MeshBasicMaterial', {});
  const afterFailedScopeCount = countDisposeEvents(afterFailedScope);
  sandbox.stopGenreWorldEngine();
  assert.equal(afterFailedScopeCount(), 0,
    'failed create must not leave an owned-resource scope active');
}

console.log('OK real Three genre-world ownership and exactly-once cleanup');
