/* =========================================================================
   OrangeSea · 风格世界传送门
   纯显式时钟状态机；由主循环调用 advance，不创建 rAF / Observer。
   ========================================================================= */

var genreWorldTransitionState = {
  phase: 'idle',
  fromWorldId: '',
  targetWorldId: '',
  activeWorldId: '',
  startedAt: 0,
  duration: 0,
  reducedMotion: false,
  switched: false,
  failed: false,
  context: null,
  _lastProgress: -1
};

var genreWorldPortalCached = null;

function genreWorldTransitionPortal() {
  /* 缓存元素引用：portal 常驻 DOM，避免过渡期间每帧 getElementById */
  if (genreWorldPortalCached && genreWorldPortalCached.isConnected) return genreWorldPortalCached;
  genreWorldPortalCached = typeof document !== 'undefined' && document.getElementById
    ? document.getElementById('genre-world-portal')
    : null;
  return genreWorldPortalCached;
}

function genreWorldTransitionCurrentId() {
  var current = typeof genreWorldEngineState !== 'undefined' &&
    genreWorldEngineState && genreWorldEngineState.current;
  return current && current.record ? current.record.id : genreWorldTransitionState.activeWorldId;
}

function genreWorldTransitionReduced(opts) {
  if (opts && opts.reducedMotion === true) return true;
  var targetWindow = opts && opts.window
    ? opts.window
    : (typeof window !== 'undefined' ? window : null);
  if (!targetWindow || typeof targetWindow.matchMedia !== 'function') return false;
  try {
    return !!targetWindow.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    return false;
  }
}

function genreWorldTransitionSetPhase(phase, progress) {
  var phaseChanged = genreWorldTransitionState.phase !== phase;
  genreWorldTransitionState.phase = phase;
  var portal = genreWorldTransitionPortal();
  if (!portal) return;
  /* dataset/class 只在 phase 变化时写入，避免过渡期间每帧重复操作 */
  if (phaseChanged) {
    portal.dataset.phase = phase;
    portal.dataset.fromWorld = genreWorldTransitionState.fromWorldId || '';
    portal.dataset.targetWorld = genreWorldTransitionState.targetWorldId || '';
    portal.dataset.failed = genreWorldTransitionState.failed ? 'true' : 'false';
    portal.dataset.motion = genreWorldTransitionState.reducedMotion ? 'reduced' : 'full';
    portal.classList.toggle('is-active', phase !== 'idle');
    portal.classList.toggle('is-closing', phase === 'closing');
    portal.classList.toggle('is-crossing', phase === 'crossing');
    portal.classList.toggle('is-opening', phase === 'opening');
    portal.classList.toggle('is-failed', genreWorldTransitionState.failed);
  }
  if (portal.style && typeof portal.style.setProperty === 'function') {
    if (phaseChanged) {
      portal.style.setProperty('--portal-duration', genreWorldTransitionState.duration + 'ms');
    }
    /* progress 量化到 1% 粒度，值未变化时跳过 setProperty，避免每帧强制样式重算 */
    var quantized = Math.round(Math.max(0, Math.min(1, progress || 0)) * 100) / 100;
    if (quantized !== genreWorldTransitionState._lastProgress) {
      genreWorldTransitionState._lastProgress = quantized;
      portal.style.setProperty('--portal-progress', String(quantized));
    }
  }
}

function genreWorldTransitionCommit(target, actual, failed, ctx) {
  if (typeof commitGenreModeWorldResult !== 'function') return;
  try {
    commitGenreModeWorldResult(target, actual, !!failed, ctx || {});
  } catch (err) {
    // UI 提交异常不应破坏已完成的引擎事务。
  }
}

function genreWorldTransitionContextForWorld(ctx, worldId) {
  var result = {};
  ctx = ctx || {};
  for (var key in ctx) {
    if (Object.prototype.hasOwnProperty.call(ctx, key)) result[key] = ctx[key];
  }
  var record = typeof getGenreWorld === 'function' ? getGenreWorld(worldId) : null;
  if (record) {
    result.world = record;
    result.lyricStyle = record.lyricStyle;
  }
  return result;
}

function genreWorldTransitionSwitchTarget() {
  if (genreWorldTransitionState.switched) return;
  genreWorldTransitionState.switched = true;
  var target = genreWorldTransitionState.targetWorldId;
  var targetContext = genreWorldTransitionContextForWorld(
    genreWorldTransitionState.context,
    target
  );
  var ok = typeof switchGenreWorld === 'function' &&
    switchGenreWorld(target, targetContext);
  if (!ok && target !== 'prism' && typeof switchGenreWorld === 'function') {
    targetContext = genreWorldTransitionContextForWorld(
      genreWorldTransitionState.context,
      'prism'
    );
    ok = switchGenreWorld('prism', targetContext);
  }
  var actual = genreWorldTransitionCurrentId();
  if (ok && actual && actual !== target && typeof switchGenreWorld === 'function') {
    targetContext = genreWorldTransitionContextForWorld(
      genreWorldTransitionState.context,
      actual
    );
    switchGenreWorld(actual, targetContext);
  }
  genreWorldTransitionState.context = targetContext;
  genreWorldTransitionState.failed = !ok || actual !== target;
  genreWorldTransitionState.activeWorldId = genreWorldTransitionCurrentId() ||
    genreWorldTransitionState.fromWorldId;
  genreWorldTransitionCommit(
    target,
    genreWorldTransitionState.activeWorldId,
    genreWorldTransitionState.failed,
    genreWorldTransitionState.context
  );
}

