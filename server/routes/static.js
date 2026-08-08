/* =========================================================================
   OrangeSea · 静态资源路由（static）
   -------------------------------------------------------------------------
   /favicon.ico、/ 与其余静态文件兜底（含路径穿越白名单防护）。
   ========================================================================= */
'use strict';

const path = require('path');
const { serveStatic } = require('../utils');
const { PUBLIC_ROOT } = require('../context');

function handle(req, res, url) {
  const pn = url.pathname;

  if (pn === '/favicon.ico') {
    serveStatic(res, path.join(PUBLIC_ROOT, '..', 'build', 'icon.ico'));
    return true;
  }

  // 兜底静态服务：仅当所有路由模块都未命中时到达。
  let filePath = pn === '/' ? '/index.html' : pn;
  filePath = path.join(PUBLIC_ROOT, filePath);
  // 路径穿越防护：解析后必须落在 public/ 根目录内，否则禁止访问
  // （防止 GET /../../.cookie 等读取 public 之外的敏感文件）。
  const resolvedStatic = path.resolve(filePath);
  if (resolvedStatic !== PUBLIC_ROOT && !resolvedStatic.startsWith(PUBLIC_ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }
  serveStatic(res, filePath);
  return true;
}

module.exports = { handle };
