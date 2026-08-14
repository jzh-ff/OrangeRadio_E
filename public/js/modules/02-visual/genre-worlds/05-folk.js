/* OrangeSea · Folk world: cover dissolving into amber dust constellations. */
(function registerFolkWorld() {
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
      var vis = P.visualizerRoot(THREE, ctx, 'folk-amber-dust');
      var uniforms = P.audioUniforms(THREE, 0xe8aa4c, P.dummyCover(THREE));
      var detailNodes = [];

      var soil = P.material(THREE, 'MeshBasicMaterial', { color: 0x241610 });
      var wood = P.material(THREE, 'MeshBasicMaterial', { color: 0x150d07 });
      var amber = P.material(THREE, 'MeshBasicMaterial', { color: 0xe8aa4c });

      var dusk = P.shaderPlane(THREE, vis.low, 'amber-dusk', [22, 12], uniforms, [
        fragHead(),
        'void main(){',
        '  float h=smoothstep(0.15,0.72,vUv.y);',
        '  vec3 col=mix(vec3(0.12,0.06,0.03),uAccent,0.18+h*0.55);',
        '  col=mix(col,vec3(0.08,0.04,0.03),smoothstep(0.55,0.95,vUv.y));',
        '  gl_FragColor=vec4(col,1.0);',
        '}'
      ].join('\n'), { renderOrder: -4 });
      dusk.position.set(0, 0.7, -8);

      var hero = P.shaderPlane(THREE, vis.mid, 'dissolving-cover', [4.0, 4.0], uniforms, [
        fragHead(),
        'void main(){',
        '  vec2 uv=vUv;',
        '  float n=noise21(uv*7.5+vec2(uTime*0.03,uTime*0.01));',
        '  float dissolve=smoothstep(0.12,0.88,n+uEnergy*0.22+uMid*0.1);',
        '  vec3 cover=sampleCover(uv);',
        '  vec3 dust=mix(uAccent,vec3(1.0,0.82,0.5),n);',
        '  vec3 col=mix(dust*0.38,cover,dissolve);',
        '  float edge=smoothstep(0.58,0.22,length(uv-0.5));',
        '  gl_FragColor=vec4(col,(0.32+dissolve*0.6)*edge);',
        '}'
      ].join('\n'), { renderOrder: 2 });
      hero.position.set(0, 0.35, 0.1);

      for (var i = 0; i < 6; i++) {
        var mote = P.shaderPlane(THREE, vis.high, 'constellation-mote', [0.22, 0.22], uniforms, [
          fragHead(),
          'void main(){',
          '  float g=smoothstep(0.5,0.0,length(vUv-0.5));',
          '  gl_FragColor=vec4(uAccent,(0.25+uHigh*0.4)*g);',
          '}'
        ].join('\n'), { blending: THREE.AdditiveBlending, renderOrder: 3 });
        var ang = i / 6 * Math.PI * 2;
        mote.position.set(Math.cos(ang) * 1.7, 0.9 + Math.sin(ang * 2) * 0.35, -1.1);
        mote.userData.detailIndex = i;
        mote.userData.detailMin = i / 12;
        detailNodes.push(mote);
      }

      var dust = P.particles(THREE, 100, 10, {
        color: 0xffd9a0, size: 0.1, transparent: true, opacity: 0.65,
        depthWrite: false, sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        map: P.glowTexture(THREE) || undefined
      }, P.random('amber-dust'));
      dust.name = 'amber-dust';
      vis.high.add(dust);
      detailNodes.push(hero, dust);

      P.light(THREE, 'AmbientLight', 0x3a2414, 0.5, 0, vis.root);
      var sunsetLight = P.light(THREE, 'PointLight', 0xe8aa4c, 1.6, 16, vis.root);
      sunsetLight.position.set(0, 1.6, -3);
      var warmFill = P.light(THREE, 'PointLight', 0xc76a20, 0.5, 12, vis.root);
      warmFill.position.set(0, 0.6, 2.4);

      vis.root.userData.genreWorldState = {
        layers: { low: vis.low, mid: vis.mid, high: vis.high },
        detailNodes: detailNodes,
        coreMaterials: [soil, wood, amber],
        accentMaterials: [hero.material, dusk.material],
        uniforms: uniforms,
        accent: new THREE.Color(0xef8f32),
        variant: 'acoustic',
        accentLight: sunsetLight,
        sunsetLight: sunsetLight,
        sustainedEnergy: 0,
        disposed: false
      };
      if (ctx.root && vis.root.parent !== ctx.root) ctx.root.add(vis.root);
      P.frameCamera(ctx.camera, { x: 0, y: 1.45, z: 7.0, lookY: 0.32, lookZ: -1.6, fov: 46 });
      P.bindCover(uniforms);
      return vis.root;
    },

    applyTrack: function (track, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState) return;
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0xef8f32);
      state.variant = track.visualVariant || 'acoustic';
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      if (state.accentLight && state.accentLight.color) state.accentLight.color.set(state.accent);
      P.writeAudio(state.uniforms, { bass: 0, mid: 0, high: 0, energy: 0, beat: 0 }, 0, state.accent);
      P.bindCover(state.uniforms);
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.tickVisualizer(state, frame, {
        bassScale: 0.1, bassSmooth: 0.1, midSpin: 0.006, midBase: 0.0007,
        highLift: 0.6, highBase: 0.35, highSmooth: 0.1
      });
      state.sustainedEnergy = P.smooth(state.sustainedEnergy, audio.energy * 0.7 + audio.mid * 0.3, 0.06);
      if (state.sunsetLight) state.sunsetLight.intensity = 1.2 + state.sustainedEnergy * 1.1 + audio.high * 0.3;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('constellation-script', frame, ctx);
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

  registerGenreWorld('folk', kit);
})();
