/* =========================================================================
   OrangeSea · Genre World lyrics surface (ES5, DOM-only).
   ========================================================================= */

var GENRE_WORLD_LYRIC_STYLE_PRESETS = {
  'hologram-signs': {
    textAlign: 'right', maxWidth: '42rem',
    left: 'auto', right: 'max(4vw, env(safe-area-inset-right))', bottom: '11vh',
    letterSpacing: '0.12em', transform: 'skewY(-1deg)', textTransform: 'uppercase'
  },
  'fractured-stage': {
    textAlign: 'left', maxWidth: '46rem',
    left: 'max(4vw, env(safe-area-inset-left))', right: 'auto', bottom: '10vh',
    letterSpacing: '0.035em', transform: 'rotate(-1deg)', textTransform: 'uppercase'
  },
  'architectural-type': {
    textAlign: 'left', maxWidth: '40rem',
    left: 'max(5vw, env(safe-area-inset-left))', right: 'auto', bottom: '10vh',
    letterSpacing: '0.08em', transform: 'translateX(0)', textTransform: 'uppercase'
  },
  'dream-ribbons': {
    textAlign: 'center', maxWidth: '58rem',
    left: '50%', right: 'auto', bottom: '8vh',
    letterSpacing: '0.025em', transform: 'translateX(-50%) rotate(.2deg)', textTransform: 'none'
  },
  'constellation-script': {
    textAlign: 'left', maxWidth: '40rem',
    left: 'max(5vw, env(safe-area-inset-left))', right: 'auto', bottom: '12vh',
    letterSpacing: '0.045em', transform: 'translateY(-.4rem)', textTransform: 'none'
  },
  'spatial-score': {
    textAlign: 'center', maxWidth: '54rem',
    left: '50%', right: 'auto', bottom: '9vh',
    letterSpacing: '0.075em', transform: 'translateX(-50%) scale(.98)', textTransform: 'none'
  },
  'improvised-anchor': {
    textAlign: 'left', maxWidth: '38rem',
    left: 'max(6vw, env(safe-area-inset-left))', right: 'auto', bottom: '9vh',
    letterSpacing: '0.018em', transform: 'rotate(.35deg)', textTransform: 'none'
  },
  'horizon-dissolve': {
    textAlign: 'center', maxWidth: '62rem',
    left: '50%', right: 'auto', bottom: '32vh',
    letterSpacing: '0.16em', transform: 'translateX(-50%) translateY(.5rem)', textTransform: 'none'
  }
};

var GENRE_WORLD_LYRIC_FONT_FALLBACK = 'Inter,"Noto Sans SC","PingFang SC","Microsoft YaHei",Arial,sans-serif';

function genreWorldLyricFontKey() {
  if (typeof fx !== 'undefined' && fx && fx.lyricFont) return String(fx.lyricFont);
  return 'sans';
}

function genreWorldLyricFontFamily() {
  if (typeof lyricFontStackForKey === 'function') return lyricFontStackForKey(genreWorldLyricFontKey());
  return GENRE_WORLD_LYRIC_FONT_FALLBACK;
}

function genreWorldLyricFontWeight() {
  if (typeof lyricFontWeightValue === 'function') return String(lyricFontWeightValue());
  return '600';
}

function genreWorldSetProperty(target, property, value) {
  if (target && target[property] !== value) target[property] = value;
}

function genreWorldSetStyle(target, property, value) {
  if (target && target.style && target.style[property] !== value) target.style[property] = value;
}

function genreWorldAttributeValue(target, name) {
  if (!target) return null;
  if (typeof target.getAttribute === 'function') return target.getAttribute(name);
  return target.attributes && target.attributes[name] != null ? target.attributes[name] : null;
}

function genreWorldSetAttribute(target, name, value) {
  value = String(value);
  if (target && genreWorldAttributeValue(target, name) !== value && typeof target.setAttribute === 'function') {
    target.setAttribute(name, value);
  }
}

function genreWorldSetDataset(target, name, value) {
  value = String(value);
  if (target && target.dataset && target.dataset[name] !== value) target.dataset[name] = value;
}

/* reduced-motion 结果缓存：系统设置几乎不变，避免每帧 matchMedia 强制样式引擎评估 */
var genreWorldReducedMotionCache = null;

function genreWorldReducedMotionFromWindow(motionWindow) {
  if (genreWorldReducedMotionCache !== null) return genreWorldReducedMotionCache;
  try {
    genreWorldReducedMotionCache = !!motionWindow.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    genreWorldReducedMotionCache = false;
  }
  return genreWorldReducedMotionCache;
}

