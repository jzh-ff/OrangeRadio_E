/* =========================================================================
   OrangeSea · Genre World lyrics surface (ES5, DOM-only).
   ========================================================================= */

var GENRE_WORLD_LYRIC_STYLE_PRESETS = {
  'hologram-signs': {
    fontFamily: '"Rajdhani", "Segoe UI", sans-serif', textAlign: 'right', maxWidth: '58rem',
    left: 'auto', right: 'max(5vw, env(safe-area-inset-right))', bottom: '16vh',
    letterSpacing: '0.12em', transform: 'skewY(-1deg)', textTransform: 'uppercase', fontWeight: '650'
  },
  'fractured-stage': {
    fontFamily: 'Impact, "Arial Narrow", sans-serif', textAlign: 'left', maxWidth: '64rem',
    left: 'max(5vw, env(safe-area-inset-left))', right: 'auto', bottom: '13vh',
    letterSpacing: '0.035em', transform: 'rotate(-1deg)', textTransform: 'uppercase', fontWeight: '800'
  },
  'architectural-type': {
    fontFamily: '"Arial Black", "Segoe UI", sans-serif', textAlign: 'left', maxWidth: '52rem',
    left: 'max(8vw, env(safe-area-inset-left))', right: 'auto', bottom: '19vh',
    letterSpacing: '0.08em', transform: 'translateX(0)', textTransform: 'uppercase', fontWeight: '750'
  },
  'dream-ribbons': {
    fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', textAlign: 'center', maxWidth: '70rem',
    left: '50%', right: 'auto', bottom: '14vh',
    letterSpacing: '0.025em', transform: 'translateX(-50%) rotate(.2deg)', textTransform: 'none', fontWeight: '600'
  },
  'constellation-script': {
    fontFamily: 'Georgia, "STKaiti", serif', textAlign: 'left', maxWidth: '48rem',
    left: 'max(7vw, env(safe-area-inset-left))', right: 'auto', bottom: '18vh',
    letterSpacing: '0.045em', transform: 'translateY(-.4rem)', textTransform: 'none', fontWeight: '500'
  },
  'spatial-score': {
    fontFamily: '"Times New Roman", "Songti SC", serif', textAlign: 'center', maxWidth: '62rem',
    left: '50%', right: 'auto', bottom: '22vh',
    letterSpacing: '0.075em', transform: 'translateX(-50%) scale(.98)', textTransform: 'none', fontWeight: '500'
  },
  'improvised-anchor': {
    fontFamily: '"Trebuchet MS", "Microsoft YaHei", sans-serif', textAlign: 'left', maxWidth: '44rem',
    left: 'max(10vw, env(safe-area-inset-left))', right: 'auto', bottom: '12vh',
    letterSpacing: '0.018em', transform: 'rotate(.35deg)', textTransform: 'none', fontWeight: '650'
  },
  'horizon-dissolve': {
    fontFamily: '"Segoe UI Light", "Microsoft YaHei UI", sans-serif', textAlign: 'center', maxWidth: '76rem',
    left: '50%', right: 'auto', bottom: '27vh',
    letterSpacing: '0.16em', transform: 'translateX(-50%) translateY(.5rem)', textTransform: 'none', fontWeight: '400'
  }
};

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
    try {
      reduced = !!motionWindow.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) {}
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

function ensureGenreWorldLyricSurface(ctx) {
  ctx = ctx || {};
  var doc = genreWorldLyricDocument(ctx);
  var surface = ctx.lyricElement || null;
  if (!surface && doc && typeof doc.getElementById === 'function') surface = doc.getElementById('genre-world-lyrics');
  if (!surface && doc && typeof doc.createElement === 'function') {
    surface = doc.createElement('div');
    genreWorldSetProperty(surface, 'id', 'genre-world-lyrics');
    if (doc.body && typeof doc.body.appendChild === 'function') doc.body.appendChild(surface);
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
  genreWorldSetStyle(main, 'fontFamily', preset.fontFamily);
  genreWorldSetStyle(main, 'fontWeight', preset.fontWeight);
  genreWorldSetStyle(main, 'lineHeight', '1.25');
  genreWorldSetStyle(main, 'textTransform', preset.textTransform);
  genreWorldSetStyle(translated, 'fontFamily', preset.fontFamily);
  genreWorldSetStyle(translated, 'marginTop', '0.35em');
  genreWorldSetStyle(translated, 'opacity', '0.78');
  genreWorldSetStyle(translated, 'fontSize', '0.72em');
}

function renderGenreWorldLyrics(style, frame, ctx) {
  var surface = ensureGenreWorldLyricSurface(ctx);
  if (!surface || !surface.children || surface.children.length < 2) return false;
  var normalized = normalizeGenreWorldLyricFrame(frame, ctx);
  var styleName = GENRE_WORLD_LYRIC_STYLE_PRESETS[style] ? style : 'dream-ribbons';
  var signature = [styleName, normalized.text, normalized.translation, normalized.seek, normalized.reducedMotion ? '1' : '0'].join('\u001f');
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
  var surface = ensureGenreWorldLyricSurface(ctx);
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
