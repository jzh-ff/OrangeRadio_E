/* =========================================================================
   OrangeSea · 风格世界引擎（Genre World Engine）
   复用主 scene / camera / THREE，仅管理独立 layer 上的一个世界根节点。
   不创建 renderer、rAF、Observer，也不接管主循环。
   ========================================================================= */

var GENRE_WORLD_LAYER = 29;

var genreWorldEngineState = {
  started: false,
  scene: null,
  camera: null,
  THREE: null,
  root: null,
  current: null,
  context: null,
  quality: null,
  cameraEntryState: null
};

var GENRE_WORLD_CAMERA_VALUE_KEYS = [
  'zoom', 'fov', 'near', 'far', 'filmGauge', 'filmOffset', 'focus'
];
var GENRE_WORLD_CAMERA_OBJECT_KEYS = [
  'position', 'quaternion', 'rotation', 'up', 'scale'
];

function resolveGenreWorldRuntime(ctx) {
  ctx = ctx || {};
  return {
    scene: ctx.scene || (typeof scene !== 'undefined' ? scene : null),
    camera: ctx.camera || (typeof camera !== 'undefined' ? camera : null),
    THREE: ctx.THREE || (typeof THREE !== 'undefined' ? THREE : null)
  };
}

function snapshotGenreWorldCamera(targetCamera) {
  if (!targetCamera) return null;
  var snapshot = {
    layerMask: targetCamera.layers ? targetCamera.layers.mask : null,
    values: {},
    objects: {}
  };
  for (var i = 0; i < GENRE_WORLD_CAMERA_VALUE_KEYS.length; i++) {
    var valueKey = GENRE_WORLD_CAMERA_VALUE_KEYS[i];
    snapshot.values[valueKey] = targetCamera[valueKey];
  }
  for (var j = 0; j < GENRE_WORLD_CAMERA_OBJECT_KEYS.length; j++) {
    var objectKey = GENRE_WORLD_CAMERA_OBJECT_KEYS[j];
    var value = targetCamera[objectKey];
    if (!value) continue;
    snapshot.objects[objectKey] = typeof value.clone === 'function'
      ? value.clone()
      : { x: value.x, y: value.y, z: value.z, w: value.w, order: value.order };
  }
  return snapshot;
}

function restoreGenreWorldCamera(targetCamera, snapshot) {
  if (!targetCamera || !snapshot) return;
  if (targetCamera.layers && snapshot.layerMask != null) {
    targetCamera.layers.mask = snapshot.layerMask;
  }
  for (var i = 0; i < GENRE_WORLD_CAMERA_VALUE_KEYS.length; i++) {
    var valueKey = GENRE_WORLD_CAMERA_VALUE_KEYS[i];
    if (snapshot.values[valueKey] !== undefined) {
      targetCamera[valueKey] = snapshot.values[valueKey];
    }
  }
  for (var j = 0; j < GENRE_WORLD_CAMERA_OBJECT_KEYS.length; j++) {
    var objectKey = GENRE_WORLD_CAMERA_OBJECT_KEYS[j];
    var target = targetCamera[objectKey];
    var source = snapshot.objects[objectKey];
    if (!target || !source) continue;
    if (typeof target.copy === 'function') {
      target.copy(source);
    } else {
      if (source.x !== undefined) target.x = source.x;
      if (source.y !== undefined) target.y = source.y;
      if (source.z !== undefined) target.z = source.z;
      if (source.w !== undefined) target.w = source.w;
      if (source.order !== undefined) target.order = source.order;
    }
  }
  if (typeof targetCamera.updateProjectionMatrix === 'function') {
    targetCamera.updateProjectionMatrix();
  }
}

function setGenreWorldObjectLayer(root) {
  if (!root) return;
  var setLayer = function (object) {
    if (!object || !object.layers) return;
    if (typeof object.layers.set === 'function') object.layers.set(GENRE_WORLD_LAYER);
    else object.layers.mask = Math.pow(2, GENRE_WORLD_LAYER);
  };
  if (typeof root.traverse === 'function') root.traverse(setLayer);
  else setLayer(root);
}