function normalizeGenreWorldLyricFrame(frame, ctx) {
  frame = frame || {};
  ctx = ctx || {};
  var payload = frame.lyrics != null ? frame.lyrics : frame;
  if (typeof payload === 'string' || typeof payload === 'number') payload = { text: String(payload) };
  payload = payload || {};
  var text = payload.text;
  if (text == null) text = payload.main;
  if (text == null) text = payload.original;
  if (text == null) text = payload.lyric;
  var translation = payload.translation;
  if (translation == null) translation = payload.translated;
  if (translation == null) translation = payload.translationText;
  if (translation == null) translation = payload.tlyric;
  var seek = payload.seekId;
  if (seek == null) seek = payload.seek;
  if (seek == null) seek = frame.seekId;
  var reduced = ctx.reducedMotion === true || payload.reducedMotion === true;
  var motionWindow = ctx.window || (typeof window !== 'undefined' ? window : null);
  if (!reduced && motionWindow && typeof motionWindow.matchMedia === 'function') {
    reduced = genreWorldReducedMotionFromWindow(motionWindow);
  }
  return {
    text: text == null ? '' : String(text),
    translation: translation == null ? '' : String(translation),
    seek: seek == null ? '' : String(seek),
    reducedMotion: reduced
  };
}

function genreWorldLyricDocument(ctx) {
  if (ctx && ctx.document) return ctx.document;
  return typeof document !== 'undefined' ? document : null;
}

/* 歌词 surface 元素缓存：节点常驻 DOM，避免每帧 getElementById */
var genreWorldLyricSurfaceCached = null;

function ensureGenreWorldLyricSurface(ctx) {
  ctx = ctx || {};
  var doc = genreWorldLyricDocument(ctx);
  var surface = ctx.lyricElement || null;
  if (!surface && genreWorldLyricSurfaceCached && genreWorldLyricSurfaceCached.isConnected) {
    surface = genreWorldLyricSurfaceCached;
  }
  if (!surface && doc && typeof doc.getElementById === 'function') {
    surface = doc.getElementById('genre-world-lyrics');
    genreWorldLyricSurfaceCached = surface;
  }
  if (!surface && doc && typeof doc.createElement === 'function') {
    surface = doc.createElement('div');
    genreWorldSetProperty(surface, 'id', 'genre-world-lyrics');
    if (doc.body && typeof doc.body.appendChild === 'function') doc.body.appendChild(surface);
    genreWorldLyricSurfaceCached = surface;
  }
  if (!surface) return null;
  if (!surface.id) genreWorldSetProperty(surface, 'id', 'genre-world-lyrics');
  if (!surface.className) genreWorldSetProperty(surface, 'className', 'genre-world-lyrics');
  genreWorldSetAttribute(surface, 'role', 'status');
  genreWorldSetAttribute(surface, 'aria-live', 'polite');
  genreWorldSetAttribute(surface, 'aria-atomic', 'true');
  genreWorldSetStyle(surface, 'position', 'fixed');
  genreWorldSetStyle(surface, 'zIndex', '18');
  genreWorldSetStyle(surface, 'pointerEvents', 'none');
  genreWorldSetStyle(surface, 'color', '#ffffff');
  genreWorldSetStyle(surface, 'textShadow', '0 2px 14px rgba(0,0,0,.92)');
  genreWorldSetStyle(surface, 'contain', 'layout style');
  if (!surface.children || surface.children.length < 2) {
    if (!doc || typeof doc.createElement !== 'function') return surface;
    while (surface.children && surface.children.length && typeof surface.removeChild === 'function') {
      surface.removeChild(surface.children[0]);
    }
    var main = doc.createElement('div');
    genreWorldSetProperty(main, 'className', 'genre-world-lyrics__main');
    var translated = doc.createElement('div');
    genreWorldSetProperty(translated, 'className', 'genre-world-lyrics__translation');
    genreWorldSetAttribute(translated, 'aria-hidden', 'true');
    surface.appendChild(main);
    surface.appendChild(translated);
  }
  var mainLine = surface.children[0];
  if (genreWorldAttributeValue(mainLine, 'aria-live') != null && typeof mainLine.removeAttribute === 'function') {
    mainLine.removeAttribute('aria-live');
  }
  return surface;
}

