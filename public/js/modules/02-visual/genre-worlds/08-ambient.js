/* OrangeSea · Ambient world: tidal virtual horizon. */
(function registerAmbientWorld() {
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
      var root = P.group(THREE, 'ambient-tidal-void', ctx.root);
      var low = P.group(THREE, 'slow-terrain-tide', root);
      var mid = P.group(THREE, 'monolith-fabric-field', root);
      var high = P.group(THREE, 'mist-sea-horizon', root);
      var stone = P.material(THREE, 'MeshStandardMaterial', {
        color: 0x38434c, metalness: 0.08, roughness: 0.96
      });
      var fabric = P.material(THREE, 'MeshStandardMaterial', {
        color: 0x7d8c91, transparent: true, opacity: 0.48, metalness: 0.02, roughness: 0.9, side: THREE.DoubleSide
      });
      var terrainWire = P.material(THREE, 'MeshBasicMaterial', {
        color: 0x6f858b, transparent: true, opacity: 0.2,
        wireframe: true, depthWrite: false, side: THREE.DoubleSide
      });
      var mist = P.material(THREE, 'MeshBasicMaterial', {
        color: 0xa8c7ce, transparent: true, opacity: 0.13,
        depthWrite: false, side: THREE.DoubleSide
      });
      var terrain = mesh(THREE, 'PlaneGeometry', [18, 18, 16, 16], terrainWire, low, 'slow-terrain-wave');
      terrain.rotation.x = -Math.PI / 2;
      terrain.position.y = -0.55;
      var detailNodes = [];
      for (var i = 0; i < 7; i++) {
        var monolith = mesh(THREE, 'BoxGeometry', [0.75 + i % 2 * 0.4, 2.2 + i * 0.42, 0.8], stone, mid, 'tidal-monolith');
        monolith.position.set((i - 3) * 1.8, 0.6 + i * 0.2, -1.5 + i % 3 * 1.7);
        monolith.rotation.y = i * 0.29;
        detailNodes.push(monolith);
        var veil = mesh(THREE, 'PlaneGeometry', [1.5, 3 + i % 3], fabric, mid, 'floating-fabric-veil');
        veil.position.set(monolith.position.x + 0.7, 2.2, monolith.position.z - 0.35);
        veil.rotation.y = i * 0.35;
        detailNodes.push(veil);
      }
      for (var j = 0; j < 7; j++) {
        var mistLayer = mesh(THREE, 'PlaneGeometry', [14 - j * 0.7, 3.2], mist, high, 'mist-sea-layer');
        mistLayer.position.set(0, -0.18 + j * 0.07, -5.4 + j * 1.55);
        mistLayer.rotation.x = -Math.PI / 2 + (j - 3) * 0.01;
        mistLayer.userData.detailIndex = j;
        mistLayer.userData.detailMin = j / 7;
        detailNodes.push(mistLayer);
      }
      P.light(THREE, 'AmbientLight', 0x829aa2, 0.62, 0, root);
      var horizonLight = P.light(THREE, 'DirectionalLight', 0xc6e0dd, 1.15, 0, root);
      horizonLight.position.set(-3, 5, -4);
      var state = {
        layers: { low: low, mid: mid, high: high },
        detailNodes: detailNodes,
        coreMaterials: [stone, fabric, terrainWire, mist],
        accentMaterials: [],
        accent: new THREE.Color(0x8ebdc2),
        variant: 'tidal',
        accentLight: horizonLight,
        horizonLight: horizonLight,
        tide: 0,
        disposed: false
      };
      root.userData.genreWorldState = state;
      if (ctx.root && root.parent !== ctx.root) ctx.root.add(root);
      if (ctx.camera && ctx.camera.position) {
        ctx.camera.position.set(0, 6.2, 16.5);
        ctx.camera.fov = 52;
        if (typeof ctx.camera.lookAt === 'function') ctx.camera.lookAt(0, 1.8, -1.5);
        if (typeof ctx.camera.updateProjectionMatrix === 'function') ctx.camera.updateProjectionMatrix();
      }
      return root;
    },

    applyTrack: function (track, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState) return;
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0x8ebdc2);
      state.variant = track.visualVariant || 'tidal';
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      if (state.accentLight && state.accentLight.color) state.accentLight.color.set(state.accent);
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.readFrame(frame);
      var time = Number(frame && frame.time) || 0;
      state.tide = P.smooth(state.tide, audio.energy * 0.5 + audio.low * 0.25 + audio.mid * 0.25, 0.035);
      state.layers.low.scale.x = state.layers.low.scale.z = P.smooth(state.layers.low.scale.x, 1 + audio.bass * 0.08, 0.055);
      state.layers.low.scale.y = 1 + state.tide * 0.018;
      state.layers.low.position.y = Math.sin(time * 0.08) * 0.08;
      state.layers.mid.rotation.y += 0.00015 + audio.mid * 0.0018;
      state.layers.mid.position.y = P.smooth(state.layers.mid.position.y, state.tide * 0.28, 0.045);
      state.layers.high.position.y = P.smooth(state.layers.high.position.y, 0.5 + audio.high * 0.45, 0.045);
      state.layers.high.rotation.z = Math.sin(time * 0.045) * 0.018;
      state.horizonLight.intensity = 0.9 + state.tide * 0.65 + audio.high * 0.18;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('horizon-dissolve', frame, ctx);
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

  registerGenreWorld('ambient', kit);
})();
