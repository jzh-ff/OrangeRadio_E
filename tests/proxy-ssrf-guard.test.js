'use strict';

/*
 * 代理 SSRF 防护测试
 * ----------------------------------------------------------------------------
 * 验证 server/utils.js 的私网/保留地址判定与 proxyTargetIsBlocked：
 * IPv4/IPv6 各私网段拒绝、公网放行、非法 URL/协议拒绝。
 * 域名解析路径不在此测试（依赖网络），只测纯判定与直接 IP 形态。
 */
const assert = require('node:assert/strict');

const {
  isPrivateIPv4,
  isPrivateIPv6,
  proxyTargetIsBlocked,
} = require('../server/utils');

// ---- IPv4 私网/保留段 ----
for (const ip of [
  '127.0.0.1', '127.255.255.254',   // 回环
  '10.0.0.1', '10.255.255.255',      // 10/8
  '172.16.0.1', '172.31.255.255',    // 172.16/12
  '192.168.0.1', '192.168.255.255',  // 192.168/16
  '169.254.1.1',                     // 链路本地
  '100.64.0.1', '100.127.255.255',   // CGNAT
  '0.0.0.0', '224.0.0.1', '240.0.0.1', // 保留/组播
  'not-an-ip',
]) {
  assert.equal(isPrivateIPv4(ip), true, ip + ' must be treated private');
}

for (const ip of [
  '8.8.8.8', '114.114.114.114', '1.1.1.1', '223.5.5.5', '52.1.2.3',
]) {
  assert.equal(isPrivateIPv4(ip), false, ip + ' must be treated public');
}

// ---- IPv6 ----
assert.equal(isPrivateIPv6('::1'), true, '::1 loopback');
assert.equal(isPrivateIPv6('fe80::1'), true, 'link-local');
assert.equal(isPrivateIPv6('fc00::1'), true, 'ULA fc00');
assert.equal(isPrivateIPv6('fd12:3456::1'), true, 'ULA fd00');
assert.equal(isPrivateIPv6('::ffff:192.168.1.1'), true, 'v4-mapped private');
assert.equal(isPrivateIPv6('::ffff:8.8.8.8'), false, 'v4-mapped public');
assert.equal(isPrivateIPv6('2001:4860:4860::8888'), false, 'public v6');

// ---- proxyTargetIsBlocked（直接 IP 形态，不发网络请求）----
(async () => {
  assert.equal(await proxyTargetIsBlocked('http://127.0.0.1:8080/admin'), true, 'loopback must be blocked');
  assert.equal(await proxyTargetIsBlocked('https://192.168.1.1/x'), true, 'lan must be blocked');
  assert.equal(await proxyTargetIsBlocked('http://10.0.0.5/'), true, '10/8 must be blocked');
  assert.equal(await proxyTargetIsBlocked('https://8.8.8.8/dns'), false, 'public ip must pass');
  assert.equal(await proxyTargetIsBlocked('http://[::1]/'), true, 'v6 loopback must be blocked');
  assert.equal(await proxyTargetIsBlocked('file:///etc/passwd'), true, 'non-http protocol must be blocked');
  assert.equal(await proxyTargetIsBlocked('not a url'), true, 'garbage url must be blocked');
  assert.equal(await proxyTargetIsBlocked(''), true, 'empty url must be blocked');
  console.log('OK proxy-ssrf-guard');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
