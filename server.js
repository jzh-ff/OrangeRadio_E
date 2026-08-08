/* =========================================================================
   OrangeSea · 粒子音乐可视化播放器 — 服务端装配入口
   -------------------------------------------------------------------------
   server.js 现在是「门面/装配层」：从 server/ 目录加载共享状态（context）、
   工具（utils）与各音源/功能路由模块（routes/*），按固定顺序分发给路由
   handler，最后兜底静态资源。对外契约保持不变：
   - module.exports = http.Server 实例（.listening / .once / .close()）
   - server.clearAllLoginCredentials = 全局登出（desktop/main.js 调用）
   - require 时即 listen(PORT, HOST)
   ========================================================================= */
'use strict';

const http = require('http');
const {
  PORT,
  HOST,
  refreshConfiguredCookieStores,
  clearAllRuntimeLoginCredentials,
} = require('./server/context');

// ---------- 路由模块（按分发顺序） ----------
const routeModules = [
  require('./server/routes/system'),
  require('./server/routes/local'),
  require('./server/routes/listen'),
  require('./server/routes/update'),
  require('./server/routes/beatmap'),
  require('./server/routes/discover'),
  require('./server/routes/search'),
  require('./server/routes/spotify'),
  require('./server/routes/qishui'),
  require('./server/routes/kugou'),
  require('./server/routes/qq'),
  require('./server/routes/download'),
  require('./server/routes/podcast'),
  require('./server/routes/netease'),
  require('./server/routes/proxy'),
  require('./server/routes/static'),
];

const server = http.createServer(async (req, res) => {
  refreshConfiguredCookieStores(false);
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const pn = url.pathname;

  // 按顺序尝试各路由模块；命中即 return true，全部未命中则落到 static 兜底。
  for (const mod of routeModules) {
    try {
      if (await mod.handle(req, res, url)) return;
    } catch (err) {
      console.error('[Route]', pn, err && (err.stack || err.message || err));
      try {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err && err.message || 'INTERNAL_ERROR' }));
        } else {
          res.end();
        }
      } catch (_) {}
      return;
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log('======================================================');
  console.log(' 粒子音乐可视化 v2  →  http://localhost:' + PORT);
  console.log(' 登录态: ' + (require('./server/context').getUserCookie() ? '已登录(cookie已加载)' : '未登录'));
  console.log('======================================================');
});

server.clearAllLoginCredentials = clearAllRuntimeLoginCredentials;

module.exports = server;
