/* OrangeSea · Ambient world: slow displaced fog sea, no beat flash. */
(function registerAmbientWorld() {
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
      var vis = P.visualizerRoot(THREE, ctx, 'ambient-tidal-void');
      var uniforms = P.audioUniforms(THREE, 0x70d8cc, P.dummyCover(THREE));
      var detailNodes = [];

      var stone = P.material(THREE, 'MeshBasicMaterial', { color: 0x33404a });
      var fabric = P.material(THREE, 'MeshBasicMaterial', { color: 0x6d848c, transparent: true, opacity: 0.2 });
      var mistCore = P.material(THREE, 'MeshBasicMaterial', { color: 0x9fc4c8, transparent: true, opacity: 0.08 });

      var sky = P.shaderPlane(THREE, vis.low, 'tidal-sky', [24, 14], uniforms, [
        fragHead(),
        'void main(){',
        '  float h=vUv.y;',
        '  vec3 col=mix(vec3(0.02,0.05,0.06),uAccent,0.12+h*0.22);',
        '  gl_FragColor=vec4(col,1.0);',
        '}'
      ].join('\n'), { renderOrder: -5 });
      sky.position.set(0, 1.2, -10);

      var tideVert = [
        'uniform float uTime,uEnergy,uBass;',
        'varying vec2 vUv;',
        'void main(){',
        '  vUv=uv;',
        '  vec3 p=position;',
        '  p.z+=sin(p.x*0.38+uTime*0.32)* (0.16+uEnergy*0.42);',
        '  p.z+=sin(p.y*0.26+uTime*0.18)*0.1;',
        '  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);',
        '}'
      ].join('\n');

      var terrain = P.shaderPlane(THREE, vis.low, 'slow-terrain-wave', [18, 16], uniforms, [
        fragHead(),
        'void main(){',
        '  float n=noise21(vUv*4.0+uTime*0.05);',
        '  vec3 col=mix(vec3(0.03,0.07,0.08),uAccent,0.28+n*0.25+uEnergy*0.15);',
        '  float fade=smoothstep(1.0,0.2,vUv.y);',
        '  gl_FragColor=vec4(col,0.42*fade);',
        '}'
      ].join('\n'), {
        vertex: tideVert,
        blending: THREE.AdditiveBlending,
        renderOrder: 0,
        segX: 28,
        segY: 20
      });
      terrain.rotation.x = -Math.PI / 2;
      terrain.position.y = -0.85;

      for (var j = 0; j < 5; j++) {
        var mist = P.shaderPlane(THREE, vis.high, 'mist-sea-layer', [16 - j * 0.7, 2.6], uniforms, [
          fragHead(),
          'void main(){',
          '  float n=noise21(vUv*vec2(1.4,3.0)+vec2(uTime*0.03,0.0));',
          '  float a=(0.1+n*0.16+uEnergy*0.08)*smoothstep(0.0,0.35,vUv.y)*smoothstep(1.0,0.6,vUv.y);',
          '  gl_FragColor=vec4(uAccent*0.7,a);',
          '}'
        ].join('\n'), { renderOrder: 1 });
        mist.position.set(0, -0.2 + j * 0.08, -2.4 + j * 1.1);
        mist.userData.detailIndex = j;
        mist.userData.detailMin = j / 10;
        detailNodes.push(mist);
      }

      var veil = P.shaderPlane(THREE, vis.mid, 'horizon-cover-veil', [5.5, 2.8], uniforms, [
        fragHead(),
        'void main(){',
        '  vec3 cover=sampleCover(vUv*vec2(1.0,0.45)+vec2(0.0,0.3));',
        '  float h=smoothstep(0.15,0.7,vUv.y)*smoothstep(0.95,0.55,vUv.y);',
        '  vec3 col=mix(uAccent*0.45,cover,0.35+uMid*0.2);',
        '  gl_FragColor=vec4(col,h*(0.22+uEnergy*0.18));',
        '}'
      ].join('\n'), { renderOrder: 2 });
      veil.position.set(0, 0.55, -3.2);

      var motes = P.particles(THREE, 80, 12, {
        color: 0xbfe8e2, size: 0.08, transparent: true, opacity: 0.45,
        depthWrite: false, sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        map: P.glowTexture(THREE) || undefined
      }, P.random('tidal-motes'));
      motes.name = 'tidal-motes';
      vis.high.add(motes);
      detailNodes.push(terrain, veil, motes);

      P.light(THREE, 'AmbientLight', 0x0c2428, 0.45, 0, vis.root);
      var horizonLight = P.light(THREE, 'PointLight', 0x70d8cc, 1.1, 16, vis.root);
      horizonLight.position.set(0, 1.2, -4);
      var keyLight = P.light(THREE, 'PointLight', 0x718bbd, 0.5, 12, vis.root);
      keyLight.position.set(-2, 2.2, 2);

      vis.root.userData.genreWorldState = {
        layers: { low: vis.low, mid: vis.mid, high: vis.high },
        detailNodes: detailNodes,
        coreMaterials: [stone, fabric, mistCore],
        accentMaterials: [terrain.material, veil.material],
        uniforms: uniforms,
        accent: new THREE.Color(0x8ebdc2),
        variant: 'tidal',
        accentLight: horizonLight,
        horizonLight: horizonLight,
        tide: 0,
        disposed: false
      };
      if (ctx.root && vis.root.parent !== ctx.root) ctx.root.add(vis.root);
      P.frameCamera(ctx.camera, { x: 0, y: 2.35, z: 8.0, lookY: 0.22, lookZ: -2.8, fov: 50 });
      P.bindCover(uniforms);
      return vis.root;
    },

    applyTrack: function (track, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState) return;
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0x8ebdc2);
      state.variant = track.visualVariant || 'tidal';
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      if (state.accentLight && state.accentLight.color) state.accentLight.color.set(state.accent);
      P.writeAudio(state.uniforms, { bass: 0, mid: 0, high: 0, energy: 0, beat: 0 }, 0, state.accent);
      P.bindCover(state.uniforms);
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.tickVisualizer(state, frame, {
        bassScale: 0.07, bassSmooth: 0.05, midSpin: 0.0016, midBase: 0.00015,
        highLift: 0.4, highBase: 0.35, highSmooth: 0.045
      });
      var time = Number(frame && frame.time) || 0;
      state.tide = P.smooth(state.tide, audio.energy * 0.5 + audio.low * 0.25 + audio.mid * 0.25, 0.035);
      if (state.horizonLight) state.horizonLight.intensity = 0.9 + state.tide * 0.55 + audio.high * 0.12;
      state.layers.high.rotation.z = Math.sin(time * 0.045) * 0.015;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('horizon-dissolve', frame, ctx);
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

  registerGenreWorld('ambient', kit);
})();
