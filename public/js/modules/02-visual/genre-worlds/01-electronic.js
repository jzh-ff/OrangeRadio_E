/* OrangeSea · Electronic world: neon reactive city. */
(function registerElectronicWorld() {
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
      var root = P.group(THREE, 'electronic-neon-city', ctx.root);
      var low = P.group(THREE, 'energy-ring-foundation', root);
      var mid = P.group(THREE, 'black-chrome-city', root);
      var high = P.group(THREE, 'laser-grid-crown', root);
      var detail = P.group(THREE, 'city-detail', mid);
      var chrome = P.material(THREE, 'MeshStandardMaterial', {
        color: 0x080b12, metalness: 0.92, roughness: 0.22
      });
      var neon = P.material(THREE, 'MeshStandardMaterial', {
        color: 0x00d9ff, emissive: 0x00d9ff, emissiveIntensity: 1.6,
        metalness: 0.35, roughness: 0.28
      });
      var laser = P.material(THREE, 'MeshBasicMaterial', {
        color: 0xb43cff, transparent: true, opacity: 0.72
      });
      var floorGrid = P.material(THREE, 'MeshBasicMaterial', {
        color: 0xb43cff, transparent: true, opacity: 0.24,
        wireframe: true, depthWrite: false
      });
      var ring = mesh(THREE, 'TorusGeometry', [6.4, 0.16, 12, 64], neon, low, 'city-energy-ring');
      ring.rotation.x = Math.PI / 2;
      var floor = mesh(THREE, 'PlaneGeometry', [18, 18, 12, 12], floorGrid, low, 'neon-grid-floor');
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.35;
      var detailNodes = [];
      for (var i = 0; i < 18; i++) {
        var angle = i / 18 * Math.PI * 2;
        var radius = 2.1 + (i % 4) * 0.72;
        var height = 1.5 + (i % 6) * 0.62;
        var tower = mesh(THREE, 'BoxGeometry', [0.55, height, 0.55], chrome, mid, 'chrome-tower');
        tower.position.set(Math.cos(angle) * radius, height * 0.5, Math.sin(angle) * radius);
        if (i % 2 === 0) {
          var cap = mesh(THREE, 'BoxGeometry', [0.62, 0.08, 0.62], neon, detail, 'tower-neon-cap');
          cap.position.set(tower.position.x, height + 0.05, tower.position.z);
          detailNodes.push(cap);
        }
      }
      for (var j = 0; j < 6; j++) {
        var beam = mesh(THREE, 'BoxGeometry', [0.035, 5 + j * 0.35, 0.035], laser, high, 'vertical-laser');
        beam.position.set((j - 2.5) * 1.2, 3.2, (j % 2 ? -1 : 1) * 2.8);
        detailNodes.push(beam);
      }
      var sparkField = P.particles(THREE, 72, 14, {
        color: 0x7df9ff, size: 0.075, transparent: true, opacity: 0.78,
        blending: THREE.AdditiveBlending
      }, P.random('electronic-city'));
      sparkField.name = 'data-sparks';
      high.add(sparkField);
      detailNodes.push(sparkField);
      P.light(THREE, 'AmbientLight', 0x17203d, 0.45, 0, root);
      var pulseLight = P.light(THREE, 'PointLight', 0x00d9ff, 2.1, 18, root);
      pulseLight.position.set(0, 4.5, 0);
      var state = {
        layers: { low: low, mid: mid, high: high },
        detailNodes: detailNodes,
        accentMaterials: [neon, laser, floorGrid],
        accent: new THREE.Color(0x00d9ff),
        variant: 'cyan-grid',
        pulseLight: pulseLight,
        disposed: false
      };
      root.userData.genreWorldState = state;
      if (ctx.root && root.parent !== ctx.root) ctx.root.add(root);
      if (ctx.camera && ctx.camera.position) {
        ctx.camera.position.set(0, 6.8, 14);
        ctx.camera.fov = 48;
        if (typeof ctx.camera.lookAt === 'function') ctx.camera.lookAt(0, 2.2, 0);
        if (typeof ctx.camera.updateProjectionMatrix === 'function') ctx.camera.updateProjectionMatrix();
      }
      return root;
    },

    applyTrack: function (track, ctx, root) {
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0x00d9ff);
      state.variant = track.visualVariant || (String(track.genre || '').toLowerCase().indexOf('synth') >= 0
        ? 'ultraviolet' : 'cyan-grid');
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      state.layers.high.rotation.z = state.variant === 'ultraviolet' ? 0.12 : 0;
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.readFrame(frame);
      state.layers.low.scale.x = state.layers.low.scale.z = P.smooth(state.layers.low.scale.x, 1 + audio.bass * 0.34, 0.3);
      state.layers.low.scale.y = 1;
      state.layers.mid.rotation.y += 0.002 + audio.mid * 0.018;
      state.layers.high.position.y = P.smooth(state.layers.high.position.y, 0.3 + audio.high * 1.7, 0.24);
      state.layers.high.rotation.x = audio.energy * 0.035;
      state.pulseLight.intensity = 1.4 + audio.beat * 2.8 + audio.bass;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('hologram-signs', frame, ctx);
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

  registerGenreWorld('electronic', kit);
})();
