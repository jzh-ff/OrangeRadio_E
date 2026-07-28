// OrangeSea icon generator (zero dependencies, pure Node)
// Renders the sunset-over-sea design directly into RGBA pixels, encodes PNG (zlib) + ICO + BMP.
// Usage: node scripts/generate-icon.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256; // master render size, downscaled to smaller sizes by box sampling
const buildDir = path.join(__dirname, '..', 'build');

// ---------- tiny math helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function mixRgb(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function parseHex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

// ---------- color stops (matching build/icon.svg) ----------
const SEA = [parseHex('#1a2340'), parseHex('#3a2a5e'), parseHex('#0c1220')];
const SUN = [parseHex('#ffc46b'), parseHex('#ff7a3d'), parseHex('#ff5e62')];
const SPARK = parseHex('#ffc46b');

// ---------- gradient sampler ----------
function seaColor(yNorm) {
  // three-stop vertical gradient
  if (yNorm < 0.55) return mixRgb(SEA[0], SEA[1], yNorm / 0.55);
  return mixRgb(SEA[1], SEA[2], (yNorm - 0.55) / 0.45);
}
function sunColor(yNorm) {
  if (yNorm < 0.6) return mixRgb(SUN[0], SUN[1], yNorm / 0.6);
  return mixRgb(SUN[1], SUN[2], (yNorm - 0.6) / 0.4);
}

// ---------- wave path signed-ish height ----------
// SVG cubic-bezier-approximated wave as piecewise quadratic, x in [0,1].
// Wave segments (Q control points chosen to mimic T-spline smoothness):
//   seg1: x 0 ->0.5  base y oscillates, seg2: x 0.5 ->1.0
// Returns wave top y at given x (normalized 0..1 across canvas).
function waveTopY(xNorm, baseY, amp) {
  // smooth sine-based wave matching the visual rhythm of icon.svg
  const p = xNorm * Math.PI * 2; // two full periods across width
  return baseY + Math.sin(p) * amp * 0.5;
}

// round-rect mask (icon background clip with rx = 56 at 256 => 0.21875 ratio)
function roundedRectAlpha(x, y, w, h, pad, corner) {
  const x0 = pad, y0 = pad, x1 = w - pad, y1 = h - pad;
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return 0;
  const r = corner;
  const inCorner = (cx, cy) => {
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy >= r * r ? 0 : 1;
  };
  let a = 1;
  if (x < x0 + r && y < y0 + r) a = inCorner(x0 + r, y0 + r);
  else if (x >= x1 - r && y < y0 + r) a = inCorner(x1 - r, y0 + r);
  else if (x < x0 + r && y >= y1 - r) a = inCorner(x0 + r, y1 - r);
  else if (x >= x1 - r && y >= y1 - r) a = inCorner(x1 - r, y1 - r);
  return a;
}

// ---------- master render at SIZE ----------
function renderMaster() {
  const W = SIZE, H = SIZE;
  const buf = Buffer.alloc(W * H * 4);
  const sunCx = 128, sunCy = 118, sunR = 62;
  const pad = 8, corner = 56, stroke = 3;
  const sparks = [[84, 104, 4], [128, 92, 5], [172, 104, 4]];
  // wave params: three layers (matching icon.svg at 150/168/186 base, amp ~ implicit)
  const waves = [
    { base: 150, amp: 8, color: parseHex('#0c1220'), alpha: 0.82 },
    { base: 168, amp: 8, color: parseHex('#101a30'), alpha: 0.9 },
    { base: 186, amp: 8, color: parseHex('#16223c'), alpha: 1.0 },
  ];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const mask = roundedRectAlpha(x, y, W, H, pad, corner);
      if (mask === 0) { continue; } // leave transparent outside

      let r, g, b;
      const yNorm = (y - pad) / (H - 2 * pad);
      const yClamped = clamp(yNorm, 0, 1);
      const seaC = seaColor(yClamped);

      // start from sea gradient
      r = seaC[0]; g = seaC[1]; b = seaC[2];

      // sun disc (radial vertical gradient inside circle)
      const dxs = x - sunCx, dys = y - sunCy;
      if (dxs * dxs + dys * dys <= sunR * sunR) {
        const sunY = clamp((y - (sunCy - sunR)) / (2 * sunR), 0, 1);
        const sc = sunColor(sunY);
        r = sc[0]; g = sc[1]; b = sc[2];
      }

      // waves (paint from back to front: later waves overwrite)
      for (const wv of waves) {
        const top = waveTopY(x / W, wv.base, wv.amp);
        if (y >= top) {
          r = lerp(r, wv.color[0], wv.alpha);
          g = lerp(g, wv.color[1], wv.alpha);
          b = lerp(b, wv.color[2], wv.alpha);
        }
      }

      // sparks (small dots, drawn on top)
      for (const [sx, sy, sr] of sparks) {
        const ddx = x - sx, ddy = y - sy;
        if (ddx * ddx + ddy * ddy <= sr * sr) {
          r = SPARK[0]; g = SPARK[1]; b = SPARK[2];
        }
      }

      // rounded-rect stroke ring (#ffc46b @ 0.35)
      // ring = inside mask but within stroke band of the rounded rect edge
      const ringMask = roundedRectAlpha(x, y, W, H, pad, corner);
      const innerMask = roundedRectAlpha(x, y, W, H, pad + stroke, Math.max(0, corner - stroke));
      if (ringMask === 1 && innerMask === 0) {
        r = lerp(r, SPARK[0], 0.35);
        g = lerp(g, SPARK[1], 0.35);
        b = lerp(b, SPARK[2], 0.35);
      }

      const idx = (y * W + x) * 4;
      buf[idx] = r | 0;
      buf[idx + 1] = g | 0;
      buf[idx + 2] = b | 0;
      buf[idx + 3] = 255 * mask; // mask is 0 or 1
    }
  }
  return buf;
}

