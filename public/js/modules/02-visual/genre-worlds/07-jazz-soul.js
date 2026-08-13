/* OrangeSea · Jazz/soul world: blue-smoke club. */
(function registerJazzSoulWorld() {
  if (typeof registerGenreWorld !== 'function' || typeof GenreWorldPrimitives === 'undefined') return;
  var P = GenreWorldPrimitives;

  function mesh(THREE, kind, args, materialValue, parent, name) {
    var value = new THREE.Mesh(P.geometry(THREE, kind, args), materialValue);
    value.name = name;
    parent.add(value);
    return value;
  }

  var kit = {
    create: function (ctx) {
      var THREE = ctx.THREE;
      var root = P.group(THREE, 'jazz-soul-blue-smoke-club', ctx.root);
      var low = P.group(THREE, 'burgundy-darkroom-floor', root);
      var mid = P.group(THREE, 'bronze-improvised-curves', root);
      var high = P.group(THREE, 'volumetric-blue-smoke', root);
      var burgundy = P.material(THREE, 'MeshStandardMaterial', {
        color: 0x310f1b, metalness: 0.2, roughness: 0.82
      });
      var bronze = P.material(THREE, 'MeshStandardMaterial', {
        color: 0xae7740, emissive: 0x3d1f0d, emissiveIntensity: 0.75, metalness: 0.76, roughness: 0.3
      });
      var smoke = P.material(THREE, 'MeshBasicMaterial', {
        color: 0x315d78, transparent: true, opacity: 0.16, side: THREE.DoubleSide
      });
      var floor = mesh(THREE, 'CylinderGeometry', [6.5, 6.8, 0.45, 40], burgundy, low, 'burgundy-club-floor');
      floor.position.y = -0.3;
      var detailNodes = [];
      for (var i = 0; i < 9; i++) {
        var curve = mesh(THREE, 'TorusGeometry', [1.5 + i * 0.38, 0.06 + i % 2 * 0.025, 8, 40], bronze, mid, 'bronze-improvised-curve');
        curve.position.set((i % 3 - 1) * 1.2, 1.2 + i * 0.37, (i % 2 ? -1 : 1) * 0.8);
        curve.rotation.set(Math.PI / 2 + i * 0.08, i * 0.25, i * 0.13);
        detailNodes.push(curve);
      }
      for (var j = 0; j < 8; j++) {
        var cloud = mesh(THREE, 'IcosahedronGeometry', [1.2 + j % 3 * 0.38, 1], smoke, high, 'blue-smoke-volume');
        cloud.position.set((j - 3.5) * 1.15, 2.2 + j % 4 * 0.65, -2 + j % 3 * 1.7);
        cloud.scale.set(1.7, 0.65, 1.15);
        detailNodes.push(cloud);
      }
      var glints = P.particles(THREE, 46, 11, {
        color: 0xd9a86c, size: 0.065, transparent: true, opacity: 0.5
      }, P.random('jazz-soul-club'));
      glints.name = 'bronze-club-glints';
      high.add(glints);
      detailNodes.push(glints);
      P.light(THREE, 'AmbientLight', 0x181c2c, 0.58, 0, root);
      var clubLight = P.light(THREE, 'PointLight', 0x477f9f, 2.1, 17, root);
      clubLight.position.set(-2, 4.8, 2);
      var state = {
        layers: { low: low, mid: mid, high: high },
        detailNodes: detailNodes,
        coreMaterials: [burgundy, bronze, smoke],
        accentMaterials: [],
        accent: new THREE.Color(0xae7740),
        variant: 'jazz',
        accentLight: clubLight,
        clubLight: clubLight,
        groove: 0,
        disposed: false
      };
      root.userData.genreWorldState = state;
      if (ctx.root && root.parent !== ctx.root) ctx.root.add(root);
      if (ctx.camera && ctx.camera.position) {
        ctx.camera.position.set(0, 6.8, 15);
        ctx.camera.fov = 48;
        if (typeof ctx.camera.lookAt === 'function') ctx.camera.lookAt(0, 2.3, 0);
        if (typeof ctx.camera.updateProjectionMatrix === 'function') ctx.camera.updateProjectionMatrix();
      }
      return root;
    },

    applyTrack: function (track, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState) return;
      var state = root.userData.genreWorldState;
      var genre = String(track.genre || track.family || '').toLowerCase();
      state.variant = track.visualVariant || (genre.indexOf('soul') >= 0 ? 'soul' : 'jazz');
      state.accent = P.accentColor(ctx.THREE, track, ctx, state.variant === 'soul' ? 0x9e3c4f : 0xae7740);
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      if (state.accentLight && state.accentLight.color) state.accentLight.color.set(state.accent);
      state.layers.mid.rotation.z = state.variant === 'soul' ? -0.055 : 0.035;
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.readFrame(frame);
      state.groove = P.smooth(state.groove, audio.mid * 0.65 + audio.bass * 0.35, 0.14);
      state.layers.low.scale.x = state.layers.low.scale.z = P.smooth(state.layers.low.scale.x, 1 + audio.bass * 0.15, 0.18);
      state.layers.low.scale.y = 1 + audio.beat * 0.02;
      state.layers.mid.rotation.y += 0.001 + audio.mid * (state.variant === 'jazz' ? 0.012 : 0.007);
      state.layers.high.position.y = P.smooth(state.layers.high.position.y, 0.35 + audio.high * 0.88, 0.15);
      state.layers.high.rotation.y += 0.0005 + state.groove * 0.004;
      state.clubLight.intensity = 1.35 + state.groove * 1.5 + audio.high * 0.5;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('improvised-anchor', frame, ctx);
    },

    setQuality: function (profile, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState) return;
      var state = root.userData.genreWorldState;
      P.applyQualityBudget(state, profile, root);
    },

    dispose: function (root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      root.userData.genreWorldState.disposed = true;
      P.dispose(root);
    }
  };

  registerGenreWorld('jazz-soul', kit);
})();
