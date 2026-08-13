/*
 * 05-modes-controls-fit.js — 底栏 modes 区控件自适应
 * ------------------------------------------------------------
 * 目标：底栏右侧 .modes 区块按钮多时（DIY 模式 10 个）不溢出、不砍高频按钮。
 * 布局自适应分两层：
 *   1. CSS（index.css）：按钮 flex:0 1 收缩（36px → 最小 28px）+ 收紧间距，
 *      优先“压缩”而非“隐藏”，绝大部分宽度下所有按钮都能显示。
 *   2. 本文件（JS 兜底）：压缩后仍溢出时（极端窄宽），按优先级隐藏低频按钮
 *      （睡眠 → EQ → 自动隐藏 → …），歌词/沉浸式等高频按钮最后才考虑。
 * 窗口变宽或布局切换（diy/simple/immersive）时自动恢复。
 */

(function () {
  /* 隐藏优先级：低频 → 高频（越靠前越先被隐藏） */
  var MODES_HIDE_PRIORITY = [
    '#sleep-timer-control',
    '#eq-control',
    '#controls-hide-btn',
    '#desktop-lyrics-bar-btn',
    '#mini-player-btn',
    '.fullscreen-toggle-btn',
    '#time-display',
    '#volume-control',
    '#lyric-timing-control',
    '#immersive-btn'
  ];

  var fitTimer = 0;
  var settleTimer = 0;
  var lastHiddenSignature = '';
  var lastModesWidth = -1;

  /* 判断元素是否位于隐藏浮层（popover 等）内部。
     注意 opacity 不继承：弹层自身 opacity:0 会被祖先链检查捕获，
     而弹层内部的 static 子元素必须向上查祖先才能排除。 */
  function isInOverlay(el, modes) {
    for (var p = el; p && p.nodeType === 1 && p !== modes; p = p.parentNode) {
      var cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
      if (cs.position === 'absolute' || cs.position === 'fixed') return true;
    }
    return false;
  }

  /* 找 modes 内所有 in-flow 可见元素中最左的一个（排除 popover 浮层及其子树） */
  function findLeftmostInFlow(modes) {
    var leftmost = null;
    var leftmostLeft = Infinity;
    var all = modes.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (isInOverlay(el, modes)) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.left < leftmostLeft) { leftmostLeft = rect.left; leftmost = el; }
    }
    return leftmost;
  }

  function currentHiddenSignature(modes) {
    var sig = [];
    Array.prototype.forEach.call(modes.children, function (child) {
      if (getComputedStyle(child).display === 'none') sig.push(child.id || child.className.split(' ')[0]);
    });
    return sig.join(',');
  }

  function fitModesControls(force) {
    var modes = document.querySelector('.control-cluster.modes');
    if (!modes) return;

    /* 关键防抖：modes 容器宽度未变化时直接跳过。
       hover 等交互（body class 变化）不改变宽度，若仍执行“恢复→重藏”会让
       按钮布局闪动（左右跳动）；只有 resize / DIY 切换等宽度变化才需要重排。 */
    if (!force) {
      var currentWidth = modes.getBoundingClientRect().width;
      if (Math.abs(currentWidth - lastModesWidth) < 1) return;
      lastModesWidth = currentWidth;
    }

    /* 先恢复此前 JS 隐藏的元素（仅清内联样式，CSS 断点隐藏的保持隐藏） */
    Array.prototype.forEach.call(modes.children, function (child) {
      if (child.style && child.style.display === 'none') child.style.removeProperty('display');
    });

    /* 迭代：最左 in-flow 元素越过容器左边缘（即溢出，含按钮溢出容器的情况）→
       隐藏最低频的可见元素，直到放得下（允许 1px 容错）。 */
    var containerLeft = modes.getBoundingClientRect().left;
    for (var guard = 0; guard < 12; guard++) {
      var leftmost = findLeftmostInFlow(modes);
      if (!leftmost) break;
      if (leftmost.getBoundingClientRect().left >= containerLeft - 1) break;

      /* 从低频到高频找第一个可见元素隐藏；全部高频则不再隐藏 */
      var toHide = null;
      for (var i = 0; i < MODES_HIDE_PRIORITY.length; i++) {
        var el = modes.querySelector(MODES_HIDE_PRIORITY[i]);
        if (el && getComputedStyle(el).display !== 'none') { toHide = el; break; }
      }
      if (!toHide) break;
      toHide.style.display = 'none';
    }

    /* 自愈复查：仅在最终隐藏集合发生变化时复查一次（布局过渡期可能误判），
       状态稳定后不再复查，避免“恢复→溢出→隐藏”的无限循环导致按钮抖动。 */
    var sig = currentHiddenSignature(modes);
    var stateChanged = sig !== lastHiddenSignature;
    lastHiddenSignature = sig;
    if (stateChanged && !settleTimer) {
      settleTimer = setTimeout(function () {
        settleTimer = 0;
        fitModesControls(true);
      }, 150);
    }
  }

  function scheduleFit() {
    if (fitTimer) return;
    fitTimer = requestAnimationFrame(function () {
      fitTimer = 0;
      fitModesControls();
    });
  }

  /* 初始适配 + resize + 播放器模式切换（diy/simple/immersive 等）时重新适配。
     MutationObserver 只响应模式类变化——hover 等其他 body class 变化不触发 fit，
     避免“重排 → 按钮移动 → hover 翻转 → 再触发”的跳动循环。 */
  if (document.body) scheduleFit();
  else document.addEventListener('DOMContentLoaded', scheduleFit);
  window.addEventListener('resize', scheduleFit);
  if (typeof MutationObserver === 'function') {
    var MODE_CLASSES = ['diy-mode', 'simple-mode', 'immersive-mode', 'film-radio', 'genre-mode', 'graffiti-lyrics'];
    function currentModeSignature() {
      return MODE_CLASSES.filter(function (c) { return document.body.classList.contains(c); }).join(',');
    }
    var lastModeSignature = currentModeSignature();
    var observer = new MutationObserver(function () {
      var sig = currentModeSignature();
      if (sig !== lastModeSignature) {
        lastModeSignature = sig;
        scheduleFit();
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
})();
