/* OrangeSea · Rock/metal world: rift forge. */
(function registerRockMetalWorld() {
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
      var root = P.group(THREE, 'rock-metal-rift-forge', ctx.root);
      var low = P.group(THREE, 'fractured-rock-platform', root);
      var mid = P.group(THREE, 'steel-truss-forge', root);
      var high = P.group(THREE, 'rift-ember-vault', root);
      var basalt = P.material(THREE, 'MeshStandardMaterial', {
        color: 0x171519, metalness: 0.28, roughness: 0.9
      });
      var steel = P.material(THREE, 'MeshStandardMaterial', {
        color: 0x606873, metalness: 0.94, roughness: 0.32
      });
      var rift = P.material(THREE, 'MeshStandardMaterial', {
        color: 0xff4b16, emissive: 0xff2200, emissiveIntensity: 2.1,
        metalness: 0.1, roughness: 0.42
      });
      var detailNodes = [];
      for (var i = 0; i < 11; i++) {
        var angle = i / 11 * Math.PI * 2;
        var slab = mesh(THREE, 'BoxGeometry', [3.2, 0.48, 2.1], basalt, low, 'broken-basalt-slab');
        slab.position.set(Math.cos(angle) * 3.3, (i % 3) * 0.08 - 0.35, Math.sin(angle) * 3.3);
        slab.rotation.y = -angle + (i % 2 ? 0.24 : -0.18);
        slab.rotation.z = (i % 3 - 1) * 0.055;
      }
      for (var j = 0; j < 5; j++) {
        var fissure = mesh(THREE, 'BoxGeometry', [0.14, 0.08, 4.8], rift, low, 'molten-fissure');
        fissure.position.set((j - 2) * 1.2, -0.04, 0);
        fissure.rotation.y = (j - 2) * 0.2;
        detailNodes.push(fissure);
      }
      for (var side = -1; side <= 1; side += 2) {
        for (var level = 0; level < 4; level++) {
          var post = mesh(THREE, 'BoxGeometry', [0.22, 5.8, 0.22], steel, mid, 'forge-steel-post');
          post.position.set(side * (3.5 + level * 0.38), 2.5, (level - 1.5) * 1.65);
          post.rotation.z = side * 0.08;
          var cross = mesh(THREE, 'BoxGeometry', [2.5, 0.16, 0.16], steel, mid, 'forge-cross-brace');
          cross.position.set(side * 3.4, 1 + level * 1.15, (level - 1.5) * 1.65);
          cross.rotation.z = side * (level % 2 ? 0.48 : -0.48);
          detailNodes.push(cross);
        }
      }
      var crown = mesh(THREE, 'TorusGeometry', [3.8, 0.18, 10, 40], steel, high, 'suspended-forge-crown');
      crown.rotation.x = Math.PI / 2;
      crown.position.y = 5.2;
      detailNodes.push(crown);
      var embers = P.particles(THREE, 86, 11, {
        color: 0xff531f, size: 0.09, transparent: true, opacity: 0.82,
        blending: THREE.AdditiveBlending
      }, P.random('rift-forge'));
      embers.name = 'forge-embers';
      high.add(embers);
      detailNodes.push(embers);
      P.light(THREE, 'AmbientLight', 0x1c2029, 0.5, 0, root);
      var forgeLight = P.light(THREE, 'PointLight', 0xff3515, 2.8, 18, root);
      forgeLight.position.set(0, 1.2, 0);
      var state = {
        layers: { low: low, mid: mid, high: high },
        detailNodes: detailNodes,
        accentMaterials: [rift],
        accent: new THREE.Color(0xff3515),
        variant: 'molten',
        forgeLight: forgeLight,
        disposed: false
      };
      root.userData.genreWorldState = state;
      if (ctx.root && root.parent !== ctx.root) ctx.root.add(root);
      if (ctx.camera && ctx.camera.position) {
        ctx.camera.position.set(0, 7.2, 15.5);
        ctx.camera.fov = 50;
        if (typeof ctx.camera.lookAt === 'function') ctx.camera.lookAt(0, 2.1, 0);
        if (typeof ctx.camera.updateProjectionMatrix === 'function') ctx.camera.updateProjectionMatrix();
      }
      return root;
    },

    applyTrack: function (track, ctx, root) {
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0xff3515);
      var genre = String(track.genre || '').toLowerCase();
      state.variant = track.visualVariant || (genre.indexOf('metal') >= 0 ? 'cold-steel' : 'molten');
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      state.layers.mid.rotation.z = state.variant === 'cold-steel' ? -0.025 : 0.025;
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.readFrame(frame);
      state.layers.low.scale.x = state.layers.low.scale.z = P.smooth(state.layers.low.scale.x, 1 + audio.bass * 0.24, 0.38);
      state.layers.low.scale.y = 1 + audio.beat * 0.035;
      state.layers.mid.rotation.y += 0.001 + audio.mid * 0.012;
      state.layers.high.position.y = P.smooth(state.layers.high.position.y, audio.high * 1.25, 0.28);
      state.layers.high.rotation.z = audio.energy * 0.045;
      state.forgeLight.intensity = 1.7 + audio.low * 2.3 + audio.beat * 2;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('fractured-stage', frame, ctx);
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

  registerGenreWorld('rock-metal', kit);
})();