// ---------- PNG encoder (filter type 0 + zlib deflate) ----------
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
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit, RGBA
  // add filter byte (0) per scanline
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- downscale by box averaging ----------
function downscale(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  const xRatio = sw / dw, yRatio = sh / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(x * xRatio), x1 = Math.floor((x + 1) * xRatio);
      const y0 = Math.floor(y * yRatio), y1 = Math.floor((y + 1) * yRatio);
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * sw + xx) * 4;
        r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
      }
      if (n === 0) n = 1;
      const o = (y * dw + x) * 4;
      dst[o] = (r / n) | 0; dst[o + 1] = (g / n) | 0; dst[o + 2] = (b / n) | 0; dst[o + 3] = (a / n) | 0;
    }
  }
  return dst;
}

// ---------- BMP encoder (24-bit, uncompressed) for installer artwork ----------
function encodeBmp(rgba, w, h) {
  // rows stored bottom-up in BMP
  const rowSize = ((24 * w + 31) / 32 | 0) * 4;
  const pixelDataSize = rowSize * h;
  const fileSize = 54 + pixelDataSize;
  const buf = Buffer.alloc(fileSize);
  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10); // pixel data offset
  // DIB header (40 bytes)
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22); // positive = bottom-up
  buf.writeUInt16LE(1, 26); // planes
  buf.writeUInt16LE(24, 28); // bpp
  // rest zero (BI_RGB)
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y; // flip to bottom-up
    for (let x = 0; x < w; x++) {
      const i = (srcY * w + x) * 4;
      const o = 54 + y * rowSize + x * 3;
      buf[o] = rgba[i + 2]; // B
      buf[o + 1] = rgba[i + 1]; // G
      buf[o + 2] = rgba[i]; // R
    }
  }
  return buf;
}

// ---------- installer artwork: sidebar (164x314) and header (150x57) ----------
function renderInstallerArt(w, h, variant) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const yNorm = y / h;
      // 日落渐变：顶部深褐紫 → 中部暖橙 → 底部深蓝黑
      let r, g, b;
      if (variant === 'sidebar') {
        // 侧边栏：纵向日落渐变 + 海浪
        if (yNorm < 0.35) {
          // 天空：深紫褐 → 暖橙
          const t = yNorm / 0.35;
          r = lerp(26, 92, t); g = lerp(16, 42, t); b = lerp(10, 20, t);
        } else if (yNorm < 0.55) {
          // 日落带：暖橙 → 珊瑚红
          const t = (yNorm - 0.35) / 0.20;
          r = lerp(92, 255, t); g = lerp(42, 94, t); b = lerp(20, 98, t);
        } else if (yNorm < 0.72) {
          // 海面反光：珊瑚红 → 深褐
          const t = (yNorm - 0.55) / 0.17;
          r = lerp(255, 60, t); g = lerp(94, 30, t); b = lerp(98, 20, t);
        } else {
          // 深海：深褐 → 深蓝黑
          const t = (yNorm - 0.72) / 0.28;
          r = lerp(60, 12, t); g = lerp(30, 18, t); b = lerp(20, 32, t);
        }
        // 海浪线（在 0.72 附近）
        if (yNorm > 0.70 && yNorm < 0.74) {
          const wave = Math.sin(x / w * Math.PI * 3) * 0.02;
          if (Math.abs(yNorm - 0.72 - wave) < 0.012) {
            r = 255; g = 200; b = 130;
          }
        }
      } else {
        // 头部图：横向日落渐变（左深右亮）
        const xNorm = x / w;
        r = lerp(20, 80, xNorm) + lerp(0, 40, yNorm);
        g = lerp(14, 36, xNorm) + lerp(0, 16, yNorm);
        b = lerp(10, 18, xNorm) + lerp(0, 8, yNorm);
        // 底部暖光
        if (yNorm > 0.6) {
          const t = (yNorm - 0.6) / 0.4;
          r = lerp(r, 200, t * 0.4); g = lerp(g, 100, t * 0.4); b = lerp(b, 50, t * 0.4);
        }
      }
      const i = (y * w + x) * 4;
      buf[i] = clamp(r | 0, 0, 255); buf[i + 1] = clamp(g | 0, 0, 255); buf[i + 2] = clamp(b | 0, 0, 255); buf[i + 3] = 255;
    }
  }
  return buf;
}

// ---------- main ----------
console.log('Rendering master 256x256...');
const master = renderMaster();

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map(size => {
  const px = size === SIZE ? master : downscale(master, SIZE, SIZE, size, size);
  return { size, png: encodePng(px, size, size) };
});

// icon.png (256)
fs.writeFileSync(path.join(buildDir, 'icon.png'), pngs[pngs.length - 1].png);

// icon.ico
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
let offset = 6 + pngs.length * 16;
const entries = [];
for (const { size, png } of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(size === 256 ? 0 : size, 0);
  e.writeUInt8(size === 256 ? 0 : size, 1);
  e.writeUInt8(0, 2); e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  offset += png.length;
}
const ico = Buffer.concat([header, ...entries, ...pngs.map(p => p.png)]);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);

// installer artwork
const sidebar = renderInstallerArt(164, 314, 'sidebar');
fs.writeFileSync(path.join(buildDir, 'installerSidebar.bmp'), encodeBmp(sidebar, 164, 314));
const headerArt = renderInstallerArt(150, 57, 'header');
fs.writeFileSync(path.join(buildDir, 'installerHeader.bmp'), encodeBmp(headerArt, 150, 57));

console.log('Done. icon.ico (' + sizes.join('/') + '), icon.png, installerSidebar.bmp, installerHeader.bmp');
