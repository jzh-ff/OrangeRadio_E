/* OrangeSea · Jazz/soul world: noise smoke + additive spotlight cones, cover in the haze. */
(function registerJazzSoulWorld() {
  if (typeof registerGenreWorld !== 'function' || typeof GenreWorldPrimitives === 'undefined') return;
  var P = GenreWorldPrimitives;

  function fragHead() {
    var C = P.shaderChunks();
    return [
      'precision highp float;',
      'uniform float uTime,uBass,uMid,uHigh,uEnergy,uBeat,uHasCover;',
      'uniform vec3 uAccent;',
      'uniform sampler2D uCover;',
      'varying vec2 vUv;',
      C.hash, C.cover
    ].join('\n');
  }

  var kit = {
    create: function (ctx) {
      var THREE = ctx.THREE;
      var vis = P.visualizerRoot(THREE, ctx, 'jazz-blue-smoke');
      var uniforms = P.audioUniforms(THREE, 0x58b6d9, P.dummyCover(THREE));
      var detailNodes = [];

      var clubDark = P.material(THREE, 'MeshBasicMaterial', { color: 0x07131a });
      var brass = P.material(THREE, 'MeshBasicMaterial', { color: 0xd99b68 });
      var smokeCore = P.material(THREE, 'MeshBasicMaterial', { color: 0x2c4a5c, transparent: true, opacity: 0.01 });

      var room = P.shaderPlane(THREE, vis.low, 'club-room', [18, 12], uniforms, [
        fragHead(),
        'void main(){',
        '  vec2 p=vUv-0.5;',
        '  vec3 col=mix(vec3(0.02,0.04,0.06),uAccent,0.1+0.12*(1.0-length(p)));',
        '  gl_FragColor=vec4(col,1.0);',
        '}'
      ].join('\n'), { renderOrder: -4 });
      room.position.set(0, 0.6, -7);

      for (var s = 0; s < 4; s++) {
        var smoke = P.shaderPlane(THREE, vis.low, 'club-smoke', [11 - s * 0.6, 3.2], uniforms, [
          fragHead(),
          'void main(){',
          '  float n=noise21(vUv*vec2(1.7,3.4)+vec2(uTime*0.06,-uTime*0.04));',
          '  float n2=noise21(vUv*4.2-uTime*0.05);',
          '  float smoke=smoothstep(0.16,0.74,n*0.68+n2*0.32)*(0.2+uBass*0.28);',
          '  vec3 cover=sampleCover(vUv*0.72+0.14);',
          '  vec3 col=mix(uAccent*0.4,cover,0.16+uEnergy*0.18);',
          '  gl_FragColor=vec4(col,smoke);',
          '}'
        ].join('\n'), { renderOrder: 1 });
        smoke.position.set(0, 0.2 + s * 0.35, -0.6 - s * 0.55);
        smoke.userData.detailIndex = s;
        smoke.userData.detailMin = s / 8;
        detailNodes.push(smoke);
      }

      var cones = [];
      for (var c = 0; c < 2; c++) {
        var cone = P.shaderPlane(THREE, vis.mid, 'spotlight-volumetric-cone', [3.4, 6.2], uniforms, [
          fragHead(),
          'void main(){',
          '  vec2 p=vUv-vec2(0.5,1.0);',
          '  float ang=abs(p.x)/max(0.02,1.0-vUv.y);',
          '  float cone=smoothstep(0.3,0.0,ang)*pow(vUv.y,1.35);',
          '  cone*=0.16+uMid*0.24+uBeat*0.1;',
          '  vec3 col=mix(uAccent,vec3(0.85,0.62,0.38),vUv.x);',
          '  gl_FragColor=vec4(col*cone,cone);',
          '}'
        ].join('\n'), { blending: THREE.AdditiveBlending, renderOrder: 2 });
        cone.position.set(c ? 0.85 : -0.85, 1.1, -0.4);
        cone.rotation.z = c ? -0.18 : 0.18;
        cone.userData.detailIndex = c + 2;
        detailNodes.push(cone);
        cones.push(cone);
      }

      var ghost = P.shaderPlane(THREE, vis.mid, 'cover-in-smoke', [2.4, 2.4], uniforms, [
        fragHead(),
        'void main(){',
        '  vec3 col=sampleCover(vUv);',
        '  float a=(0.18+uEnergy*0.22)*smoothstep(0.55,0.18,length(vUv-0.5));',
        '  gl_FragColor=vec4(col,a);',
        '}'
      ].join('\n'), { renderOrder: 3 });
      ghost.position.set(0, 0.35, 0.4);

      var bulbs = P.particles(THREE, 64, 9, {
        color: 0xffd9a0, size: 0.08, transparent: true, opacity: 0.5,
        depthWrite: false, sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        map: P.glowTexture(THREE) || undefined
      }, P.random('club-bulbs'));
      bulbs.name = 'club-bulbs';
      vis.high.add(bulbs);
      detailNodes.push(ghost, bulbs);

      P.light(THREE, 'AmbientLight', 0x16242e, 0.4, 0, vis.root);
      var clubLight = P.light(THREE, 'PointLight', 0x58b6d9, 1.6, 12, vis.root);
      clubLight.position.set(0, 2.2, 1.6);
      var brassLight = P.light(THREE, 'PointLight', 0xd99b68, 0.8, 10, vis.root);
      brassLight.position.set(0, 0.8, 1.2);

      vis.root.userData.genreWorldState = {
        layers: { low: vis.low, mid: vis.mid, high: vis.high },
        detailNodes: detailNodes,
        coreMaterials: [clubDark, brass, smokeCore],
        accentMaterials: [ghost.material, cones[0].material],
        uniforms: uniforms,
        accent: new THREE.Color(0x58b6d9),
        variant: 'jazz',
        accentLight: clubLight,
        clubLight: clubLight,
        cones: cones,
        swing: 0,
        disposed: false
      };
      if (ctx.root && vis.root.parent !== ctx.root) ctx.root.add(vis.root);
      P.frameCamera(ctx.camera, { x: 0, y: 1.2, z: 5.1, lookY: 0.5, fov: 38 });
      P.bindCover(uniforms);
      return vis.root;
    },

    applyTrack: function (track, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState) return;
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0x58b6d9);
      var genre = String(track.genre || '').toLowerCase();
      state.variant = track.visualVariant || (genre.indexOf('soul') >= 0 ? 'soul' : 'jazz');
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      if (state.accentLight && state.accentLight.color) state.accentLight.color.set(state.accent);
      P.writeAudio(state.uniforms, { bass: 0, mid: 0, high: 0, energy: 0, beat: 0 }, 0, state.accent);
      P.bindCover(state.uniforms);
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.tickVisualizer(state, frame, {
        bassScale: 0.12, bassSmooth: 0.2, midSpin: 0.005, midBase: 0.0008,
        highLift: 0.7, highBase: 0.2, highSmooth: 0.15
      });
      var time = Number(frame && frame.time) || 0;
      state.swing = P.smooth(state.swing, audio.mid * 0.6 + audio.energy * 0.4, 0.08);
      if (state.clubLight) state.clubLight.intensity = 1.3 + audio.beat * 1.2 + state.swing * 0.7;
      for (var i = 0; i < state.cones.length; i++) {
        state.cones[i].rotation.z = (i ? -0.16 : 0.16) + Math.sin(time * (0.18 + i * 0.05) + i) * (0.08 + state.swing * 0.1);
      }
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('improvised-anchor', frame, ctx);
    },

    setQuality: function (profile, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState) return;
      P.applyQualityBudget(root.userData.genreWorldState, profile, root);
    },

    dispose: function (root) {
      if (!root || !root.userData || root.userData.genreWorldState.disposed) return;
      root.userData.genreWorldState.disposed = true;
      P.dispose(root);
    }
  };

  registerGenreWorld('jazz-soul', kit);
})();