function disposeGenreWorldObject(root) {
  if (!root) return;
  var disposed = [];
  var visitedUniformValues = [];
  var isOwned = function (resource) {
    return !!(resource && (
      resource.__genreWorldOwned === true ||
      resource.userData && resource.userData.genreWorldOwned === true
    ));
  };
  var disposeOnce = function (resource) {
    if (!isOwned(resource) || typeof resource.dispose !== 'function' ||
      resource.__genreWorldDisposed === true || disposed.indexOf(resource) !== -1) return;
    disposed.push(resource);
    resource.__genreWorldDisposed = true;
    try {
      resource.dispose();
    } catch (err) {
      // 单个 GPU 资源异常不能阻断其余资源与相机状态的清理。
    }
  };
  var disposeTextureValue = function (value, recurseObjects) {
    if (!value || (typeof value !== 'object' && !Array.isArray(value))) return;
    if (value.isTexture === true) {
      disposeOnce(value);
      return;
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) disposeTextureValue(value[i], recurseObjects);
      return;
    }
    if (!recurseObjects || visitedUniformValues.indexOf(value) !== -1) return;
    visitedUniformValues.push(value);
    for (var valueKey in value) {
      if (Object.prototype.hasOwnProperty.call(value, valueKey)) {
        disposeTextureValue(value[valueKey], true);
      }
    }
  };
  var disposeMaterial = function (material) {
    if (!material || typeof material !== 'object') return;
    for (var materialKey in material) {
      if (!Object.prototype.hasOwnProperty.call(material, materialKey)) continue;
      if (materialKey === 'uniforms') {
        disposeTextureValue(material.uniforms, true);
      } else {
        disposeTextureValue(material[materialKey], false);
      }
    }
    disposeOnce(material);
  };
  var disposeObject = function (object) {
    if (!object) return;
    disposeOnce(object.geometry);
    if (Array.isArray(object.material)) {
      for (var i = 0; i < object.material.length; i++) disposeMaterial(object.material[i]);
    } else {
      disposeMaterial(object.material);
    }
  };
  try {
    if (typeof root.traverse === 'function') root.traverse(disposeObject);
    else disposeObject(root);
  } catch (err) {
    // 非标准 Object3D 的 traverse 异常按已完成的清理结果降级。
  }
  var resourceBag = root.userData && root.userData.genreWorldOwnedResources;
  if (Array.isArray(resourceBag)) {
    for (var bagIndex = 0; bagIndex < resourceBag.length; bagIndex++) {
      disposeMaterial(resourceBag[bagIndex]);
    }
    resourceBag.length = 0;
  }
}

function genreWorldCallContext(ctx, record, container) {
  var merged = {};
  var base = genreWorldEngineState.context || {};
  var key;
  for (key in base) {
    if (Object.prototype.hasOwnProperty.call(base, key)) merged[key] = base[key];
  }
  ctx = ctx || {};
  for (key in ctx) {
    if (Object.prototype.hasOwnProperty.call(ctx, key)) merged[key] = ctx[key];
  }
  merged.scene = genreWorldEngineState.scene;
  merged.camera = genreWorldEngineState.camera;
  merged.THREE = genreWorldEngineState.THREE;
  merged.root = container;
  merged.worldRoot = container;
  merged.genreWorldRoot = genreWorldEngineState.root;
  merged.world = record;
  merged.layer = GENRE_WORLD_LAYER;
  merged.quality = genreWorldEngineState.quality;
  return merged;
}

