// OrangeSea 卸载反馈接收器（零依赖，Node 14+）
//
// 功能：
//   POST /feedback[?或路径令牌]  接收卸载器提交的 JSON（feedback/contact/version/app/os/time）
//                               → 追加 JSONL 日志；配置了 SMTP 则同时转发到邮箱
//   GET  同路径                  返回极简网页反馈表单（卸载器发送失败时的浏览器兜底页）
//
// 全部配置走环境变量，SMTP 授权码只存在于服务器，绝不打进安装包：
//   PORT          监听端口，默认 8787
//   FEEDBACK_TOKEN  可选路径令牌；设置后路径变为 /feedback-<token>
//   FEEDBACK_LOG  JSONL 日志路径，默认 ./uninstall-feedback.jsonl
//   SMTP_HOST     如 smtp.qq.com（留空=不转发邮件，仅落盘）
//   SMTP_PORT     默认 465（SSL）
//   SMTP_USER     发件账号，如 1226163446@qq.com
//   SMTP_PASS     QQ 邮箱「SMTP 授权码」（设置-账号-开启SMTP后生成，不是登录密码）
//   MAIL_TO       收件邮箱，默认同 SMTP_USER
//
// 启动：node feedback-server.js   （建议 nginx 反代 TLS 后对外提供 https）

'use strict';

const http = require('http');
const tls = require('tls');
const fs = require('fs');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const TOKEN = process.env.FEEDBACK_TOKEN || '';
const LOG_FILE = process.env.FEEDBACK_LOG || './uninstall-feedback.jsonl';
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 465;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_TO = process.env.MAIL_TO || SMTP_USER;
const FEEDBACK_PATH = TOKEN ? `/feedback-${TOKEN}` : '/feedback';

const MAX_BODY = 8 * 1024;          // 单条 8KB 上限
const RATE_PER_MIN = 10;            // 单 IP 每分钟
const RATE_GLOBAL_DAY = 500;        // 全局每日上限

// ── 简易限流（内存版，够用） ─────────────────────────────────────────
const perIp = new Map();
let globalDay = { count: 0, day: new Date().toISOString().slice(0, 10) };

function rateLimited(ip) {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  if (globalDay.day !== today) globalDay = { count: 0, day: today };
  if (++globalDay.count > RATE_GLOBAL_DAY) return true;

  let rec = perIp.get(ip);
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: now + 60 * 1000 };
    perIp.set(ip, rec);
  }
  if (++rec.count > RATE_PER_MIN) return true;
  if (perIp.size > 10000) perIp.clear(); // 防内存膨胀
  return false;
}

// ── 字段清洗 ────────────────────────────────────────────────────────
function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

// ── 极简 SMTP 客户端（SSL + AUTH LOGIN，MIME base64，中文安全） ────
function smtpSend(subject, text) {
  return new Promise((resolve, reject) => {
    // family:4 钉死 IPv4——云服务器常解析到 IPv6 且路由不通，导致 SMTP 假超时
    const socket = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, family: 4, timeout: 20 * 1000 }, () => {});
    const cmds = [
      'EHLO orangesea-feedback\r\n',
      'AUTH LOGIN\r\n',
      Buffer.from(SMTP_USER, 'utf8').toString('base64') + '\r\n',
      Buffer.from(SMTP_PASS, 'utf8').toString('base64') + '\r\n',
      `MAIL FROM:<${SMTP_USER}>\r\n`,
      `RCPT TO:<${MAIL_TO}>\r\n`,
      'DATA\r\n',
    ];
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    const mail =
      `From: =?UTF-8?B?${b64('OrangeSea 卸载反馈')}?= <${SMTP_USER}>\r\n` +
      `To: <${MAIL_TO}>\r\n` +
      `Subject: =?UTF-8?B?${b64(subject)}?=\r\n` +
      'MIME-Version: 1.0\r\n' +
      'Content-Type: text/plain; charset=UTF-8\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      b64(text).replace(/(.{76})/g, '$1\r\n') + '\r\n.\r\n';

    let step = 0;
    let buffer = '';

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      // 逐行解析：一条应答可能多行且同批到达（如 EHLO 的 250-…250 ），
      // 只有「码+空格」的行才是该应答的最终行
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (!/^\d{3} /.test(line)) continue;
        const code = Number(line.slice(0, 3));
        if (code >= 400) {
          socket.destroy();
          reject(new Error(`SMTP ${code} at step ${step}: ${line}`));
          return;
        }
        if (step < cmds.length) {
          socket.write(cmds[step++]);
        } else if (step === cmds.length) {
          socket.write(mail);
          step++;
        } else if (step === cmds.length + 1) {
          socket.write('QUIT\r\n');
          step++;
        } else {
          socket.end();
          resolve(true);
        }
        break; // 一条应答只推进一步
      }
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('SMTP timeout')); });
    socket.on('error', reject);
  });
}

