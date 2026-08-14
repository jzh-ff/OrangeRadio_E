/* OrangeSea · Electronic world: neon grid + holographic cover slices. */
(function registerElectronicWorld() {
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
      var vis = P.visualizerRoot(THREE, ctx, 'electronic-neon-scan');
      var uniforms = P.audioUniforms(THREE, 0x00d9ff, P.dummyCover(THREE));
      var detailNodes = [];

      var sky = P.shaderPlane(THREE, vis.low, 'neon-void', [24, 14], uniforms, [
        fragHead(),
        'void main(){',
        '  vec2 p=vUv-0.5;',
        '  float r=length(p);',
        '  vec3 col=mix(vec3(0.01,0.02,0.06),uAccent,0.08+0.12*(1.0-r));',
        '  col+=uAccent*(0.06+uEnergy*0.1)/(r*3.0+0.2);',
        '  gl_FragColor=vec4(col,1.0);',
        '}'
      ].join('\n'), { renderOrder: -5 });
      sky.position.set(0, 1.1, -9);

      var floor = P.shaderPlane(THREE, vis.low, 'neon-grid-floor', [16, 22], uniforms, [
        fragHead(),
        'void main(){',
        '  vec2 gv=vUv*vec2(16.0,28.0);',
        '  vec2 f=abs(fract(gv)-0.5);',
        '  float line=1.0-smoothstep(0.0,0.07,min(f.x,f.y));',
        '  float scan=smoothstep(0.14,0.0,abs(fract(vUv.y*0.35+uTime*(0.1+uMid*0.28))-0.5));',
        '  vec3 col=uAccent*(line*(0.28+uBass*0.7)+scan*0.55);',
        '  float fade=smoothstep(1.0,0.12,vUv.y);',
        '  gl_FragColor=vec4(col,(line*0.9+scan*0.45)*fade);',
        '}'
      ].join('\n'), { blending: THREE.AdditiveBlending, renderOrder: 0 });
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -1.15;

      var hero = P.shaderPlane(THREE, vis.mid, 'hologram-cover', [3.4, 3.4], uniforms, [
        fragHead(),
        'void main(){',
        '  vec2 uv=vUv;',
        '  float slice=floor(uv.x*22.0);',
        '  uv.x+=(hash11(slice+floor(uTime*9.0))-0.5)*0.055*uHigh;',
        '  uv.y+=sin(uv.x*16.0+uTime*2.2)*0.014*uMid;',
        '  vec3 col=sampleCover(uv);',
        '  float scan=0.76+0.24*sin(uv.y*120.0+uTime*9.0);',
        '  col*=scan;',
        '  col=mix(col,uAccent,0.08+uBeat*0.22);',
        '  float alpha=smoothstep(0.02,0.1,vUv.x)*smoothstep(0.98,0.9,vUv.x);',
        '  gl_FragColor=vec4(col,alpha*(0.8+uEnergy*0.2));',
        '}'
      ].join('\n'), { renderOrder: 2 });
      hero.position.set(0, 0.55, 0.15);

      for (var b = 0; b < 3; b++) {
        var beam = P.shaderPlane(THREE, vis.high, 'vertical-laser', [0.07, 3.6 + b * 0.3], uniforms, [
          fragHead(),
          'void main(){',
          '  float g=smoothstep(0.0,0.35,vUv.y)*smoothstep(1.0,0.55,vUv.y);',
          '  gl_FragColor=vec4(uAccent,(0.22+uHigh*0.45+uBeat*0.2)*g);',
          '}'
        ].join('\n'), { blending: THREE.AdditiveBlending, renderOrder: 4 });
        beam.position.set((b - 1) * 1.25, 1.35, -1.8);
        beam.userData.detailIndex = b;
        beam.userData.detailMin = b / 7;
        detailNodes.push(beam);
      }

      var sparks = P.particles(THREE, 96, 11, {
        color: 0x7df9ff, size: 0.1, transparent: true, opacity: 0.78,
        depthWrite: false, sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        map: P.glowTexture(THREE) || undefined
      }, P.random('electronic-sparks'));
      sparks.name = 'data-sparks';
      vis.high.add(sparks);
      detailNodes.push(hero, floor, sparks);

      P.light(THREE, 'AmbientLight', 0x12233d, 0.45, 0, vis.root);
      var pulseLight = P.light(THREE, 'PointLight', 0x00d9ff, 1.5, 14, vis.root);
      pulseLight.position.set(0, 1.2, 2.4);
      var gateLight = P.light(THREE, 'PointLight', 0xb43cff, 0.8, 12, vis.root);
      gateLight.position.set(0, 2.2, -2);

      vis.root.userData.genreWorldState = {
        layers: { low: vis.low, mid: vis.mid, high: vis.high },
        detailNodes: detailNodes,
        accentMaterials: [hero.material, floor.material],
        uniforms: uniforms,
        accent: new THREE.Color(0x00d9ff),
        variant: 'cyan-grid',
        pulseLight: pulseLight,
        disposed: false
      };
      if (ctx.root && vis.root.parent !== ctx.root) ctx.root.add(vis.root);
      P.frameCamera(ctx.camera, { x: 0, y: 1.7, z: 6.2, lookY: 0.45, lookZ: -1.1, fov: 42 });
      P.bindCover(uniforms);
      return vis.root;
    },

    applyTrack: function (track, ctx, root) {
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0x00d9ff);
      state.variant = track.visualVariant || (String(track.genre || '').toLowerCase().indexOf('synth') >= 0
        ? 'ultraviolet' : 'cyan-grid');
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      P.writeAudio(state.uniforms, { bass: 0, mid: 0, high: 0, energy: 0, beat: 0 }, 0, state.accent);
      P.bindCover(state.uniforms);
      state.layers.high.rotation.z = state.variant === 'ultraviolet' ? 0.12 : 0;
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.tickVisualizer(state, frame, { bassScale: 0.18, midSpin: 0.011, highLift: 1.2, highBase: 0.15 });
      if (state.pulseLight) state.pulseLight.intensity = 1.1 + audio.beat * 1.8 + audio.bass * 0.6;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('hologram-signs', frame, ctx);
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

  registerGenreWorld('electronic', kit);
})();