function cleanupGenreWorldEntry(entry) {
  if (!entry) return;
  try {
    if (entry.instance && entry.kit && typeof entry.kit.dispose === 'function') {
      entry.kit.dispose(entry.instance, entry.context);
    }
  } catch (err) {
    // Kit 清理异常不能阻断根节点移除及相机恢复。
  }
  if (entry.container && entry.container.parent &&
    typeof entry.container.parent.remove === 'function') {
    try {
      entry.container.parent.remove(entry.container);
    } catch (err) {
      // 继续释放候选资源；stop 仍会移除引擎总根节点。
    }
  }
  disposeGenreWorldObject(entry.container);
}

function startGenreWorldEngine(ctx) {
  if (genreWorldEngineState.started) {
    var repeatedRuntime = resolveGenreWorldRuntime(ctx);
    if ((repeatedRuntime.scene && repeatedRuntime.scene !== genreWorldEngineState.scene) ||
      (repeatedRuntime.camera && repeatedRuntime.camera !== genreWorldEngineState.camera) ||
      (repeatedRuntime.THREE && repeatedRuntime.THREE !== genreWorldEngineState.THREE)) {
      return false;
    }
    if (ctx) genreWorldEngineState.context = ctx;
    return true;
  }

  var runtime = resolveGenreWorldRuntime(ctx);
  if (!runtime.scene || !runtime.camera || !runtime.THREE ||
    typeof runtime.THREE.Group !== 'function' ||
    typeof runtime.scene.add !== 'function') {
    return false;
  }

  var root = new runtime.THREE.Group();
  root.name = 'genreWorldRoot';
  setGenreWorldObjectLayer(root);
  var cameraEntryState = snapshotGenreWorldCamera(runtime.camera);

  try {
    runtime.scene.add(root);
    if (runtime.camera.layers) {
      if (typeof runtime.camera.layers.set === 'function') {
        runtime.camera.layers.set(GENRE_WORLD_LAYER);
      } else {
        runtime.camera.layers.mask = Math.pow(2, GENRE_WORLD_LAYER);
      }
    }
  } catch (err) {
    if (root.parent && typeof root.parent.remove === 'function') root.parent.remove(root);
    restoreGenreWorldCamera(runtime.camera, cameraEntryState);
    return false;
  }

  genreWorldEngineState.started = true;
  genreWorldEngineState.scene = runtime.scene;
  genreWorldEngineState.camera = runtime.camera;
  genreWorldEngineState.THREE = runtime.THREE;
  genreWorldEngineState.root = root;
  genreWorldEngineState.current = null;
  genreWorldEngineState.context = ctx || {};
  genreWorldEngineState.cameraEntryState = cameraEntryState;
  return true;
}

