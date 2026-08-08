'use strict';

/*
 * Cookie 落盘加密测试
 * ----------------------------------------------------------------------------
 * 验证 server/cookie-cipher.js 的 AES-256-GCM roundtrip、篡改检测、非密文回退，
 * 以及 server/context.js 的加密读写与历史明文文件兼容。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { encryptCookieText, decryptCookieText, COOKIE_CIPHER_PREFIX } = require('../server/cookie-cipher');

// ---- 加解密 roundtrip ----
const plain = 'MUSIC_U=abc123; __csrf=xyz';
const enc = encryptCookieText(plain);
assert.equal(enc.startsWith(COOKIE_CIPHER_PREFIX), true, 'encrypted text must carry prefix');
assert.equal(enc.includes('MUSIC_U'), false, 'plaintext must not appear in ciphertext');
assert.equal(decryptCookieText(enc), plain, 'roundtrip must recover original');
assert.notEqual(enc, encryptCookieText(plain), 'same input must produce different ciphertext (random iv)');

// ---- 空值与非密文 ----
assert.equal(encryptCookieText(''), '');
assert.equal(encryptCookieText(null), '');
assert.equal(decryptCookieText(''), null);
assert.equal(decryptCookieText('MUSIC_U=abc'), null, 'legacy plaintext is not decryptable (caller falls back)');
assert.equal(decryptCookieText('OSC1:not-base64!!'), null);
const tampered = enc.slice(0, 20) + (enc[20] === 'A' ? 'B' : 'A') + enc.slice(21);
assert.equal(decryptCookieText(tampered), null, 'tampered ciphertext must fail auth tag');

// ---- context 读写：加密落盘 + 明文兼容 ----
(async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'orangesea-cookie-cipher-'));
  const cookieFile = path.join(tmpRoot, '.cookie');
  for (const envKey of ['COOKIE_FILE', 'QQ_COOKIE_FILE', 'KUGOU_COOKIE_FILE', 'QISHUI_COOKIE_FILE']) {
    process.env[envKey] = path.join(tmpRoot, 'empty-' + envKey + '.cookie');
  }
  process.env.COOKIE_FILE = cookieFile;
  process.env.MINERADIO_LISTEN_SYNC_FILE = path.join(tmpRoot, 'listen.json');
  try {
    const context = require('../server/context');

    // 写入 → 磁盘为密文，读取还原
    context.saveCookie('MUSIC_U=secret-cookie-value');
    const onDisk = fs.readFileSync(cookieFile, 'utf8');
    assert.equal(onDisk.startsWith(COOKIE_CIPHER_PREFIX), true, 'cookie file must be written encrypted');
    assert.equal(onDisk.includes('secret-cookie-value'), false, 'plaintext must not leak to disk');
    assert.equal(context.getUserCookie(), 'MUSIC_U=secret-cookie-value', 'in-memory value must be plaintext');

    // 重新读取（模拟重启）：force 刷新
    context.setUserCookie('');
    context.refreshConfiguredCookieStores(true);
    assert.equal(context.getUserCookie(), 'MUSIC_U=secret-cookie-value', 'reload must decrypt the file');

    // 历史明文文件兼容：手写明文 → 读取回退原文
    fs.writeFileSync(cookieFile, 'MUSIC_U=legacy-plain', 'utf8');
    context.setUserCookie('');
    context.refreshConfiguredCookieStores(true);
    assert.equal(context.getUserCookie(), 'MUSIC_U=legacy-plain', 'legacy plaintext file must still load');

    console.log('OK cookie-cipher');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
