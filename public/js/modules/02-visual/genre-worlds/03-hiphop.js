/* OrangeSea · Hip-hop world: gold-bar sliced cover, low-angle punch. */
(function registerHiphopWorld() {
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
      var vis = P.visualizerRoot(THREE, ctx, 'hiphop-gold-bars');
      var uniforms = P.audioUniforms(THREE, 0xbf67ff, P.dummyCover(THREE));
      var detailNodes = [];

      var night = P.shaderPlane(THREE, vis.low, 'block-night', [22, 12], uniforms, [
        fragHead(),
        'void main(){',
        '  vec2 p=vUv-0.5;',
        '  vec3 col=mix(vec3(0.05,0.03,0.1),uAccent,0.12+0.18*(1.0-length(p)));',
        '  col=mix(col,vec3(1.0,0.82,0.28),smoothstep(0.82,0.55,vUv.y)*0.08);',
        '  gl_FragColor=vec4(col,1.0);',
        '}'
      ].join('\n'), { renderOrder: -4 });
      night.position.set(0, 0.8, -8);

      var hero = P.shaderPlane(THREE, vis.mid, 'gold-bar-cover', [4.2, 4.4], uniforms, [
        fragHead(),
        'void main(){',
        '  float bars=14.0;',
        '  float id=floor(vUv.y*bars);',
        '  float local=fract(vUv.y*bars);',
        '  float punch=sin(id*1.71+uTime*0.9)*0.5+0.5;',
        '  float offset=(hash11(id)-0.5)*0.14*uBeat+(punch*2.0-1.0)*0.045*uBass;',
        '  vec3 col=sampleCover(vec2(vUv.x+offset,(id+0.5)/bars));',
        '  float gap=smoothstep(0.07,0.16,local)*smoothstep(0.93,0.84,local);',
        '  col=mix(col,mix(uAccent,vec3(1.0,0.84,0.3),0.45),0.12);',
        '  gl_FragColor=vec4(col,gap);',
        '}'
      ].join('\n'), { renderOrder: 2 });
      hero.position.set(0, 0.25, 0.2);

      for (var i = 0; i < 5; i++) {
        var brick = P.shaderPlane(THREE, vis.high, 'hihat-spark-bar', [0.9, 0.08], uniforms, [
          fragHead(),
          'void main(){',
          '  float g=smoothstep(0.0,0.4,vUv.x)*smoothstep(1.0,0.6,vUv.x);',
          '  gl_FragColor=vec4(mix(uAccent,vec3(1.0,0.84,0.32),vUv.x),(0.2+uHigh*0.5)*g);',
          '}'
        ].join('\n'), { blending: THREE.AdditiveBlending, renderOrder: 3 });
        brick.position.set((i - 2) * 0.85, -1.15 + (i % 2) * 0.12, 1.1);
        brick.userData.detailIndex = i;
        brick.userData.detailMin = i / 10;
        detailNodes.push(brick);
      }

      var sparks = P.particles(THREE, 72, 8, {
        color: 0xffd64a, size: 0.09, transparent: true, opacity: 0.7,
        depthWrite: false, sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        map: P.glowTexture(THREE) || undefined
      }, P.random('block-sparks'));
      sparks.name = 'gold-sparks';
      vis.high.add(sparks);
      detailNodes.push(hero, sparks);

      P.light(THREE, 'AmbientLight', 0x1a1028, 0.45, 0, vis.root);
      var streetLight = P.light(THREE, 'PointLight', 0xffd64a, 1.4, 12, vis.root);
      streetLight.position.set(0, 1.4, 2.2);
      var moonLight = P.light(THREE, 'PointLight', 0xbf67ff, 0.7, 14, vis.root);
      moonLight.position.set(2.2, 2.8, -2);

      vis.root.userData.genreWorldState = {
        layers: { low: vis.low, mid: vis.mid, high: vis.high },
        detailNodes: detailNodes,
        accentMaterials: [hero.material, night.material],
        uniforms: uniforms,
        accent: new THREE.Color(0xbf67ff),
        variant: 'gold',
        streetLight: streetLight,
        disposed: false
      };
      if (ctx.root && vis.root.parent !== ctx.root) ctx.root.add(vis.root);
      P.frameCamera(ctx.camera, { x: 0, y: 1.02, z: 6.0, lookY: 0.18, fov: 44 });
      P.bindCover(uniforms);
      return vis.root;
    },

    applyTrack: function (track, ctx, root) {
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0xbf67ff);
      var genre = String(track.genre || '').toLowerCase();
      state.variant = track.visualVariant || (genre.indexOf('trap') >= 0 ? 'trap' : 'gold');
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      P.writeAudio(state.uniforms, { bass: 0, mid: 0, high: 0, energy: 0, beat: 0 }, 0, state.accent);
      P.bindCover(state.uniforms);
      state.layers.mid.rotation.z = state.variant === 'trap' ? 0.03 : 0;
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.tickVisualizer(state, frame, { bassScale: 0.16, midSpin: 0.01, highLift: 1.15, highBase: 0.15 });
      if (state.streetLight) state.streetLight.intensity = 1.2 + audio.beat * 1.8 + audio.bass * 0.5;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('architectural-type', frame, ctx);
    },

    setQuality: function (profile, ctx, root) {
      P.applyQualityBudget(root.userData.genreWorldState, profile, root);
    },

    dispose: function (root) {
      if (!root || !root.userData || root.userData.genreWorldState.disposed) return;
      root.userData.genreWorldState.disposed = true;
      P.dispose(root);
    }
  };

  registerGenreWorld('hiphop', kit);
})();
