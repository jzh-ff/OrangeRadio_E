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

  /* ------------------------------------------------------------------ */
  /* 程序化纹理：无外部资源，全部 Canvas 生成；非浏览器环境安全回退 null */
  /* ------------------------------------------------------------------ */

  function canvasTexture(THREE, draw, width, height) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    if (!THREE || typeof THREE.CanvasTexture !== 'function') return null;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return null;
      draw(ctx, width, height);
      var texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      return ownResource(texture);
    } catch (err) {
      return null;
    }
  }

  /* 灰度径向辉光：核心亮、边缘透明，靠材质 color 染色，可随专辑主色重着色 */
  function glowTexture(THREE) {
    return canvasTexture(THREE, function (ctx, w, h) {
      var half = w / 2;
      var gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.18, 'rgba(255,255,255,.92)');
      gradient.addColorStop(0.42, 'rgba(255,255,255,.34)');
      gradient.addColorStop(0.72, 'rgba(255,255,255,.08)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }, 128, 128);
  }

  /* 竖直渐变贴图：用于雾海/烟层的上下柔和过渡 */
  function gradientTexture(THREE, stops) {
    return canvasTexture(THREE, function (ctx, w, h) {
      var gradient = ctx.createLinearGradient(0, 0, 0, h);
      for (var i = 0; i < stops.length; i++) gradient.addColorStop(stops[i][0], stops[i][1]);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }, 8, 128);
  }

  /* 楼宇窗灯：透明底 + 稀疏暖白窗格，作 emissiveMap 使用 */
  function windowTexture(THREE, opts) {
    opts = opts || {};
    var cols = finite(opts.cols, 8);
    var rows = finite(opts.rows, 22);
    var litRatio = finite(opts.litRatio, 0.42);
    var tint = opts.tint || '255,214,140';
    var seed = typeof opts.random === 'function' ? opts.random : random(opts.seed || 'windows');
    return canvasTexture(THREE, function (ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      var cw = w / cols;
      var ch = h / rows;
      for (var c = 0; c < cols; c++) {
        for (var r = 0; r < rows; r++) {
          if (seed() > litRatio) continue;
          var alpha = 0.35 + seed() * 0.6;
          ctx.fillStyle = 'rgba(' + tint + ',' + alpha.toFixed(3) + ')';
          ctx.fillRect(c * cw + cw * 0.22, r * ch + ch * 0.24, cw * 0.56, ch * 0.42);
        }
      }
    }, 64, 176);
  }

  function glowPlane(THREE, color, size, opts) {
    opts = opts || {};
    var texture = glowTexture(THREE);
    var materialValue = material(THREE, 'MeshBasicMaterial', {
      color: color == null ? 0xffffff : color,
      transparent: true,
      opacity: finite(opts.opacity, 0.5),
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: texture || undefined
    });
    var plane = new THREE.Mesh(
      geometry(THREE, 'PlaneGeometry', [size, size]),
      materialValue
    );
    plane.name = opts.name || 'glow';
    plane.renderOrder = finite(opts.renderOrder, 2);
    if (opts.parent && typeof opts.parent.add === 'function') opts.parent.add(plane);
    return plane;
  }

  function applySkyVertexColors(THREE, geometryValue, stops) {
    if (!geometryValue || typeof geometryValue.setAttribute !== 'function') return false;
    var position = geometryValue.attributes && geometryValue.attributes.position;
    if (!position || !position.count || typeof THREE.Float32BufferAttribute !== 'function') return false;
    var topColor = new THREE.Color(stops.top);
    var horizonColor = new THREE.Color(stops.horizon);
    var belowColor = new THREE.Color(stops.below != null ? stops.below : stops.horizon);
    var bandTop = finite(stops.bandTop, 0.3);
    var bandBottom = finite(stops.bandBottom, -0.12);
    var colors = [];
    var array = position.array;
    for (var i = 0; i < position.count; i++) {
      var t = array[i * 3 + 1];
      var color;
      if (t >= bandTop) color = horizonColor.clone().lerp(topColor, Math.min(1, (t - bandTop) / (1 - bandTop + 0.0001)));
      else if (t <= bandBottom) color = horizonColor.clone().lerp(belowColor, Math.min(1, (bandBottom - t) / (bandBottom + 1 + 0.0001)));
      else color = horizonColor.clone();
      colors.push(color.r, color.g, color.b);
    }
    geometryValue.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return true;
  }

  /* 天空穹顶：倒扣大球，顶点色三段渐变（天顶/地平线/地下），每世界的环境基调 */
  function skyDome(THREE, opts) {
    opts = opts || {};
    var radius = finite(opts.radius, 46);
    var geometryValue = geometry(THREE, 'IcosahedronGeometry', [radius, finite(opts.detail, 3)]);
    var materialValue = material(THREE, 'MeshBasicMaterial', {
      color: opts.below != null ? opts.below : (opts.horizon != null ? opts.horizon : 0x05070c),
      side: THREE.DoubleSide,
      depthWrite: false
    });
    var dome = new THREE.Mesh(geometryValue, materialValue);
    dome.name = opts.name || 'world-sky';
    dome.renderOrder = -10;
    if (applySkyVertexColors(THREE, geometryValue, {
      top: opts.top != null ? opts.top : 0x02030a,
      horizon: opts.horizon != null ? opts.horizon : 0x0a1220,
      below: opts.below != null ? opts.below : 0x04050a,
      bandTop: finite(opts.bandTop, 0.3),
      bandBottom: finite(opts.bandBottom, -0.12)
    })) {
      materialValue.vertexColors = true;
    }
    if (opts.parent && typeof opts.parent.add === 'function') opts.parent.add(dome);
    return dome;
  }

  /* 星野：上半球壳分布的辉光点，配合 additive 贴图形成柔和星空 */
  function stars(THREE, count, radius, color, opts) {
    opts = opts || {};
    count = Math.max(1, Math.floor(finite(count, 120)));
    var seed = typeof opts.random === 'function' ? opts.random : random(opts.seed || 'stars');
    var geometryValue = ownResource(new THREE.BufferGeometry());
    var positions = [];
    for (var i = 0; i < count; i++) {
      var theta = seed() * Math.PI * 2;
      var phi = Math.acos(finite(opts.minY, 0.05) + seed() * (1 - finite(opts.minY, 0.05)));
      var r = radius * (0.82 + seed() * 0.18);
      positions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
    }
    geometryValue.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    var texture = glowTexture(THREE);
    var points = ownResource(new THREE.Points(geometryValue, material(THREE, 'PointsMaterial', {
      color: color == null ? 0xffffff : color,
      size: finite(opts.size, 0.55),
      sizeAttenuation: true,
      transparent: true,
      opacity: finite(opts.opacity, 0.8),
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: texture || undefined
    })));
    points.name = opts.name || 'world-stars';
    points.renderOrder = -6;
    if (opts.parent && typeof opts.parent.add === 'function') opts.parent.add(points);
    return points;
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

  var GLSL_HASH = [
    'float hash11(float n){return fract(sin(n)*43758.5453123);}',
    'float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float noise21(vec2 p){',
    '  vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);',
    '  return mix(mix(hash21(i),hash21(i+vec2(1.0,0.0)),f.x),mix(hash21(i+vec2(0.0,1.0)),hash21(i+vec2(1.0,1.0)),f.x),f.y);',
    '}'
  ].join('\n');

  var GLSL_COVER = [
    'vec3 sampleCover(vec2 uv){',
    '  vec2 s=clamp(uv,0.0,1.0);',
    '  if(uHasCover<0.5){',
    '    float g=0.28+0.55*s.y;',
    '    return mix(uAccent*0.28, mix(uAccent,vec3(1.0),0.42), g);',
    '  }',
    '  return texture2D(uCover,s).rgb;',
    '}'
  ].join('\n');

  var GLSL_VERT_UV = [
    'varying vec2 vUv;',
    'void main(){',
    '  vUv=uv;',
    '  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);',
    '}'
  ].join('\n');

  function shaderChunks() {
    return { hash: GLSL_HASH, cover: GLSL_COVER, vertUv: GLSL_VERT_UV };
  }

  function audioUniforms(THREE, accentHex, coverTexture) {
    return {
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uHigh: { value: 0 },
      uEnergy: { value: 0 },
      uBeat: { value: 0 },
      uHasCover: { value: 0 },
      uAccent: { value: new THREE.Color(accentHex == null ? 0xffffff : accentHex) },
      uCover: { value: coverTexture || null }
    };
  }

  function dummyCover(THREE) {
    return canvasTexture(THREE, function (ctx, w, h) {
      ctx.fillStyle = '#6a6a6a';
      ctx.fillRect(0, 0, w, h);
    }, 4, 4);
  }

  function bindCover(uniforms) {
    var tex = (typeof coverTex !== 'undefined' && coverTex) ? coverTex : null;
    var has = !!(tex && tex.image);
    var list = Array.isArray(uniforms) ? uniforms : (uniforms ? [uniforms] : []);
    for (var i = 0; i < list.length; i++) {
      var u = list[i];
      if (!u) continue;
      if (u.uCover) u.uCover.value = tex || u.uCover.value;
      if (u.uHasCover) u.uHasCover.value = has ? 1 : 0;
    }
    return tex;
  }

  function writeAudio(targets, audio, time, accent) {
    var list = Array.isArray(targets) ? targets : (targets ? [targets] : []);
    audio = audio || {};
    for (var i = 0; i < list.length; i++) {
      var u = list[i];
      if (!u) continue;
      if (u.uTime) u.uTime.value = finite(time, 0);
      if (u.uBass) u.uBass.value = clamp01(audio.bass);
      if (u.uMid) u.uMid.value = clamp01(audio.mid);
      if (u.uHigh) u.uHigh.value = clamp01(audio.high);
      if (u.uEnergy) u.uEnergy.value = clamp01(audio.energy);
      if (u.uBeat) u.uBeat.value = clamp01(audio.beat);
      if (u.uAccent && accent && u.uAccent.value && typeof u.uAccent.value.set === 'function') {
        u.uAccent.value.set(accent);
      }
    }
  }

  function shaderMaterial(THREE, options) {
    options = options || {};
    if (!THREE || typeof THREE.ShaderMaterial !== 'function') {
      return material(THREE, 'MeshBasicMaterial', {
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthWrite: false
      });
    }
    return ownResource(new THREE.ShaderMaterial({
      uniforms: options.uniforms || {},
      vertexShader: options.vertex || options.vertexShader || GLSL_VERT_UV,
      fragmentShader: options.fragment || options.fragmentShader || [
        'precision highp float; varying vec2 vUv; uniform vec3 uAccent;',
        'void main(){ gl_FragColor = vec4(uAccent, 1.0); }'
      ].join('\n'),
      transparent: options.transparent !== false,
      depthWrite: options.depthWrite === true,
      depthTest: options.depthTest !== false,
      blending: options.blending != null ? options.blending : THREE.NormalBlending,
      side: options.side != null ? options.side : THREE.DoubleSide
    }));
  }

  function shaderPlane(THREE, parent, name, size, uniforms, fragment, opts) {
    opts = opts || {};
    var width = Array.isArray(size) ? finite(size[0], 4) : finite(size, 4);
    var height = Array.isArray(size) ? finite(size[1], width) : width;
    var mesh = new THREE.Mesh(
      geometry(THREE, 'PlaneGeometry', [
        width, height,
        Math.max(1, Math.floor(finite(opts.segX, 1))),
        Math.max(1, Math.floor(finite(opts.segY, 1)))
      ]),
      shaderMaterial(THREE, {
        uniforms: uniforms,
        vertex: opts.vertex || GLSL_VERT_UV,
        fragment: fragment,
        transparent: opts.transparent,
        depthWrite: opts.depthWrite,
        blending: opts.blending,
        side: opts.side
      })
    );
    mesh.name = name || 'shader-plane';
    mesh.renderOrder = finite(opts.renderOrder, 0);
    if (parent && typeof parent.add === 'function') parent.add(mesh);
    return mesh;
  }

  function noiseTexture(THREE) {
    var seed = random('genre-noise');
    return canvasTexture(THREE, function (ctx, w, h) {
      var image = ctx.createImageData(w, h);
      for (var i = 0; i < w * h; i++) {
        var n = Math.floor(seed() * 256);
        image.data[i * 4] = n;
        image.data[i * 4 + 1] = n;
        image.data[i * 4 + 2] = n;
        image.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
    }, 64, 64);
  }

  function frameCamera(camera, opts) {
    opts = opts || {};
    if (!camera || !camera.position || typeof camera.position.set !== 'function') return false;
    camera.position.set(finite(opts.x, 0), finite(opts.y, 1.6), finite(opts.z, 6.2));
    if (opts.fov != null) camera.fov = finite(opts.fov, 42);
    if (typeof camera.lookAt === 'function') {
      camera.lookAt(finite(opts.lookX, 0), finite(opts.lookY, 0.2), finite(opts.lookZ, 0));
    }
    if (typeof camera.updateProjectionMatrix === 'function') camera.updateProjectionMatrix();
    return true;
  }

  function visualizerRoot(THREE, ctx, name) {
    var root = group(THREE, name, ctx && ctx.root);
    return {
      root: root,
      low: group(THREE, name + '-atmosphere', root),
      mid: group(THREE, name + '-hero', root),
      high: group(THREE, name + '-spark', root)
    };
  }

  function driveLayers(state, audio, opts) {
    if (!state || !state.layers) return;
    opts = opts || {};
    audio = audio || {};
    var layers = state.layers;
    var bassAmt = opts.bassScale != null ? opts.bassScale : 0.16;
    var bassSmooth = opts.bassSmooth != null ? opts.bassSmooth : 0.28;
    layers.low.scale.x = layers.low.scale.z = smooth(
      layers.low.scale.x, 1 + clamp01(audio.bass) * bassAmt, bassSmooth
    );
    if (opts.keepScaleY !== false) layers.low.scale.y = 1;
    layers.mid.rotation.y += (opts.midBase != null ? opts.midBase : 0.0018) + clamp01(audio.mid) * (opts.midSpin != null ? opts.midSpin : 0.01);
    layers.high.position.y = smooth(
      layers.high.position.y,
      (opts.highBase != null ? opts.highBase : 0) + clamp01(audio.high) * (opts.highLift != null ? opts.highLift : 0.85),
      opts.highSmooth != null ? opts.highSmooth : 0.22
    );
  }

  function tickVisualizer(state, frame, opts) {
    if (!state || state.disposed) return null;
    var audio = readFrame(frame);
    writeAudio(state.uniforms, audio, frame && frame.time, state.accent);
    bindCover(state.uniforms);
    driveLayers(state, audio, opts);
    return audio;
  }

  function setAccent(materialValue, color) {
    if (!materialValue || !color) return;
    if (materialValue.color && typeof materialValue.color.set === 'function') materialValue.color.set(color);
    if (materialValue.emissive && typeof materialValue.emissive.set === 'function') materialValue.emissive.set(color);
  }

  /* 面向相机的辉光板：无后处理时模拟 bloom 的核心手段 */
  function billboardToCamera(plane, camera) {
    if (!plane || !camera) return false;
    if (!plane.quaternion || !camera.quaternion ||
      typeof plane.quaternion.copy !== 'function') return false;
    plane.quaternion.copy(camera.quaternion);
    return true;
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
    canvasTexture: canvasTexture,
    glowTexture: glowTexture,
    gradientTexture: gradientTexture,
    windowTexture: windowTexture,
    glowPlane: glowPlane,
    skyDome: skyDome,
    stars: stars,
    billboardToCamera: billboardToCamera,
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
    clamp01: clamp01,
    shaderChunks: shaderChunks,
    audioUniforms: audioUniforms,
    dummyCover: dummyCover,
    bindCover: bindCover,
    writeAudio: writeAudio,
    shaderMaterial: shaderMaterial,
    shaderPlane: shaderPlane,
    noiseTexture: noiseTexture,
    frameCamera: frameCamera,
    visualizerRoot: visualizerRoot,
    driveLayers: driveLayers,
    tickVisualizer: tickVisualizer
  };
})();