// ── 网页兜底表单（GET） ─────────────────────────────────────────────
function htmlPage() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OrangeSea 卸载反馈</title><style>
body{background:#14100A;color:#F5F0E6;font:14px/1.7 "Microsoft YaHei UI",sans-serif;
display:flex;justify-content:center;padding:40px 16px;margin:0}
form{width:100%;max-width:520px;background:#1d1811;border:1px solid #3a2f1d;border-radius:12px;padding:24px}
h1{font-size:18px;margin:0 0 6px}p{color:#C9A87A;margin:0 0 18px;font-size:13px}
label{display:block;font-size:12px;color:#FF7A3D;margin:14px 0 6px}
textarea,input{width:100%;box-sizing:border-box;background:#F5F0E6;color:#14100A;border:0;
border-radius:8px;padding:9px 11px;font:inherit}
textarea{height:110px;resize:vertical}
button{margin-top:20px;background:#FF7A3D;color:#14100A;border:0;border-radius:8px;
padding:10px 22px;font-weight:700;cursor:pointer}
#tip{margin-top:12px;font-size:13px;color:#8A7A5C;min-height:18px}
</style></head><body><form id="f">
<h1>OrangeSea 卸载反馈</h1><p>告诉我们哪里做得不好，或留下建议与联系方式。</p>
<label>建议 / 卸载原因（可选）</label><textarea id="fb"></textarea>
<label>联系方式：QQ / 邮箱（可选）</label><input id="ct">
<button type="submit">提交反馈</button><div id="tip"></div>
</form><script>
document.getElementById('f').addEventListener('submit',async(e)=>{
e.preventDefault();
const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({feedback:document.getElementById('fb').value,contact:document.getElementById('ct').value,
version:'web',app:'com.orangesea.desktop',os:navigator.userAgent,time:new Date().toISOString()})});
document.getElementById('tip').textContent=r.ok?'已提交，感谢反馈！':'提交失败，请稍后再试。';
if(r.ok){document.getElementById('fb').value='';document.getElementById('ct').value='';}
});
</script></body></html>`;
}

// ── HTTP 服务 ───────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  if (req.url.split('?')[0] !== FEEDBACK_PATH) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end('{"success":false,"message":"not found"}');
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(htmlPage());
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
    res.end('{"success":false,"message":"method not allowed"}');
    return;
  }

  if (rateLimited(ip)) {
    res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' });
    res.end('{"success":false,"message":"too many requests"}');
    return;
  }

  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    let payload = {};
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"success":false,"message":"bad json"}');
      return;
    }

    const record = {
      time: new Date().toISOString(),
      ip,
      feedback: clean(payload.feedback, 2000),
      contact: clean(payload.contact, 200),
      version: clean(payload.version, 40),
      app: clean(payload.app, 80),
      os: clean(payload.os, 200),
      clientTime: clean(payload.time, 40),
    };

    if (!record.feedback && !record.contact) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"success":false,"message":"empty feedback"}');
      return;
    }

    try {
      fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
    } catch (e) {
      console.error('[log] write failed:', e.message);
    }

    let mailed = false;
    if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      const subject = `[OrangeSea 卸载反馈] v${record.version || '?'} ${record.contact ? '· ' + record.contact : ''}`;
      const text =
        `建议 / 卸载原因：\n${record.feedback || '（未填写）'}\n\n` +
        `联系方式：${record.contact || '（未填写）'}\n` +
        `版本：${record.version || '?'}   渠道：${record.app || '?'}\n` +
        `系统：${record.os || '?'}\n` +
        `时间：${record.time}（客户端 ${record.clientTime || '?'}）\n` +
        `来源 IP：${record.ip}\n`;
      try {
        await smtpSend(subject, text);
        mailed = true;
      } catch (e) {
        console.error('[smtp] send failed:', e.message);
      }
    }

    console.log(`[feedback] ip=${ip} v=${record.version} fb=${record.feedback.length}字 mail=${mailed}`);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end('{"success":true,"mailed":' + mailed + '}');
  });
});

server.listen(PORT, () => {
  console.log(`[feedback-server] listening on :${PORT} path=${FEEDBACK_PATH}`);
  console.log(`[feedback-server] smtp=${SMTP_HOST ? SMTP_HOST + ':' + SMTP_PORT : 'disabled'} log=${LOG_FILE}`);
});
