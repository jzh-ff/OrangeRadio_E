/* OrangeSea · Genre World shared primitives (Three r128 / ES5). */
var GenreWorldPrimitives = (function () {
  var OWNED_RESOURCE_KEY = '__genreWorldOwned';
  var DISPOSED_RESOURCE_KEY = '__genreWorldDisposed';
  var OWNED_RESOURCE_BAG_KEY = 'genreWorldOwnedResources';
  var ownedResourceScopes = [];

  function beginOwnedResourceScope(container) {
    if (!container) return null;
    if (!container.userData || typeof container.userData !== 'object') {
      container.userData = {};
    }
    var bag = container.userData[OWNED_RESOURCE_BAG_KEY];
    if (!Array.isArray(bag)) {
      bag = [];
      container.userData[OWNED_RESOURCE_BAG_KEY] = bag;
    }
    var scope = { container: container, resources: bag, active: true };
    ownedResourceScopes.push(scope);
    return scope;
  }

  function endOwnedResourceScope(scope) {
    if (!scope || scope.active !== true) return false;
    var index = ownedResourceScopes.indexOf(scope);
    scope.active = false;
    if (index < 0) return false;
    for (var i = index + 1; i < ownedResourceScopes.length; i++) {
      ownedResourceScopes[i].active = false;
    }
    ownedResourceScopes.splice(index, ownedResourceScopes.length - index);
    return true;
  }

  function ownResource(resource) {
    if (!resource || (typeof resource !== 'object' && typeof resource !== 'function')) return resource;
    resource[OWNED_RESOURCE_KEY] = true;
    if (resource.userData && typeof resource.userData === 'object') {
      resource.userData.genreWorldOwned = true;
    }
    var scope = ownedResourceScopes.length
      ? ownedResourceScopes[ownedResourceScopes.length - 1]
      : null;
    if (scope && scope.active && scope.resources.indexOf(resource) === -1) {
      scope.resources.push(resource);
    }
    return resource;
  }

  function isOwnedResource(resource) {
    return !!(resource && (
      resource[OWNED_RESOURCE_KEY] === true ||
      resource.userData && resource.userData.genreWorldOwned === true
    ));
  }

  function finite(value, fallback) {
    value = Number(value);
    return isFinite(value) ? value : fallback;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, finite(value, 0)));
  }

  function group(THREE, name, parent) {
    var result = new THREE.Group();
    result.name = name || '';
    if (parent && typeof parent.add === 'function') parent.add(result);
    return result;
  }

  function material(THREE, kind, options) {
    var Type = THREE[kind] || THREE.MeshStandardMaterial || THREE.MeshBasicMaterial;
    return ownResource(new Type(options || {}));
  }

  function geometry(THREE, kind, args) {
    var Type = THREE[kind];
    if (typeof Type !== 'function') throw new Error('Unsupported world geometry: ' + kind);
    args = args || [];
    return ownResource(new (Function.prototype.bind.apply(Type, [null].concat(args)))());
  }

  function light(THREE, kind, color, intensity, distance, parent) {
    var Type = THREE[kind] || THREE.PointLight;
    var result = new Type(color, finite(intensity, 1), finite(distance, 0));
    if (parent && typeof parent.add === 'function') parent.add(result);
    return result;
  }

  function particles(THREE, count, spread, materialOptions, randomFn) {
    var geometryValue = ownResource(new THREE.BufferGeometry());
    var positions = [];
    var randomValue = typeof randomFn === 'function' ? randomFn : Math.random;
    count = Math.max(1, Math.floor(finite(count, 24)));
    spread = Math.max(0.1, finite(spread, 10));
    for (var i = 0; i < count; i++) {
      positions.push(
        (randomValue() - 0.5) * spread,
        randomValue() * spread * 0.65,
        (randomValue() - 0.5) * spread
      );
    }
    geometryValue.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return ownResource(new THREE.Points(
      geometryValue,
      material(THREE, 'PointsMaterial', materialOptions || { color: 0xffffff, size: 0.08 })
    ));
  }

  function validColor(value) {
    if (typeof value === 'number') return isFinite(value) && value >= 0 && value <= 0xffffff;
    if (typeof value !== 'string') return false;
    return /^#[0-9a-f]{6}$/i.test(value.trim()) || /^0x[0-9a-f]{6}$/i.test(value.trim());
  }

  function accentColor(THREE, track, ctx, fallback) {
    track = track || {};
    ctx = ctx || {};
    var candidates = [
      track.accent, track.accentColor, track.color, track.dominantColor,
      ctx.accent, ctx.accentColor
    ];
    var chosen = fallback == null ? 0xff7a45 : fallback;
    for (var i = 0; i < candidates.length; i++) {
      if (validColor(candidates[i])) {
        chosen = candidates[i];
        break;
      }
    }
    try {
      return new THREE.Color(chosen);
    } catch (err) {
      return new THREE.Color(fallback == null ? 0xff7a45 : fallback);
    }
  }

  function readFrame(frame) {
    frame = frame || {};
    var bass = clamp01(frame.bass != null ? frame.bass : frame.low);
    return {
      bass: bass,
      energy: clamp01(frame.energy),
      beat: frame.beat === true ? 1 : clamp01(frame.beat),
      low: clamp01(frame.low != null ? frame.low : bass),
      mid: clamp01(frame.mid),
      high: clamp01(frame.high)
    };
  }

  function smooth(current, target, amount) {
    current = finite(current, 0);
    target = finite(target, current);
    return current + (target - current) * clamp01(amount == null ? 0.12 : amount);
  }

  function quality(profile) {
    var value = profile && typeof profile === 'object'
      ? (profile.level || profile.quality || profile.tier)
      : profile;
    value = String(value || 'high').toLowerCase();
    var result;
    if (value === 'low' || value === 'eco' || value === 'performance' || value === '0') {
      result = {
        level: 'low', detail: 0.34, particles: 0.3, particleDensity: 0.3,
        volumetricLight: false, postProcessing: false,
        dprScale: 0.72, maxParticles: 640, maxLights: 3, maxTextures: 3
      };
    } else if (value === 'medium' || value === 'mid' || value === 'balanced' || value === '1') {
      result = {
        level: 'medium', detail: 0.67, particles: 0.65, particleDensity: 0.65,
        volumetricLight: true, postProcessing: false,
        dprScale: 0.86, maxParticles: 1280, maxLights: 5, maxTextures: 5
      };
    } else {
      result = {
        level: 'high', detail: 1, particles: 1, particleDensity: 1,
        volumetricLight: true, postProcessing: true,
        dprScale: 1, maxParticles: 2200, maxLights: 8, maxTextures: 8
      };
    }
    if (!profile || typeof profile !== 'object') return result;
    if (profile.detail != null) result.detail = clamp01(profile.detail);
    var density = profile.particleDensity != null ? profile.particleDensity : profile.particles;
    if (density != null) result.particleDensity = result.particles = clamp01(density);
    if (profile.volumetricLight != null) result.volumetricLight = !!profile.volumetricLight;
    if (profile.postProcessing != null) result.postProcessing = !!profile.postProcessing;
    if (profile.dprScale != null) result.dprScale = Math.max(0.25, finite(profile.dprScale, result.dprScale));
    if (profile.maxParticles != null) result.maxParticles = Math.max(0, Math.floor(finite(profile.maxParticles, result.maxParticles)));
    if (profile.maxLights != null) result.maxLights = Math.max(0, Math.floor(finite(profile.maxLights, result.maxLights)));
    if (profile.maxTextures != null) result.maxTextures = Math.max(0, Math.floor(finite(profile.maxTextures, result.maxTextures)));
    return result;
  }

  function applyQualityBudget(state, profile, root) {
    state = state || {};
    var normalized = quality(profile);
    state.qualityBudget = normalized;
    var detailNodes = Array.isArray(state.detailNodes) ? state.detailNodes : [];
    for (var i = 0; i < detailNodes.length; i++) {
      var detailData = detailNodes[i].userData || {};
      var detailIndex = isFinite(Number(detailData.detailIndex)) ? Number(detailData.detailIndex) : i;
      var detailMin = isFinite(Number(detailData.detailMin)) ? Number(detailData.detailMin) : 0;
      detailNodes[i].visible = detailMin <= normalized.detail &&
        detailIndex / Math.max(1, detailNodes.length) < normalized.detail;
    }
    var lightCount = 0;
    var volumetricNodes = [];
    var visit = function (node) {
      if (!node) return;
      if (node.isPoints && node.geometry && typeof node.geometry.setDrawRange === 'function') {
        var position = node.geometry.attributes && node.geometry.attributes.position;
        var total = position
          ? (isFinite(Number(position.count)) ? Number(position.count) : Math.floor((position.array && position.array.length || 0) / 3))
          : 0;
        var drawCount = Math.min(
          normalized.maxParticles,
          Math.max(0, Math.floor(total * normalized.particleDensity))
        );
        node.geometry.setDrawRange(0, drawCount);
      }
      if (node.isLight) {
        node.visible = lightCount < normalized.maxLights;
        lightCount++;
      }
      if (/smoke|mist|fog|volumetric/i.test(String(node.name || '')) &&
        (node.geometry || node.material)) {
        volumetricNodes.push(node);
      }
    };
    if (root && typeof root.traverse === 'function') root.traverse(visit);
    else if (root) visit(root);
    var volumetricLimit = normalized.volumetricLight
      ? Math.ceil(volumetricNodes.length * normalized.detail)
      : Math.min(1, volumetricNodes.length);
    var visibleVolumetric = 0;
    for (var j = 0; j < volumetricNodes.length; j++) {
      var node = volumetricNodes[j];
      var nodeData = node.userData || {};
      var nodeIndex = isFinite(Number(nodeData.detailIndex)) ? Number(nodeData.detailIndex) : j;
      var nodeMin = isFinite(Number(nodeData.detailMin)) ? Number(nodeData.detailMin) : 0;
      var withinDetail = nodeMin <= normalized.detail &&
        nodeIndex / Math.max(1, volumetricNodes.length) < normalized.detail;
      node.visible = withinDetail && visibleVolumetric < volumetricLimit;
      if (node.visible) visibleVolumetric++;
    }
    return normalized;
  }

  function random(seed) {
    var text = String(seed == null ? 'orangesea' : seed);
    var state = 2166136261;
    for (var i = 0; i < text.length; i++) {
      state ^= text.charCodeAt(i);
      state = Math.imul(state, 16777619);
    }
    return function () {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function pool(createItem, resetItem) {
    var free = [];
    var used = [];
    return {
      acquire: function () {
        var item = free.length ? free.pop() : createItem();
        used.push(item);
        return item;
      },
      release: function (item) {
        var index = used.indexOf(item);
        if (index < 0) return false;
        used.splice(index, 1);
        if (typeof resetItem === 'function') resetItem(item);
        free.push(item);
        return true;
      },
      releaseAll: function () {
        while (used.length) this.release(used[used.length - 1]);
      },
      activeCount: function () { return used.length; },
      freeCount: function () { return free.length; }
    };
  }

  function setAccent(materialValue, color) {
    if (!materialValue || !color) return;
    if (materialValue.color && typeof materialValue.color.set === 'function') materialValue.color.set(color);
    if (materialValue.emissive && typeof materialValue.emissive.set === 'function') materialValue.emissive.set(color);
  }

  function dispose(root) {
    if (!root || root.userData && root.userData.genreWorldDisposed) return;
    if (root.userData) root.userData.genreWorldDisposed = true;
    var resources = [];
    var visitedUniformValues = [];
    function disposeOnce(value) {
      if (!isOwnedResource(value) || typeof value.dispose !== 'function' ||
        value[DISPOSED_RESOURCE_KEY] === true || resources.indexOf(value) >= 0) return;
      resources.push(value);
      value[DISPOSED_RESOURCE_KEY] = true;
      try { value.dispose(); } catch (err) {}
    }
    function disposeTextureValue(value, recurseObjects) {
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
      for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          disposeTextureValue(value[key], true);
        }
      }
    }
    function disposeMaterial(materialValue) {
      if (!materialValue || typeof materialValue !== 'object') return;
      for (var key in materialValue) {
        if (!Object.prototype.hasOwnProperty.call(materialValue, key)) continue;
        if (key === 'uniforms') disposeTextureValue(materialValue[key], true);
        else disposeTextureValue(materialValue[key], false);
      }
      disposeOnce(materialValue);
    }
    function visit(node) {
      disposeOnce(node.geometry);
      var materials = Array.isArray(node.material) ? node.material : [node.material];
      for (var i = 0; i < materials.length; i++) disposeMaterial(materials[i]);
    }
    if (typeof root.traverse === 'function') root.traverse(visit);
    else visit(root);
    if (root.parent && typeof root.parent.remove === 'function') root.parent.remove(root);
  }

  return {
    group: group,
    material: material,
    geometry: geometry,
    light: light,
    particles: particles,
    accentColor: accentColor,
    readFrame: readFrame,
    smooth: smooth,
    quality: quality,
    applyQualityBudget: applyQualityBudget,
    beginOwnedResourceScope: beginOwnedResourceScope,
    endOwnedResourceScope: endOwnedResourceScope,
    ownResource: ownResource,
    isOwnedResource: isOwnedResource,
    random: random,
    pool: pool,
    setAccent: setAccent,
    dispose: dispose,
    clamp01: clamp01
  };
})();
