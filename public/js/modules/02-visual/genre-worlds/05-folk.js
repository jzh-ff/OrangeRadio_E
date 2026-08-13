/* OrangeSea · Folk world: amber open field. */
(function registerFolkWorld() {
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
      var root = P.group(THREE, 'folk-amber-wilderness', ctx.root);
      var low = P.group(THREE, 'amber-grass-waves', root);
      var mid = P.group(THREE, 'wood-paper-grove', root);
      var high = P.group(THREE, 'sunset-string-sky', root);
      var wood = P.material(THREE, 'MeshStandardMaterial', {
        color: 0x70421f, metalness: 0.04, roughness: 0.92
      });
      var paper = P.material(THREE, 'MeshStandardMaterial', {
        color: 0xe8c98b, transparent: true, opacity: 0.78, roughness: 0.8
      });
      var amber = P.material(THREE, 'MeshBasicMaterial', {
        color: 0xef8f32, transparent: true, opacity: 0.7, side: THREE.DoubleSide
      });
      var detailNodes = [];
      for (var i = 0; i < 13; i++) {
        var blade = mesh(THREE, 'PlaneGeometry', [0.22, 1.2 + i % 4 * 0.25], paper, low, 'paper-grass-wave');
        blade.position.set((i - 6) * 0.72, 0.4 + i % 3 * 0.12, (i % 2 ? -1 : 1) * (1.8 + i % 4 * 0.4));
        blade.rotation.y = i * 0.37;
        detailNodes.push(blade);
      }
      for (var j = 0; j < 7; j++) {
        var trunk = mesh(THREE, 'CylinderGeometry', [0.12, 0.2, 2.4 + j * 0.15, 7], wood, mid, 'carved-wood-post');
        trunk.position.set((j - 3) * 1.35, 1.1, -2.5 + (j % 2) * 1.1);
        var page = mesh(THREE, 'PlaneGeometry', [0.8, 1.1], paper, mid, 'floating-paper-page');
        page.position.set(trunk.position.x + 0.35, 2.3 + j % 3 * 0.35, trunk.position.z);
        page.rotation.y = j * 0.48;
        detailNodes.push(page);
      }
      var sun = mesh(THREE, 'TorusGeometry', [3.8, 0.13, 10, 48], amber, high, 'long-sunset-halo');
      sun.position.set(0, 4.8, -4.5);
      sun.rotation.x = Math.PI / 2;
      detailNodes.push(sun);
      var pollen = P.particles(THREE, 54, 13, {
        color: 0xffcf78, size: 0.08, transparent: true, opacity: 0.62
      }, P.random('folk-amber-field'));
      pollen.name = 'amber-pollen';
      high.add(pollen);
      detailNodes.push(pollen);
      P.light(THREE, 'AmbientLight', 0x6b4028, 0.75, 0, root);
      var sunsetLight = P.light(THREE, 'DirectionalLight', 0xffa04d, 1.8, 0, root);
      sunsetLight.position.set(-4, 6, 3);
      var state = {
        layers: { low: low, mid: mid, high: high },
        detailNodes: detailNodes,
        coreMaterials: [wood, paper],
        accentMaterials: [amber],
        accent: new THREE.Color(0xef8f32),
        variant: 'acoustic',
        accentLight: sunsetLight,
        sunsetLight: sunsetLight,
        sustainedEnergy: 0,
        disposed: false
      };
      root.userData.genreWorldState = state;
      if (ctx.root && root.parent !== ctx.root) ctx.root.add(root);
      if (ctx.camera && ctx.camera.position) {
        ctx.camera.position.set(0, 6.5, 15.5);
        ctx.camera.fov = 50;
        if (typeof ctx.camera.lookAt === 'function') ctx.camera.lookAt(0, 1.8, -0.8);
        if (typeof ctx.camera.updateProjectionMatrix === 'function') ctx.camera.updateProjectionMatrix();
      }
      return root;
    },

    applyTrack: function (track, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState) return;
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0xef8f32);
      state.variant = track.visualVariant || 'acoustic';
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      if (state.accentLight && state.accentLight.color) state.accentLight.color.set(state.accent);
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.readFrame(frame);
      state.sustainedEnergy = P.smooth(state.sustainedEnergy, audio.energy * 0.7 + audio.mid * 0.3, 0.06);
      state.layers.low.scale.x = state.layers.low.scale.z = P.smooth(state.layers.low.scale.x, 1 + audio.bass * 0.16, 0.1);
      state.layers.low.scale.y = 1 + state.sustainedEnergy * 0.025;
      state.layers.mid.rotation.y += 0.0007 + audio.mid * 0.006;
      state.layers.mid.rotation.z = P.smooth(state.layers.mid.rotation.z, (audio.high - 0.5) * 0.035, 0.12);
      state.layers.high.position.y = P.smooth(state.layers.high.position.y, 0.45 + audio.high * 0.72, 0.1);
      state.layers.high.rotation.y += audio.mid * 0.002;
      state.sunsetLight.intensity = 1.2 + state.sustainedEnergy * 1.4 + audio.high * 0.35;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('constellation-script', frame, ctx);
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

  registerGenreWorld('folk', kit);
})();
