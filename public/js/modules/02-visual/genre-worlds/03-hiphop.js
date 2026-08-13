/* OrangeSea · Hip-hop world: midnight turntable block. */
(function registerHipHopWorld() {
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
      var root = P.group(THREE, 'hiphop-midnight-block', ctx.root);
      var low = P.group(THREE, 'turntable-street-deck', root);
      var mid = P.group(THREE, 'gold-skyline-block', root);
      var high = P.group(THREE, 'window-light-canopy', root);
      var asphalt = P.material(THREE, 'MeshStandardMaterial', {
        color: 0x0c0d13, metalness: 0.42, roughness: 0.74
      });
      var facade = P.material(THREE, 'MeshStandardMaterial', {
        color: 0x17141d, metalness: 0.5, roughness: 0.58
      });
      var gold = P.material(THREE, 'MeshStandardMaterial', {
        color: 0xd6a936, emissive: 0x6f4308, emissiveIntensity: 1.35,
        metalness: 0.72, roughness: 0.3
      });
      var windowLight = P.material(THREE, 'MeshBasicMaterial', {
        color: 0xffca58, transparent: true, opacity: 0.86
      });
      var deck = mesh(THREE, 'CylinderGeometry', [6.5, 6.8, 0.62, 48], asphalt, low, 'turntable-city-deck');
      deck.position.y = -0.3;
      var groove = mesh(THREE, 'TorusGeometry', [4.8, 0.07, 8, 64], gold, low, 'record-groove');
      groove.rotation.x = Math.PI / 2;
      groove.position.y = 0.04;
      var spindle = mesh(THREE, 'CylinderGeometry', [0.3, 0.3, 0.8, 20], gold, low, 'district-spindle');
      spindle.position.y = 0.25;
      var detailNodes = [];
      for (var i = 0; i < 16; i++) {
        var angle = i / 16 * Math.PI * 2;
        var radius = 2.3 + (i % 3) * 1.05;
        var width = 0.65 + (i % 2) * 0.3;
        var height = 1.6 + (i % 5) * 0.7;
        var building = mesh(THREE, 'BoxGeometry', [width, height, width], facade, mid, 'midnight-building');
        building.position.set(Math.cos(angle) * radius, height * 0.5, Math.sin(angle) * radius);
        building.rotation.y = -angle;
        for (var row = 0; row < 2; row++) {
          var windowNode = mesh(THREE, 'BoxGeometry', [width * 0.58, 0.1, 0.025], windowLight, high, 'gold-window-strip');
          windowNode.position.set(
            building.position.x,
            0.65 + row * 0.55 + (i % 3) * 0.2,
            building.position.z + (Math.sin(angle) >= 0 ? width * 0.52 : -width * 0.52)
          );
          detailNodes.push(windowNode);
        }
      }
      for (var j = 0; j < 5; j++) {
        var skyline = mesh(THREE, 'BoxGeometry', [0.12, 3.5 + j, 0.12], gold, high, 'gold-skyline-marker');
        skyline.position.set((j - 2) * 1.65, 2.4 + j * 0.35, -4.7);
        detailNodes.push(skyline);
      }
      var dust = P.particles(THREE, 58, 12, {
        color: 0xffd16b, size: 0.065, transparent: true, opacity: 0.58,
        blending: THREE.AdditiveBlending
      }, P.random('midnight-block'));
      dust.name = 'street-light-dust';
      high.add(dust);
      detailNodes.push(dust);
      P.light(THREE, 'AmbientLight', 0x171225, 0.62, 0, root);
      var streetLight = P.light(THREE, 'PointLight', 0xd6a936, 2.2, 16, root);
      streetLight.position.set(0, 5.5, 1);
      var state = {
        layers: { low: low, mid: mid, high: high },
        detailNodes: detailNodes,
        accentMaterials: [gold, windowLight],
        accent: new THREE.Color(0xd6a936),
        variant: 'gold',
        streetLight: streetLight,
        disposed: false
      };
      root.userData.genreWorldState = state;
      if (ctx.root && root.parent !== ctx.root) ctx.root.add(root);
      if (ctx.camera && ctx.camera.position) {
        ctx.camera.position.set(0, 7.8, 15);
        ctx.camera.fov = 50;
        if (typeof ctx.camera.lookAt === 'function') ctx.camera.lookAt(0, 2.3, 0);
        if (typeof ctx.camera.updateProjectionMatrix === 'function') ctx.camera.updateProjectionMatrix();
      }
      return root;
    },

    applyTrack: function (track, ctx, root) {
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0xd6a936);
      state.variant = track.visualVariant || 'gold';
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      state.layers.high.rotation.z = state.variant === 'gold' ? 0 : 0.04;
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.readFrame(frame);
      state.layers.low.scale.x = state.layers.low.scale.z = P.smooth(state.layers.low.scale.x, 1 + audio.bass * 0.2, 0.34);
      state.layers.low.rotation.y += 0.0015 + audio.low * 0.008;
      state.layers.mid.rotation.y += 0.001 + audio.mid * 0.015;
      state.layers.high.position.y = P.smooth(state.layers.high.position.y, 0.25 + audio.high * 1.1, 0.26);
      state.layers.high.scale.y = 1 + audio.energy * 0.08;
      state.streetLight.intensity = 1.5 + audio.beat * 2.2 + audio.mid;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('architectural-type', frame, ctx);
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

  registerGenreWorld('hiphop', kit);
})();