function genreWorldApplyLyricPreset(surface, styleName) {
  var preset = GENRE_WORLD_LYRIC_STYLE_PRESETS[styleName] || GENRE_WORLD_LYRIC_STYLE_PRESETS['dream-ribbons'];
  var main = surface.children[0];
  var translated = surface.children[1];
  genreWorldSetProperty(surface, 'className', 'genre-world-lyrics genre-world-lyrics--' + styleName);
  genreWorldSetDataset(surface, 'style', styleName);
  genreWorldSetDataset(surface, 'preset', styleName);
  genreWorldSetStyle(surface, 'textAlign', preset.textAlign);
  genreWorldSetStyle(surface, 'maxWidth', preset.maxWidth);
  genreWorldSetStyle(surface, 'left', preset.left);
  genreWorldSetStyle(surface, 'right', preset.right);
  genreWorldSetStyle(surface, 'bottom', preset.bottom);
  genreWorldSetStyle(surface, 'letterSpacing', preset.letterSpacing);
  genreWorldSetStyle(surface, 'transform', preset.transform);
  genreWorldSetStyle(main, 'fontFamily', genreWorldLyricFontFamily());
  genreWorldSetStyle(main, 'fontWeight', genreWorldLyricFontWeight());
  genreWorldSetStyle(main, 'lineHeight', '1.25');
  genreWorldSetStyle(main, 'textTransform', preset.textTransform);
  genreWorldSetStyle(translated, 'fontFamily', genreWorldLyricFontFamily());
  genreWorldSetStyle(translated, 'marginTop', '0.35em');
  genreWorldSetStyle(translated, 'opacity', '0.78');
  genreWorldSetStyle(translated, 'fontSize', '0.72em');
}

function renderGenreWorldLyrics(style, frame, ctx) {
  var surface = ensureGenreWorldLyricSurface(ctx);
  if (!surface || !surface.children || surface.children.length < 2) return false;
  var normalized = normalizeGenreWorldLyricFrame(frame, ctx);
  var styleName = GENRE_WORLD_LYRIC_STYLE_PRESETS[style] ? style : 'dream-ribbons';
  var signature = [
    styleName,
    genreWorldLyricFontKey(),
    genreWorldLyricFontFamily(),
    genreWorldLyricFontWeight(),
    normalized.text,
    normalized.translation,
    normalized.seek,
    normalized.reducedMotion ? '1' : '0'
  ].join('\u001f');
  if (surface.__genreWorldLyricSignature === signature) return true;
  var main = surface.children[0];
  var translated = surface.children[1];
  genreWorldApplyLyricPreset(surface, styleName);
  genreWorldSetProperty(main, 'textContent', normalized.text);
  genreWorldSetProperty(translated, 'textContent', normalized.translation);
  genreWorldSetStyle(translated, 'display', normalized.translation ? '' : 'none');
  genreWorldSetAttribute(translated, 'aria-hidden', normalized.translation ? 'false' : 'true');
  genreWorldSetDataset(surface, 'seek', normalized.seek);
  genreWorldSetDataset(surface, 'motion', normalized.reducedMotion ? 'reduced' : 'full');
  genreWorldSetDataset(surface, 'empty', normalized.text || normalized.translation ? 'false' : 'true');
  genreWorldSetStyle(surface, 'opacity', normalized.text || normalized.translation ? '1' : '0');
  genreWorldSetStyle(surface, 'transition', normalized.reducedMotion ? 'none' : 'opacity 180ms ease, transform 240ms ease');
  surface.__genreWorldLyricSignature = signature;
  return true;
}

function clearGenreWorldLyrics(ctx) {
  /* 沿用 ctx.document 查找路径（与 ensureGenreWorldLyricSurface 一致），
     但绝不创建节点——不存在时直接返回，避免退出 genre 时留下常驻空 div */
  ctx = ctx || {};
  var doc = genreWorldLyricDocument(ctx);
  var surface = ctx.lyricElement || null;
  if (!surface && genreWorldLyricSurfaceCached && genreWorldLyricSurfaceCached.isConnected) {
    surface = genreWorldLyricSurfaceCached;
  }
  if (!surface && doc && typeof doc.getElementById === 'function') {
    surface = doc.getElementById('genre-world-lyrics');
  }
  if (!surface || !surface.children || surface.children.length < 2) return false;
  if (surface.__genreWorldLyricSignature === '__clear__') return true;
  genreWorldSetProperty(surface.children[0], 'textContent', '');
  genreWorldSetProperty(surface.children[1], 'textContent', '');
  genreWorldSetStyle(surface.children[1], 'display', 'none');
  genreWorldSetAttribute(surface.children[1], 'aria-hidden', 'true');
  genreWorldSetDataset(surface, 'empty', 'true');
  genreWorldSetStyle(surface, 'opacity', '0');
  surface.__genreWorldLyricSignature = '__clear__';
  return true;
}
