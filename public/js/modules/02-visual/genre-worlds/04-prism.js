/* OrangeSea · Prism world: glass dream park (pop/anime/default). */
(function registerPrismWorld() {
  if (typeof registerGenreWorld !== 'function' || typeof GenreWorldPrimitives === 'undefined') return;
  var P = GenreWorldPrimitives;

  function mesh(THREE, kind, args, materialValue, parent, name) {
    var value = new THREE.Mesh(P.geometry(THREE, kind, args), materialValue);
    value.name = name || '';
    parent.add(value);
    return value;
  }

  var kit = {
    create: function (ctx) {
      var THREE = ctx.THREE;
      var root = P.group(THREE, 'prism-dream-park', ctx.root);
      var low = P.group(THREE, 'floating-glass-islands', root);
      var mid = P.group(THREE, 'prism-heart-garden', root);
      var high = P.group(THREE, 'dream-ribbon-sky', root);
      var glass = P.material(THREE, 'MeshStandardMaterial', {
        color: 0x72e6ff, transparent: true, opacity: 0.34,
        metalness: 0.18, roughness: 0.08
      });
      var pearl = P.material(THREE, 'MeshStandardMaterial', {
        color: 0xf5d6ff, emissive: 0x5f2f88, emissiveIntensity: 1.1,
        metalness: 0.2, roughness: 0.24
      });
      var ribbon = P.material(THREE, 'MeshBasicMaterial', {
        color: 0xff72cb, transparent: true, opacity: 0.62, side: THREE.DoubleSide
      });
      var coreMaterial = P.material(THREE, 'MeshStandardMaterial', {
        color: 0xffffff, emissive: 0xff72cb, emissiveIntensity: 1.9,
        metalness: 0.38, roughness: 0.12
      });
      var detailNodes = [];
      for (var i = 0; i < 9; i++) {
        var angle = i / 9 * Math.PI * 2;
        var radius = 2.5 + (i % 3) * 1.25;
        var island = mesh(THREE, 'CylinderGeometry', [1.05, 0.42, 0.35, 6], glass, low, 'glass-floating-island');
        island.position.set(Math.cos(angle) * radius, (i % 2) * 0.4 - 0.1, Math.sin(angle) * radius);
        island.rotation.y = angle * 0.5;
        var crystal = mesh(THREE, 'ConeGeometry', [0.34, 1.2 + (i % 3) * 0.35, 5], pearl, low, 'island-crystal');
        crystal.position.set(island.position.x, island.position.y + 0.75, island.position.z);
        detailNodes.push(crystal);
      }
      var core = mesh(THREE, 'OctahedronGeometry', [1.55, 1], coreMaterial, mid, 'prism-core');
      core.position.y = 2.2;
      for (var j = 0; j < 3; j++) {
        var halo = mesh(THREE, 'TorusGeometry', [2.2 + j * 0.7, 0.07, 8, 48], ribbon, mid, 'prism-core-halo');
        halo.position.y = 2.2;
        halo.rotation.x = Math.PI / 2 + (j - 1) * 0.36;
        halo.rotation.y = j * 0.55;
        detailNodes.push(halo);
      }
      for (var k = 0; k < 7; k++) {
        var lightBand = mesh(THREE, 'TorusGeometry', [4.2 + k * 0.22, 0.045, 6, 48], ribbon, high, 'dream-light-ribbon');
        lightBand.position.y = 2.7 + k * 0.38;
        lightBand.rotation.x = Math.PI / 2 + (k % 2 ? 0.28 : -0.2);
        lightBand.rotation.z = k * 0.19;
        detailNodes.push(lightBand);
      }
      var motes = P.particles(THREE, 92, 15, {
        color: 0xffdcff, size: 0.085, transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending
      }, P.random('prism-park'));
      motes.name = 'dream-motes';
      high.add(motes);
      detailNodes.push(motes);
      P.light(THREE, 'AmbientLight', 0x342354, 0.72, 0, root);
      var coreLight = P.light(THREE, 'PointLight', 0xff72cb, 2.4, 18, root);
      coreLight.position.set(0, 3.2, 0);
      var state = {
        layers: { low: low, mid: mid, high: high },
        detailNodes: detailNodes,
        accentMaterials: [ribbon, coreMaterial],
        accent: new THREE.Color(0xff72cb),
        variant: 'default',
        core: core,
        coreLight: coreLight,
        disposed: false
      };
      root.userData.genreWorldState = state;
      if (ctx.root && root.parent !== ctx.root) ctx.root.add(root);
      if (ctx.camera && ctx.camera.position) {
        ctx.camera.position.set(0, 7.5, 15);
        ctx.camera.fov = 49;
        if (typeof ctx.camera.lookAt === 'function') ctx.camera.lookAt(0, 2.4, 0);
        if (typeof ctx.camera.updateProjectionMatrix === 'function') ctx.camera.updateProjectionMatrix();
      }
      return root;
    },

    applyTrack: function (track, ctx, root) {
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0xff72cb);
      var genre = String(track.genre || track.family || '').toLowerCase();
      state.variant = track.visualVariant || (genre.indexOf('anime') >= 0
        ? 'anime' : (genre.indexOf('pop') >= 0 ? 'pop' : 'default'));
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      state.layers.low.rotation.z = state.variant === 'anime' ? 0.08 : (state.variant === 'pop' ? -0.04 : 0);
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.readFrame(frame);
      state.layers.low.scale.x = state.layers.low.scale.z = P.smooth(state.layers.low.scale.x, 1 + audio.bass * 0.18, 0.26);
      state.layers.low.position.y = Math.sin((frame && frame.time || 0) * 0.35) * 0.12;
      state.layers.mid.rotation.y += 0.003 + audio.mid * 0.02;
      state.core.rotation.x += 0.002 + audio.mid * 0.012;
      state.layers.high.position.y = P.smooth(state.layers.high.position.y, 0.4 + audio.high * 1.45, 0.22);
      state.layers.high.rotation.z = audio.energy * 0.075;
      state.coreLight.intensity = 1.6 + audio.beat * 2.5 + audio.high;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('dream-ribbons', frame, ctx);
    },

    setQuality: function (profile, ctx, root) {
      var state = root.userData.genreWorldState;
      P.applyQualityBudget(state, profile, root);
    },

    dispose: function (root) {
      if (!root || !root.userData || root.userData.genreWorldState.disposed) return;
      root.userData.genreWorldState.disposed = true;
      P.dispose(root);
    }
  };

  registerGenreWorld('prism', kit);
})();