function switchGenreWorld(id, ctx) {
  if (!genreWorldEngineState.started && !startGenreWorldEngine(ctx)) return false;

  var requested = typeof getGenreWorld === 'function' ? getGenreWorld(id) : null;
  var record = requested && requested.kit ? requested : null;
  if (!record && typeof getGenreWorld === 'function') {
    var fallback = getGenreWorld('prism');
    if (fallback && fallback.kit) record = fallback;
  }
  if (!record) return false;
  if (genreWorldEngineState.current &&
    genreWorldEngineState.current.record.id === record.id) {
    if (!ctx) return true;
    var current = genreWorldEngineState.current;
    var updatedContext = genreWorldCallContext(ctx, record, current.container);
    try {
      if (updatedContext.track && typeof current.kit.applyTrack === 'function') {
        current.kit.applyTrack(updatedContext.track, updatedContext, current.instance);
      }
    } catch (err) {
      return false;
    }
    current.context = updatedContext;
    genreWorldEngineState.context = updatedContext;
    return true;
  }

  var beforeCandidateCamera = snapshotGenreWorldCamera(genreWorldEngineState.camera);
  var container = new genreWorldEngineState.THREE.Group();
  container.name = 'genreWorld:' + record.id;
  setGenreWorldObjectLayer(container);
  var callContext = genreWorldCallContext(ctx, record, container);
  var instance = null;
  var candidate = {
    record: record,
    kit: record.kit,
    container: container,
    instance: null,
    context: callContext
  };
  var resourceScope = typeof GenreWorldPrimitives !== 'undefined' &&
    typeof GenreWorldPrimitives.beginOwnedResourceScope === 'function'
    ? GenreWorldPrimitives.beginOwnedResourceScope(container)
    : null;
  var candidateFailed = false;

  try {
    instance = record.kit.create(callContext);
    candidate.instance = instance;
    if (instance && instance !== container && !instance.parent &&
      typeof container.add === 'function') {
      container.add(instance);
    }
    setGenreWorldObjectLayer(container);
    if (genreWorldEngineState.quality && typeof record.kit.setQuality === 'function') {
      record.kit.setQuality(genreWorldEngineState.quality, callContext, instance);
    }
    if (callContext.track && typeof record.kit.applyTrack === 'function') {
      record.kit.applyTrack(callContext.track, callContext, instance);
    }
  } catch (err) {
    candidateFailed = true;
  } finally {
    if (resourceScope && typeof GenreWorldPrimitives !== 'undefined' &&
      typeof GenreWorldPrimitives.endOwnedResourceScope === 'function') {
      GenreWorldPrimitives.endOwnedResourceScope(resourceScope);
    }
  }
  if (candidateFailed) {
    cleanupGenreWorldEntry(candidate);
    restoreGenreWorldCamera(genreWorldEngineState.camera, beforeCandidateCamera);
    return false;
  }

  var previous = genreWorldEngineState.current;
  try {
    genreWorldEngineState.root.add(container);
  } catch (err) {
    cleanupGenreWorldEntry(candidate);
    restoreGenreWorldCamera(genreWorldEngineState.camera, beforeCandidateCamera);
    return false;
  }

  genreWorldEngineState.current = candidate;
  genreWorldEngineState.context = callContext;
  cleanupGenreWorldEntry(previous);
  return true;
}

function tickGenreWorld(frame) {
  var current = genreWorldEngineState.current;
  if (!current) return false;
  try {
    if (typeof current.kit.update === 'function') {
      current.kit.update(frame, current.context, current.instance);
    }
    if (typeof current.kit.renderLyrics === 'function') {
      current.kit.renderLyrics(frame, current.context, current.instance);
    }
    return true;
  } catch (err) {
    return false;
  }
}

function setGenreWorldQuality(profile) {
  genreWorldEngineState.quality = profile;
  var current = genreWorldEngineState.current;
  if (!current || typeof current.kit.setQuality !== 'function') return true;
  try {
    current.kit.setQuality(profile, current.context, current.instance);
    return true;
  } catch (err) {
    return false;
  }
}

function stopGenreWorldEngine() {
  if (!genreWorldEngineState.started) {
    genreWorldEngineState.current = null;
    genreWorldEngineState.context = null;
    genreWorldEngineState.quality = null;
    genreWorldEngineState.cameraEntryState = null;
    return true;
  }

  var targetCamera = genreWorldEngineState.camera;
  var cameraEntryState = genreWorldEngineState.cameraEntryState;
  cleanupGenreWorldEntry(genreWorldEngineState.current);
  genreWorldEngineState.current = null;

  var root = genreWorldEngineState.root;
  if (root && root.parent && typeof root.parent.remove === 'function') {
    root.parent.remove(root);
  } else if (root && genreWorldEngineState.scene &&
    typeof genreWorldEngineState.scene.remove === 'function') {
    genreWorldEngineState.scene.remove(root);
  }
  disposeGenreWorldObject(root);
  restoreGenreWorldCamera(targetCamera, cameraEntryState);

  genreWorldEngineState.started = false;
  genreWorldEngineState.scene = null;
  genreWorldEngineState.camera = null;
  genreWorldEngineState.THREE = null;
  genreWorldEngineState.root = null;
  genreWorldEngineState.context = null;
  genreWorldEngineState.quality = null;
  genreWorldEngineState.cameraEntryState = null;
  return true;
}
