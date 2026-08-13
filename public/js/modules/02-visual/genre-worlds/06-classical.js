/* OrangeSea · Classical world: endless opera house. */
(function registerClassicalWorld() {
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
      var root = P.group(THREE, 'classical-endless-opera', ctx.root);
      var low = P.group(THREE, 'black-gold-colonnade', root);
      var mid = P.group(THREE, 'floating-score-gallery', root);
      var high = P.group(THREE, 'sonic-architecture-vault', root);
      var black = P.material(THREE, 'MeshStandardMaterial', {
        color: 0x09090c, metalness: 0.72, roughness: 0.3
      });
      var gold = P.material(THREE, 'MeshStandardMaterial', {
        color: 0xc79b4b, emissive: 0x4b2d08, emissiveIntensity: 0.8, metalness: 0.86, roughness: 0.24
      });
      var score = P.material(THREE, 'MeshBasicMaterial', {
        color: 0xf4dfb0, transparent: true, opacity: 0.7, side: THREE.DoubleSide
      });
      var detailNodes = [];
      for (var side = -1; side <= 1; side += 2) {
        for (var i = 0; i < 7; i++) {
          var column = mesh(THREE, 'CylinderGeometry', [0.28, 0.34, 5.4, 12], black, low, 'black-gold-column');
          column.position.set(side * (3.2 + i * 0.5), 2.35, -4 + i * 1.35);
          var capital = mesh(THREE, 'BoxGeometry', [0.85, 0.18, 0.85], gold, low, 'gold-column-capital');
          capital.position.set(column.position.x, 5.05, column.position.z);
          detailNodes.push(capital);
        }
      }
      for (var j = 0; j < 10; j++) {
        var page = mesh(THREE, 'PlaneGeometry', [1.5, 0.72], score, mid, 'floating-score-page');
        page.position.set((j % 5 - 2) * 1.75, 1.8 + Math.floor(j / 5) * 1.3, -1.8 + j % 2 * 3.2);
        page.rotation.y = (j - 4.5) * 0.08;
        detailNodes.push(page);
      }
      for (var k = 0; k < 5; k++) {
        var arch = mesh(THREE, 'TorusGeometry', [3 + k * 0.65, 0.09, 10, 48], gold, high, 'sound-wave-arch');
        arch.position.y = 2.8 + k * 0.52;
        arch.rotation.x = Math.PI / 2;
        arch.rotation.z = (k - 2) * 0.08;
        detailNodes.push(arch);
      }
      P.light(THREE, 'AmbientLight', 0x241b18, 0.48, 0, root);
      var hallLight = P.light(THREE, 'PointLight', 0xd7ae66, 2, 20, root);
      hallLight.position.set(0, 5.5, 1);
      var state = {
        layers: { low: low, mid: mid, high: high },
        detailNodes: detailNodes,
        coreMaterials: [black, gold, score],
        accentMaterials: [],
        accent: new THREE.Color(0xc79b4b),
        variant: 'symphonic',
        accentLight: hallLight,
        hallLight: hallLight,
        dynamics: 0,
        disposed: false
      };
      root.userData.genreWorldState = state;
      if (ctx.root && root.parent !== ctx.root) ctx.root.add(root);
      if (ctx.camera && ctx.camera.position) {
        ctx.camera.position.set(0, 7.2, 17);
        ctx.camera.fov = 47;
        if (typeof ctx.camera.lookAt === 'function') ctx.camera.lookAt(0, 2.6, -0.5);
        if (typeof ctx.camera.updateProjectionMatrix === 'function') ctx.camera.updateProjectionMatrix();
      }
      return root;
    },

    applyTrack: function (track, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState) return;
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0xc79b4b);
      state.variant = track.visualVariant || 'symphonic';
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      if (state.accentLight && state.accentLight.color) state.accentLight.color.set(state.accent);
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.readFrame(frame);
      state.dynamics = P.smooth(state.dynamics, audio.energy * 0.55 + audio.mid * 0.45, 0.09);
      state.layers.low.scale.x = state.layers.low.scale.z = P.smooth(state.layers.low.scale.x, 1 + audio.bass * 0.1, 0.12);
      state.layers.low.scale.y = 1 + state.dynamics * 0.035;
      state.layers.mid.rotation.y += 0.0004 + audio.mid * 0.005;
      state.layers.mid.position.y = P.smooth(state.layers.mid.position.y, audio.mid * 0.42, 0.11);
      state.layers.high.position.y = P.smooth(state.layers.high.position.y, 0.5 + audio.high * 1.05, 0.13);
      state.layers.high.scale.x = state.layers.high.scale.z = 1 + state.dynamics * 0.07;
      state.hallLight.intensity = 1.3 + state.dynamics * 1.8 + audio.high * 0.45;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('spatial-score', frame, ctx);
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

  registerGenreWorld('classical', kit);
})();
