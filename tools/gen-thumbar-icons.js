#!/usr/bin/env node
/**
 * 生成任务栏缩略图工具栏按钮图标（上一首/播放/暂停/下一首）。
 *
 * 纯 Node 实现（内置 zlib + 手写 PNG 编码），无第三方依赖。
 * 形状全部由矩形 + 三角形构成，用半平面判定逐像素光栅化。
 *
 * 用法：node tools/gen-thumbar-icons.js
 * 输出：desktop/assets/thumbar/{prev,play,pause,next}.png
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 32; // Windows 缩略图按钮图标显示约 20x20（随 DPI 缩放），32x32 保证高清屏清晰
// 深棕图形 + 透明底：任务栏预览面板为浅色底，深色图形对比清晰；深色系统主题下仍可辨认
const [R, G, B] = [0x2e, 0x2a, 0x22];
const OUT_DIR = path.join(__dirname, '..', 'desktop', 'assets', 'thumbar');

// ---------- PNG 编码（RGBA8、无压缩滤镜） ----------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(pixels, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 形状光栅化 ----------

function inRect(px, py, x0, y0, x1, y1) {
  return px >= x0 && px < x1 && py >= y0 && py < y1;
}

// 点与三条边叉积同号即在三角形内（顺/逆时针均可，含边界）
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

const SHAPES = {
  // 上一首：左竖条 + 朝左三角（顶点在左）
  prev: [
    ['rect', 6, 8, 10, 24],
    ['tri', 24, 8, 24, 24, 11, 16],
  ],
  // 播放：朝右三角
  play: [['tri', 10, 7, 10, 25, 25, 16]],
  // 暂停：双竖条
  pause: [
    ['rect', 8, 7, 13, 25],
    ['rect', 19, 7, 24, 25],
  ],
  // 下一首：朝右三角 + 右竖条（与 prev 镜像）
  next: [
    ['tri', 8, 8, 8, 24, 21, 16],
    ['rect', 22, 8, 26, 24],
  ],
};

function rasterize(shapes) {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = x + 0.5;
      const sy = y + 0.5;
      let hit = false;
      for (const s of shapes) {
        if (s[0] === 'rect') hit = hit || inRect(sx, sy, s[1], s[2], s[3], s[4]);
        else hit = hit || inTriangle(sx, sy, s[1], s[2], s[3], s[4], s[5], s[6]);
        if (hit) break;
      }
      const off = (y * SIZE + x) * 4;
      if (hit) {
        px[off] = R;
        px[off + 1] = G;
        px[off + 2] = B;
        px[off + 3] = 255;
      }
    }
  }
  return px;
}

function opaqueCount(px) {
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) n++;
  return n;
}

function isOpaqueAt(px, x, y) {
  return px[(y * SIZE + x) * 4 + 3] !== 0;
}

// ---------- 生成 + 自检 ----------

fs.mkdirSync(OUT_DIR, { recursive: true });

const rendered = {};
for (const [name, shapes] of Object.entries(SHAPES)) {
  const pixels = rasterize(shapes);
  const png = encodePng(pixels, SIZE);
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), png);
  rendered[name] = pixels;
  console.log(`${name}.png  ${png.length} bytes  ${opaqueCount(pixels)} opaque px`);
}

// 自检：非空、prev/next 镜像一致、play 左宽右尖、暂停左右两块对称
const failures = [];
for (const name of Object.keys(rendered)) {
  if (opaqueCount(rendered[name]) === 0) failures.push(`${name}: 图形为空`);
}
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (isOpaqueAt(rendered.prev, x, y) !== isOpaqueAt(rendered.next, SIZE - 1 - x, y)) {
      failures.push('prev/next 不是水平镜像');
      y = SIZE;
      break;
    }
  }
}
let playLeft = 0;
let playRight = 0;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (!isOpaqueAt(rendered.play, x, y)) continue;
    if (x < SIZE / 2) playLeft++;
    else playRight++;
  }
}
if (playLeft <= playRight) failures.push(`play 三角朝向反了 (left=${playLeft}, right=${playRight})`);
for (const [x1, x2] of [[10, 21]]) {
  if (!isOpaqueAt(rendered.pause, x1, 16) || !isOpaqueAt(rendered.pause, x2, 16) || isOpaqueAt(rendered.pause, 16, 16)) {
    failures.push('pause 双竖条布局异常');
    break;
  }
}

if (failures.length) {
  console.error('自检失败:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log(`自检通过，图标输出到 ${OUT_DIR}`);
