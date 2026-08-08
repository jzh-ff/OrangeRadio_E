/* =========================================================================
   OrangeSea · 零依赖 HTTP 文本/JSON 请求工具（http-utils）
   -------------------------------------------------------------------------
   从 utils / qishui-api / spotify-api / kugou-api 四份重复实现收敛而来。
   不依赖 context 或任何平台模块，避免循环 require。
   特性（各原实现的超集）：
   - http/https 按 URL 协议自动选择
   - opts.timeoutMs 可配（默认 10000），超时抛 'Request timeout'
   - 非 2xx 抛错并携带 err.statusCode / err.body
   - requestJson 空文本返回 {}；解析失败抛 err.cause + err.body
   ========================================================================= */
'use strict';

const http = require('http');
const https = require('https');

function requestText(targetUrl, opts, body) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode >= 400) {
          const err = new Error('HTTP ' + response.statusCode);
          err.statusCode = response.statusCode;
          err.body = text;
          if (response.headers && response.headers['retry-after']) {
            err.retryAfter = response.headers['retry-after'];
          }
          reject(err);
          return;
        }
        resolve(text);
      });
    });
    // 兼容无 req.setTimeout 的 mock 环境（测试替身），真实 Node ClientRequest 均支持
    if (typeof req.setTimeout === 'function') {
      req.setTimeout(Number(opts.timeoutMs) || 10000, () => req.destroy(new Error('Request timeout')));
    }
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function requestJson(targetUrl, opts, body) {
  const text = await requestText(targetUrl, opts, body);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('Invalid JSON from ' + targetUrl);
    err.cause = e;
    err.body = text;
    throw err;
  }
}

module.exports = {
  requestText,
  requestJson,
};
