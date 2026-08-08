/* =========================================================================
   OrangeSea · Cookie 落盘加密（cookie-cipher）
   -------------------------------------------------------------------------
   AES-256-GCM 加密写盘，密钥由机器特征（主机名 + 用户名 + 固定盐）派生：
   - 同一台机器上 server 端与 Electron 主进程可算出同一密钥
   - 换机/换用户后旧密文不可解密 → 读取端回退明文（兼容历史文件）
   - 防止明文凭据被随意读取，属于本地防泄漏（非防定向攻击）
   ========================================================================= */
'use strict';

const crypto = require('crypto');
const os = require('os');

const COOKIE_CIPHER_PREFIX = 'OSC1:';

function cookieCipherKey() {
  let username = '';
  try { username = os.userInfo().username || ''; } catch (_) {}
  const seed = String(os.hostname() || '') + '|' + String(username) + '|OrangeSea-cookie-v1';
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptCookieText(text) {
  if (text == null || text === '') return String(text || '');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cookieCipherKey(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return COOKIE_CIPHER_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

// 解密失败（非密文 / 密钥不匹配 / 被篡改）返回 null，由调用方回退明文
function decryptCookieText(raw) {
  if (typeof raw !== 'string' || !raw.startsWith(COOKIE_CIPHER_PREFIX)) return null;
  try {
    const buf = Buffer.from(raw.slice(COOKIE_CIPHER_PREFIX.length), 'base64');
    if (buf.length < 28) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', cookieCipherKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (_) {
    return null;
  }
}

module.exports = {
  COOKIE_CIPHER_PREFIX,
  encryptCookieText,
  decryptCookieText,
};
