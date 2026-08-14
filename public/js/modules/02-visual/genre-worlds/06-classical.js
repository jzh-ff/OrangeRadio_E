/* OrangeSea · Classical world: gold spectral filaments + distant cover medallion. */
(function registerClassicalWorld() {
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
      var vis = P.visualizerRoot(THREE, ctx, 'classical-gold-score');
      var uniforms = P.audioUniforms(THREE, 0xe9d6ad, P.dummyCover(THREE));
      var detailNodes = [];

      var velvet = P.material(THREE, 'MeshBasicMaterial', { color: 0x38121c });
      var gold = P.material(THREE, 'MeshBasicMaterial', { color: 0xe9d6ad });
      var crystal = P.material(THREE, 'MeshBasicMaterial', { color: 0xfff4d8 });

      var hall = P.shaderPlane(THREE, vis.low, 'velvet-hall', [20, 12], uniforms, [
        fragHead(),
        'void main(){',
        '  vec2 p=vUv-0.5;',
        '  float r=length(p);',
        '  vec3 col=mix(vec3(0.04,0.02,0.04),uAccent*0.35,smoothstep(0.9,0.15,r)*0.45);',
        '  gl_FragColor=vec4(col,1.0);',
        '}'
      ].join('\n'), { renderOrder: -4 });
      hall.position.set(0, 0.8, -8);

      var score = P.shaderPlane(THREE, vis.mid, 'gold-filaments', [7.4, 4.6], uniforms, [
        fragHead(),
        'void main(){',
        '  vec3 col=vec3(0.0);',
        '  for(int i=0;i<8;i++){',
        '    float fi=float(i);',
        '    float cy=0.16+fi*0.09;',
        '    float amp=mix(uBass,uHigh,fi/7.0)*0.07+uEnergy*0.03;',
        '    float wave=sin(vUv.x*(16.0+fi*3.2)+uTime*(0.28+fi*0.03)+fi)*amp;',
        '    col+=uAccent*smoothstep(0.012,0.0,abs(vUv.y-cy-wave));',
        '  }',
        '  vec3 medal=sampleCover((vUv-0.5)*2.6+0.5);',
        '  float m=smoothstep(0.2,0.07,length(vUv-vec2(0.5,0.52)));',
        '  col=mix(col,medal*0.78,m*0.62);',
        '  float vign=smoothstep(0.95,0.35,length(vUv-0.5));',
        '  gl_FragColor=vec4(col,0.88*vign);',
        '}'
      ].join('\n'), { renderOrder: 2 });
      score.position.set(0, 0.55, 0.1);

      var medallion = P.shaderPlane(THREE, vis.mid, 'cover-medallion', [1.15, 1.15], uniforms, [
        fragHead(),
        'void main(){',
        '  vec2 p=vUv-0.5;',
        '  float r=length(p);',
        '  vec3 col=sampleCover(vUv);',
        '  float ring=smoothstep(0.02,0.0,abs(r-0.46));',
        '  col=mix(col,uAccent,ring);',
        '  gl_FragColor=vec4(col,smoothstep(0.5,0.42,r));',
        '}'
      ].join('\n'), { renderOrder: 3 });
      medallion.position.set(0, 0.62, 0.35);

      for (var d = 0; d < 5; d++) {
        var drop = P.shaderPlane(THREE, vis.high, 'chandelier-glint', [0.16, 0.16], uniforms, [
          fragHead(),
          'void main(){',
          '  float g=smoothstep(0.5,0.0,length(vUv-0.5));',
          '  gl_FragColor=vec4(mix(uAccent,vec3(1.0),0.4),(0.28+uHigh*0.35)*g);',
          '}'
        ].join('\n'), { blending: THREE.AdditiveBlending, renderOrder: 4 });
        drop.position.set((d - 2) * 0.55, 1.7, -1.2);
        drop.userData.detailIndex = d;
        drop.userData.detailMin = d / 10;
        detailNodes.push(drop);
      }

      var dust = P.particles(THREE, 70, 8, {
        color: 0xffe6b8, size: 0.07, transparent: true, opacity: 0.4,
        depthWrite: false, sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        map: P.glowTexture(THREE) || undefined
      }, P.random('opera-dust'));
      dust.name = 'hall-dust';
      vis.high.add(dust);
      detailNodes.push(score, medallion, dust);

      P.light(THREE, 'AmbientLight', 0x1a1214, 0.4, 0, vis.root);
      var hallLight = P.light(THREE, 'PointLight', 0xe9d6ad, 1.5, 14, vis.root);
      hallLight.position.set(0, 2.2, 1.4);
      var stageLight = P.light(THREE, 'PointLight', 0xffca6e, 0.7, 10, vis.root);
      stageLight.position.set(0, 0.4, 2.2);

      vis.root.userData.genreWorldState = {
        layers: { low: vis.low, mid: vis.mid, high: vis.high },
        detailNodes: detailNodes,
        coreMaterials: [velvet, gold, crystal],
        accentMaterials: [score.material, medallion.material],
        uniforms: uniforms,
        accent: new THREE.Color(0xe9d6ad),
        variant: 'symphonic',
        accentLight: hallLight,
        hallLight: hallLight,
        dynamics: 0,
        disposed: false
      };
      if (ctx.root && vis.root.parent !== ctx.root) ctx.root.add(vis.root);
      P.frameCamera(ctx.camera, { x: 0, y: 0.62, z: 6.8, lookY: 0.7, fov: 40 });
      P.bindCover(uniforms);
      return vis.root;
    },

    applyTrack: function (track, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState) return;
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0xe9d6ad);
      state.variant = track.visualVariant || 'symphonic';
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      if (state.accentLight && state.accentLight.color) state.accentLight.color.set(state.accent);
      P.writeAudio(state.uniforms, { bass: 0, mid: 0, high: 0, energy: 0, beat: 0 }, 0, state.accent);
      P.bindCover(state.uniforms);
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.tickVisualizer(state, frame, {
        bassScale: 0.08, bassSmooth: 0.12, midSpin: 0.004, midBase: 0.0004,
        highLift: 0.85, highBase: 0.35, highSmooth: 0.13
      });
      state.dynamics = P.smooth(state.dynamics, audio.energy * 0.7 + audio.mid * 0.3, 0.05);
      if (state.hallLight) state.hallLight.intensity = 1.4 + state.dynamics * 1.2 + audio.high * 0.25;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('spatial-score', frame, ctx);
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

  registerGenreWorld('classical', kit);
})();
