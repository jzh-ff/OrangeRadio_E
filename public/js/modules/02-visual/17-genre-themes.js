/* =========================================================================
   OrangeSea · 风格族群主题表（Genre Themes）
   12 个视觉族群 × 一套完整主题：配色 / 光晕 / 字体气质 / 装饰层。
   通过 CSS 变量下发到 #genre-overlay（--gm-*），stylesheet 里定义
   transition，切歌时主题 ~1.2s 平滑过渡。

   主题字段：
     accent/accent2  主/次强调色（徽章、频谱、进度、装饰）
     bg1/bg2/bg3     背景三段渐变（暗色底，保证文字可读）
     ink/muted       主文字 / 次要文字
     glow            光晕色（rgba，封面光晕 + 角落漏光）
     font            字体气质：'sans' | 'serif' | 'mono'
     deco            装饰层：'grid' | 'staff' | 'paper' | 'noise' | 'bokeh' | 'mist' | 'none'
   ========================================================================= */

var GENRE_THEMES = {
  electronic: {
    accent: '#c26bff', accent2: '#ff5ea8',
    bg1: '#150a22', bg2: '#0d0616', bg3: '#08040f',
    ink: '#f2eafe', muted: 'rgba(226, 203, 255, 0.46)',
    glow: 'rgba(178, 92, 255, 0.20)', font: 'mono', deco: 'grid'
  },
  hiphop: {
    accent: '#f5c542', accent2: '#ff8c42',
    bg1: '#171208', bg2: '#0f0b05', bg3: '#0a0703',
    ink: '#faf1dc', muted: 'rgba(250, 236, 200, 0.44)',
    glow: 'rgba(245, 197, 66, 0.16)', font: 'sans', deco: 'noise'
  },
  rock: {
    accent: '#ff4d4d', accent2: '#ff9a3c',
    bg1: '#1a0c0c', bg2: '#100707', bg3: '#0a0404',
    ink: '#f8e9e2', muted: 'rgba(248, 220, 205, 0.44)',
    glow: 'rgba(255, 77, 77, 0.16)', font: 'sans', deco: 'noise'
  },
  metal: {
    accent: '#b8c4d0', accent2: '#6b7684',
    bg1: '#0d0f13', bg2: '#080a0d', bg3: '#050608',
    ink: '#e8edf2', muted: 'rgba(210, 222, 234, 0.42)',
    glow: 'rgba(184, 196, 208, 0.13)', font: 'mono', deco: 'noise'
  },
  pop: {
    accent: '#ff9c6e', accent2: '#ffc2a1',
    bg1: '#1a1109', bg2: '#100a05', bg3: '#0a0603',
    ink: '#fdf0e6', muted: 'rgba(253, 228, 210, 0.44)',
    glow: 'rgba(255, 156, 110, 0.16)', font: 'sans', deco: 'bokeh'
  },
  folk: {
    accent: '#d9b380', accent2: '#a67c4e',
    bg1: '#16110a', bg2: '#0e0b06', bg3: '#090604',
    ink: '#f2e8d5', muted: 'rgba(232, 214, 180, 0.44)',
    glow: 'rgba(217, 179, 128, 0.15)', font: 'serif', deco: 'paper'
  },
  classical: {
    accent: '#d8bf7a', accent2: '#9a7f3f',
    bg1: '#100e08', bg2: '#0b0a06', bg3: '#070604',
    ink: '#f1ead4', muted: 'rgba(230, 218, 180, 0.44)',
    glow: 'rgba(216, 191, 122, 0.14)', font: 'serif', deco: 'staff'
  },
  jazz: {
    accent: '#6a8dff', accent2: '#3f5aa8',
    bg1: '#0c1020', bg2: '#080b16', bg3: '#05070f',
    ink: '#e8edfc', muted: 'rgba(200, 212, 245, 0.44)',
    glow: 'rgba(106, 141, 255, 0.16)', font: 'serif', deco: 'bokeh'
  },
  soul: {
    accent: '#c76a8d', accent2: '#8d3f5e',
    bg1: '#180c11', bg2: '#10080c', bg3: '#0a0507',
    ink: '#f6e6ec', muted: 'rgba(240, 205, 220, 0.44)',
    glow: 'rgba(199, 106, 141, 0.17)', font: 'serif', deco: 'none'
  },
  ambient: {
    accent: '#7fb8c8', accent2: '#4a7f8f',
    bg1: '#0d1416', bg2: '#090f11', bg3: '#060a0b',
    ink: '#e4f0f2', muted: 'rgba(195, 220, 226, 0.42)',
    glow: 'rgba(127, 184, 200, 0.15)', font: 'sans', deco: 'mist'
  },
  anime: {
    accent: '#ffa8c5', accent2: '#c58aff',
    bg1: '#170d17', bg2: '#0f080f', bg3: '#0a050a',
    ink: '#fceef5', muted: 'rgba(248, 214, 232, 0.44)',
    glow: 'rgba(255, 168, 197, 0.17)', font: 'sans', deco: 'bokeh'
  },
  default: {
    accent: '#a9b8c8', accent2: '#7f8ea0',
    bg1: '#101216', bg2: '#0b0d10', bg3: '#07090b',
    ink: '#e9eef3', muted: 'rgba(205, 216, 226, 0.42)',
    glow: 'rgba(169, 184, 200, 0.13)', font: 'sans', deco: 'none'
  }
};

/* 把族群主题写入 #genre-overlay 的 CSS 变量（transition 由 stylesheet 负责） */
function applyGenreTheme(family) {
  if (typeof GENRE_FAMILIES === 'undefined' || GENRE_FAMILIES.indexOf(family) === -1) family = 'default';
  var theme = GENRE_THEMES[family] || GENRE_THEMES.default;
  var overlay = document.getElementById('genre-overlay');
  if (overlay) {
    overlay.dataset.genre = family;
    var s = overlay.style;
    s.setProperty('--gm-accent', theme.accent);
    s.setProperty('--gm-accent-2', theme.accent2);
    s.setProperty('--gm-bg-1', theme.bg1);
    s.setProperty('--gm-bg-2', theme.bg2);
    s.setProperty('--gm-bg-3', theme.bg3);
    s.setProperty('--gm-ink', theme.ink);
    s.setProperty('--gm-muted', theme.muted);
    s.setProperty('--gm-glow', theme.glow);
    overlay.dataset.gmFont = theme.font;
    overlay.dataset.gmDeco = theme.deco;
  }
  return theme;
}

/* 读取当前覆盖层族群（未设置时 default） */
function currentGenreThemeFamily() {
  var overlay = document.getElementById('genre-overlay');
  var family = overlay && overlay.dataset ? overlay.dataset.genre : '';
  return (typeof GENRE_FAMILIES !== 'undefined' && GENRE_FAMILIES.indexOf(family) !== -1) ? family : 'default';
}
