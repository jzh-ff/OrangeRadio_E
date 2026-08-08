#!/usr/bin/env node
/*
 * OrangeSea 测试运行器
 * ----------------------------------------------------------------------------
 * tests/ 下的 *.test.js 为脚本式测试（直接调用 + assert，成功打印 "OK xxx"，
 * 失败抛异常并设置 process.exitCode=1），未使用 node:test runner。
 *
 * 本脚本逐个以子进程执行 tests/*.test.js，聚合结果并在任一失败时以非零码退出，
 * 以便 `npm test` / CI 正确判定。跨平台（Windows / macOS / Linux）。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const testsDir = path.resolve(__dirname, '..', 'tests');
const files = fs.readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

if (files.length === 0) {
  console.error('No *.test.js files found under tests/');
  process.exit(1);
}

const node = process.execPath;
let passed = 0;
let failed = 0;
const failures = [];

function runOne(file) {
  return new Promise((resolve) => {
    const filePath = path.join(testsDir, file);
    const proc = spawn(node, [filePath], { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) {
        passed++;
      } else {
        failed++;
        failures.push({ file, code });
      }
      resolve();
    });
    proc.on('error', (err) => {
      failed++;
      failures.push({ file, code: `ERR:${err.message}` });
      resolve();
    });
  });
}

(async () => {
  console.log(`Running ${files.length} test file(s)...\n`);
  for (const file of files) {
    await runOne(file);
  }

  console.log('\n==================================================');
  console.log(`  passed: ${passed}   failed: ${failed}   total: ${files.length}`);
  console.log('==================================================');
  if (failed > 0) {
    console.error('\nFailed tests:');
    for (const f of failures) {
      console.error(`  - ${f.file}  (exit ${f.code})`);
    }
    process.exit(1);
  }
})();