function requestGenreWorldTransition(worldId, ctx, opts) {
  opts = opts || {};
  worldId = typeof worldId === 'string' ? worldId.trim() : '';
  if (!worldId) return false;
  var currentId = genreWorldTransitionCurrentId();
  if (!currentId || opts.initial === true) {
    cancelGenreWorldTransition({ preserveFailure: false });
    var initialContext = genreWorldTransitionContextForWorld(ctx, worldId);
    var initialOk = typeof switchGenreWorld === 'function' && switchGenreWorld(worldId, initialContext);
    if (!initialOk && worldId !== 'prism' && typeof switchGenreWorld === 'function') {
      initialContext = genreWorldTransitionContextForWorld(ctx, 'prism');
      initialOk = switchGenreWorld('prism', initialContext);
    }
    genreWorldTransitionState.activeWorldId = genreWorldTransitionCurrentId() || '';
    if (initialOk && genreWorldTransitionState.activeWorldId &&
      genreWorldTransitionState.activeWorldId !== worldId &&
      typeof switchGenreWorld === 'function') {
      initialContext = genreWorldTransitionContextForWorld(
        ctx,
        genreWorldTransitionState.activeWorldId
      );
      switchGenreWorld(genreWorldTransitionState.activeWorldId, initialContext);
    }
    genreWorldTransitionState.failed = !initialOk ||
      genreWorldTransitionState.activeWorldId !== worldId;
    genreWorldTransitionSetPhase('idle', 1);
    genreWorldTransitionCommit(
      worldId,
      genreWorldTransitionState.activeWorldId,
      genreWorldTransitionState.failed,
      initialContext
    );
    return !!initialOk;
  }
  if (currentId && currentId === worldId) {
    cancelGenreWorldTransition({ preserveFailure: false });
    var sameContext = genreWorldTransitionContextForWorld(ctx, worldId);
    var sameOk = typeof switchGenreWorld === 'function' && switchGenreWorld(worldId, sameContext);
    if (sameOk) genreWorldTransitionState.activeWorldId = worldId;
    genreWorldTransitionCommit(
      worldId,
      genreWorldTransitionCurrentId() || genreWorldTransitionState.activeWorldId,
      !sameOk,
      sameContext
    );
    return !!sameOk;
  }

  var reduced = genreWorldTransitionReduced(opts);
  var requestedDuration = Number(opts.duration);
  var duration = reduced
    ? Math.max(120, Math.min(300, requestedDuration || 220))
    : Math.max(1500, Math.min(2500, requestedDuration || 2000));
  genreWorldTransitionState.fromWorldId = currentId || '';
  genreWorldTransitionState.targetWorldId = worldId;
  genreWorldTransitionState.activeWorldId = currentId || '';
  genreWorldTransitionState.startedAt = Number(opts.now);
  if (!isFinite(genreWorldTransitionState.startedAt)) {
    genreWorldTransitionState.startedAt = typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
  }
  genreWorldTransitionState.duration = duration;
  genreWorldTransitionState.reducedMotion = reduced;
  genreWorldTransitionState.switched = false;
  genreWorldTransitionState.failed = false;
  genreWorldTransitionState.context = ctx || {};
  genreWorldTransitionSetPhase('closing', 0);
  return true;
}

function advanceGenreWorldTransition(now) {
  if (genreWorldTransitionState.phase === 'idle') return false;
  now = Number(now);
  if (!isFinite(now)) return false;
  var progress = Math.max(0, Math.min(1,
    (now - genreWorldTransitionState.startedAt) / genreWorldTransitionState.duration));
  var crossingAt = genreWorldTransitionState.reducedMotion ? 0.35 : 0.28;
  var openingAt = genreWorldTransitionState.reducedMotion ? 0.62 : 0.68;

  if (progress >= crossingAt) genreWorldTransitionSwitchTarget();
  if (progress >= 1) {
    genreWorldTransitionSetPhase('idle', 1);
    genreWorldTransitionState.context = null;
    return true;
  }
  if (progress >= openingAt) genreWorldTransitionSetPhase('opening', progress);
  else if (progress >= crossingAt) genreWorldTransitionSetPhase('crossing', progress);
  else genreWorldTransitionSetPhase('closing', progress);
  return true;
}

function cancelGenreWorldTransition(opts) {
  opts = opts || {};
  genreWorldTransitionState.phase = 'idle';
  genreWorldTransitionState.fromWorldId = '';
  genreWorldTransitionState.targetWorldId = '';
  /* 清空 activeWorldId：避免引擎停止后残留旧值，导致下次冷启动多走一次完整过渡 */
  genreWorldTransitionState.activeWorldId = '';
  genreWorldTransitionState.startedAt = 0;
  genreWorldTransitionState.duration = 0;
  genreWorldTransitionState.reducedMotion = false;
  genreWorldTransitionState.switched = false;
  genreWorldTransitionState.context = null;
  genreWorldTransitionState._lastProgress = -1;
  if (!opts.preserveFailure) genreWorldTransitionState.failed = false;
  genreWorldTransitionSetPhase('idle', 0);
  return true;
}

function genreWorldTransitionSnapshot() {
  return {
    phase: genreWorldTransitionState.phase,
    fromWorldId: genreWorldTransitionState.fromWorldId,
    targetWorldId: genreWorldTransitionState.targetWorldId,
    activeWorldId: genreWorldTransitionCurrentId() || genreWorldTransitionState.activeWorldId,
    startedAt: genreWorldTransitionState.startedAt,
    duration: genreWorldTransitionState.duration,
    reducedMotion: genreWorldTransitionState.reducedMotion,
    switched: genreWorldTransitionState.switched,
    failed: genreWorldTransitionState.failed
  };
}
