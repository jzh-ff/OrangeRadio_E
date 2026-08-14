/* OrangeSea · Rock/metal world: cracked cover plate + bass shockwaves. */
(function registerRockMetalWorld() {
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
      var vis = P.visualizerRoot(THREE, ctx, 'rock-metal-rift-core');
      var uniforms = P.audioUniforms(THREE, 0xff4b16, P.dummyCover(THREE));
      var detailNodes = [];

      var emberBed = P.shaderPlane(THREE, vis.low, 'forge-ember-bed', [14, 10], uniforms, [
        fragHead(),
        'void main(){',
        '  vec2 p=vUv-0.5;',
        '  float r=length(p);',
        '  float heat=smoothstep(0.72,0.08,r);',
        '  vec3 col=mix(vec3(0.05,0.02,0.02),uAccent,heat*(0.45+uBass*0.4));',
        '  gl_FragColor=vec4(col,0.92);',
        '}'
      ].join('\n'), { renderOrder: -3 });
      emberBed.rotation.x = -Math.PI / 2;
      emberBed.position.y = -1.05;

      var hero = P.shaderPlane(THREE, vis.mid, 'molten-cover-plate', [3.8, 3.8], uniforms, [
        fragHead(),
        'void main(){',
        '  vec2 uv=vUv;',
        '  vec2 p=uv-0.5;',
        '  float r=length(p);',
        '  float shock=abs(r-(0.1+uBeat*0.38+uBass*0.16));',
        '  float ring=smoothstep(0.055,0.0,shock);',
        '  float n=noise21(uv*16.0);',
        '  float fissure=smoothstep(0.4,0.66,n)*smoothstep(0.62,0.1,r);',
        '  vec3 col=sampleCover(uv+p*fissure*0.09);',
        '  col=mix(col,uAccent,fissure*0.55+ring*0.75);',
        '  col*=0.72+uEnergy*0.28;',
        '  gl_FragColor=vec4(col,1.0);',
        '}'
      ].join('\n'), { renderOrder: 2 });
      hero.position.y = 0.15;

      for (var s = 0; s < 3; s++) {
        var smoke = P.shaderPlane(THREE, vis.high, 'forge-smoke-layer', [9 - s, 2.4], uniforms, [
          fragHead(),
          'void main(){',
          '  float n=noise21(vUv*vec2(2.2,4.0)+vec2(uTime*0.04,-uTime*0.03));',
          '  float a=smoothstep(0.2,0.7,n)*(0.16+uMid*0.12);',
          '  gl_FragColor=vec4(vec3(0.12,0.05,0.03)*uAccent*2.0,a);',
          '}'
        ].join('\n'), { renderOrder: 1 });
        smoke.position.set((s - 1) * 1.4, 1.3 + s * 0.35, -2.2 - s * 0.6);
        smoke.userData.detailIndex = s;
        smoke.userData.detailMin = s / 6;
        detailNodes.push(smoke);
      }

      var embers = P.particles(THREE, 90, 8, {
        color: 0xff531f, size: 0.12, transparent: true, opacity: 0.82,
        depthWrite: false, sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        map: P.glowTexture(THREE) || undefined
      }, P.random('forge-embers'));
      embers.name = 'forge-embers';
      vis.high.add(embers);
      detailNodes.push(hero, embers);

      P.light(THREE, 'AmbientLight', 0x241a20, 0.4, 0, vis.root);
      var forgeLight = P.light(THREE, 'PointLight', 0xff3515, 2.1, 14, vis.root);
      forgeLight.position.set(0, 0.4, 2);
      var rimLight = P.light(THREE, 'PointLight', 0x51607a, 0.55, 12, vis.root);
      rimLight.position.set(-2.5, 2.4, 3);

      vis.root.userData.genreWorldState = {
        layers: { low: vis.low, mid: vis.mid, high: vis.high },
        detailNodes: detailNodes,
        accentMaterials: [hero.material, emberBed.material],
        uniforms: uniforms,
        accent: new THREE.Color(0xff3515),
        variant: 'molten',
        forgeLight: forgeLight,
        disposed: false
      };
      if (ctx.root && vis.root.parent !== ctx.root) ctx.root.add(vis.root);
      P.frameCamera(ctx.camera, { x: 0, y: 0.32, z: 5.5, lookY: 0.06, fov: 40 });
      P.bindCover(uniforms);
      return vis.root;
    },

    applyTrack: function (track, ctx, root) {
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0xff3515);
      var genre = String(track.genre || '').toLowerCase();
      state.variant = track.visualVariant || (genre.indexOf('metal') >= 0 ? 'cold-steel' : 'molten');
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      P.writeAudio(state.uniforms, { bass: 0, mid: 0, high: 0, energy: 0, beat: 0 }, 0, state.accent);
      P.bindCover(state.uniforms);
      state.layers.mid.rotation.z = state.variant === 'cold-steel' ? -0.025 : 0.025;
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.tickVisualizer(state, frame, { bassScale: 0.2, bassSmooth: 0.36, midSpin: 0.01, highLift: 1.1 });
      if (state.forgeLight) state.forgeLight.intensity = 1.4 + audio.low * 1.6 + audio.beat * 1.5;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('fractured-stage', frame, ctx);
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

  registerGenreWorld('rock-metal', kit);
})();
