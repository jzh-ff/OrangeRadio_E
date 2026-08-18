/* =========================================================================
   OrangeSea · 反馈路由（feedback）
   -------------------------------------------------------------------------
   POST /api/feedback：客户端内「问题反馈」弹窗提交入口。
   转发到自建反馈服务器（与 NSIS 卸载器共用同一接收端点，接收方按
   app 字段是否含 ".inapp" 区分来源），服务器代码见
   tools/uninstall-feedback-server/feedback-server.js。
   ========================================================================= */
'use strict';

const fs = require('fs');
const os = require('os');
const { sendJSON, readRequestBody, fetchWithTimeout } = require('../utils');
const { APP_VERSION } = require('../context');

// 与 build/installer.nsh 的 MINERADIO_FEEDBACK_ENDPOINT 指向同一服务
const FEEDBACK_ENDPOINT = 'http://82.156.224.145:8787/feedback';
const FEEDBACK_APP_TAG = 'com.orangesea.desktop.inapp';
const FEEDBACK_TYPES = ['问题报告', '功能建议', '其他'];
const FEEDBACK_TEXT_LIMIT = 2000;
const FEEDBACK_USER_TEXT_LIMIT = 1400; // 正文限长，给诊断信息留出余量
const STARTUP_ERROR_LOG_TAIL_BYTES = 1536;

function readStartupErrorLogTail() {
  const file = process.env.ORANGESEA_STARTUP_ERROR_LOG;
  if (!file) return '';
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size <= 0) return '';
    const start = Math.max(0, stat.size - STARTUP_ERROR_LOG_TAIL_BYTES);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf-8').trim();
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return '';
  }
}

function localTimeString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
}

async function forwardToFeedbackServer(payload) {
  const res = await fetchWithTimeout(FEEDBACK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  }, 15000);
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  if (!res.ok || !data || data.success !== true) {
    const detail = data && data.message ? (':' + data.message) : '';
    throw new Error('FEEDBACK_SERVER_STATUS_' + res.status + detail);
  }
  return data;
}

async function handle(req, res, url) {
  if (url.pathname !== '/api/feedback' || req.method !== 'POST') return false;

  let body = {};
  try { body = await readRequestBody(req); } catch (_) { body = {}; }
  const userText = String(body.feedback || '').trim();
  if (!userText) {
    sendJSON(res, { ok: false, error: 'EMPTY_FEEDBACK' }, 400);
    return true;
  }

  const type = FEEDBACK_TYPES.indexOf(body.type) >= 0 ? body.type : '问题报告';
  const contact = String(body.contact || '').trim().slice(0, 200);
  const userAgent = String(body.userAgent || '').trim().slice(0, 200);
  const platform = process.platform + ' ' + os.release();

  let feedback = '[' + type + '] ' + userText.slice(0, FEEDBACK_USER_TEXT_LIMIT);
  if (body.includeDiagnostics !== false) {
    const lines = ['', '---- 诊断信息 ----', '版本: ' + APP_VERSION, '平台: ' + platform];
    const logTail = readStartupErrorLogTail();
    if (logTail) lines.push('启动日志尾部:', logTail);
    feedback += '\n' + lines.join('\n');
  }

  try {
    const data = await forwardToFeedbackServer({
      feedback: feedback.slice(0, FEEDBACK_TEXT_LIMIT),
      contact,
      version: APP_VERSION,
      app: FEEDBACK_APP_TAG,
      os: userAgent || platform,
      time: localTimeString(),
    });
    sendJSON(res, { ok: true, mailed: !!data.mailed });
  } catch (err) {
    console.error('[Feedback] forward failed:', err.message || err);
    sendJSON(res, { ok: false, error: err.message || 'FEEDBACK_FORWARD_FAILED' }, 502);
  }
  return true;
}

module.exports = { handle };
