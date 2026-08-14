/* OrangeSea · Prism world: kaleidoscope cover refraction (pop/anime/default).
   签名：封面六折万花筒 + 糖果色缎带底板，低频推近、中频扭转折数节奏。 */
(function registerPrismWorld() {
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
      var vis = P.visualizerRoot(THREE, ctx, 'prism-kaleidoscope');
      var uniforms = P.audioUniforms(THREE, 0xff72cb, P.dummyCover(THREE));
      var detailNodes = [];

      var atmosphere = P.shaderPlane(THREE, vis.low, 'prism-candy-sky', [22, 14], uniforms, [
        fragHead(),
        'void main(){',
        '  vec2 p=vUv-0.5;',
        '  float r=length(p);',
        '  float a=atan(p.y,p.x);',
        '  float ribbon=smoothstep(0.045,0.0,abs(sin(a*3.0+uTime*0.32)*0.40-r));',
        '  ribbon+=0.55*smoothstep(0.05,0.0,abs(sin(a*5.0-uTime*0.18)*0.62-r));',
        '  vec3 candy=mix(vec3(0.06,0.03,0.13),uAccent,0.42+0.22*sin(a*2.0+uTime*0.4));',
        '  vec3 aqua=vec3(0.44,0.86,1.0);',
        '  vec3 col=mix(candy,aqua,ribbon*0.72);',
        '  col+=uAccent*(0.10+uEnergy*0.22)/(r*2.6+0.16);',
        '  col+=vec3(1.0,0.72,0.94)*uHigh*0.08*smoothstep(0.9,0.2,r);',
        '  gl_FragColor=vec4(col,1.0);',
        '}'
      ].join('\n'), { renderOrder: -4 });
      atmosphere.position.set(0, 0.4, -8);

      var hero = P.shaderPlane(THREE, vis.mid, 'prism-kaleido-cover', [4.6, 4.6], uniforms, [
        fragHead(),
        'void main(){',
        '  vec2 uv=vUv-0.5;',
        '  float folds=6.0;',
        '  float angle=atan(uv.y,uv.x)+uTime*(0.07+uMid*0.14);',
        '  float r=length(uv)*(1.08-uBass*0.2);',
        '  float sector=6.2831853/folds;',
        '  float a=mod(angle,sector);',
        '  a=abs(a-sector*0.5);',
        '  vec2 kuv=vec2(cos(a),sin(a))*r;',
        '  vec3 col=sampleCover(kuv*(0.9+uEnergy*0.1)+0.5);',
        '  float glow=smoothstep(0.74,0.16,r);',
        '  col=mix(col,mix(uAccent,vec3(1.0),0.35),0.1+uBeat*0.2);',
        '  col*=0.52+glow*0.78;',
        '  float edge=smoothstep(0.62,0.28,r);',
        '  gl_FragColor=vec4(col,edge);',
        '}'
      ].join('\n'), { renderOrder: 2 });
      hero.position.z = 0.2;

      for (var i = 0; i < 4; i++) {
        var shard = P.shaderPlane(THREE, vis.high, 'prism-light-shard', [1.1 + i * 0.15, 0.18], uniforms, [
          fragHead(),
          'void main(){',
          '  float g=smoothstep(0.0,0.45,vUv.x)*smoothstep(1.0,0.55,vUv.x);',
          '  vec3 col=mix(uAccent,vec3(0.45,0.9,1.0),vUv.x);',
          '  gl_FragColor=vec4(col,(0.18+uHigh*0.35)*g);',
          '}'
        ].join('\n'), {
          blending: THREE.AdditiveBlending,
          renderOrder: 3
        });
        shard.position.set((i - 1.5) * 1.15, 1.55 - i * 0.12, -1.4);
        shard.rotation.z = (i - 1.5) * 0.18;
        shard.userData.detailIndex = i;
        shard.userData.detailMin = i / 8;
        detailNodes.push(shard);
      }

      var motes = P.particles(THREE, 110, 9, {
        color: 0xffdcff, size: 0.11, transparent: true, opacity: 0.7,
        depthWrite: false, sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
        map: P.glowTexture(THREE) || undefined
      }, P.random('prism-motes'));
      motes.name = 'dream-motes';
      vis.high.add(motes);
      detailNodes.push(hero, motes);

      P.light(THREE, 'AmbientLight', 0x4a3070, 0.7, 0, vis.root);
      var coreLight = P.light(THREE, 'PointLight', 0xff72cb, 1.8, 16, vis.root);
      coreLight.position.set(0, 0.4, 2.2);
      var fillLight = P.light(THREE, 'PointLight', 0x72e8ff, 0.7, 14, vis.root);
      fillLight.position.set(-2.4, 1.8, 3);

      vis.root.userData.genreWorldState = {
        layers: { low: vis.low, mid: vis.mid, high: vis.high },
        detailNodes: detailNodes,
        accentMaterials: [hero.material, atmosphere.material],
        uniforms: uniforms,
        accent: new THREE.Color(0xff72cb),
        variant: 'default',
        coreLight: coreLight,
        disposed: false
      };
      if (ctx.root && vis.root.parent !== ctx.root) ctx.root.add(vis.root);
      P.frameCamera(ctx.camera, { x: 0, y: 0.12, z: 5.6, lookY: 0.04, fov: 36 });
      P.bindCover(uniforms);
      return vis.root;
    },

    applyTrack: function (track, ctx, root) {
      var state = root.userData.genreWorldState;
      state.accent = P.accentColor(ctx.THREE, track, ctx, 0xff72cb);
      var genre = String(track.genre || track.family || '').toLowerCase();
      state.variant = track.visualVariant || (genre.indexOf('anime') >= 0
        ? 'anime' : (genre.indexOf('pop') >= 0 ? 'pop' : 'default'));
      for (var i = 0; i < state.accentMaterials.length; i++) P.setAccent(state.accentMaterials[i], state.accent);
      P.writeAudio(state.uniforms, { bass: 0, mid: 0, high: 0, energy: 0, beat: 0 }, 0, state.accent);
      P.bindCover(state.uniforms);
      state.layers.low.rotation.z = state.variant === 'anime' ? 0.08 : (state.variant === 'pop' ? -0.04 : 0);
    },

    update: function (frame, ctx, root) {
      if (!root || !root.userData || !root.userData.genreWorldState || root.userData.genreWorldState.disposed) return;
      var state = root.userData.genreWorldState;
      var audio = P.tickVisualizer(state, frame, { bassScale: 0.14, midSpin: 0.012, highLift: 1.05, highBase: 0.2 });
      if (state.coreLight) state.coreLight.intensity = 1.3 + audio.beat * 1.6 + audio.high * 0.5;
    },

    renderLyrics: function (frame, ctx) {
      if (typeof renderGenreWorldLyrics !== 'function') return false;
      return renderGenreWorldLyrics('dream-ribbons', frame, ctx);
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

  registerGenreWorld('prism', kit);
})();
