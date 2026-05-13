/**
 * 零依赖生成 PNG 图标（紫色渐变 + 白色 sparkle 简化形）
 * 仅使用 Node 内置 zlib + Buffer 写出 PNG。
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const SIZES = [16, 32, 48, 128];

// 颜色（RGB）
const C_BG_TOP = [99, 102, 241];   // indigo-500
const C_BG_BOT = [168, 85, 247];   // purple-500
const C_FG = [255, 255, 255];

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function makePixels(size) {
  const buf = Buffer.alloc(size * size * 4);
  const r = Math.round(size * 0.22); // 圆角半径

  // 设计参考 128 尺寸，按比例缩放
  const scale = size / 128;
  const frame = {
    x: 28 * scale, y: 38 * scale,
    w: 56 * scale, h: 44 * scale,
    stroke: Math.max(1, 4 * scale),
  };
  const sun = { cx: 44 * scale, cy: 54 * scale, r: 5 * scale };
  const mountains = [
    [34 * scale, 76 * scale],
    [48 * scale, 62 * scale],
    [60 * scale, 72 * scale],
    [74 * scale, 58 * scale],
    [80 * scale, 66 * scale],
    [80 * scale, 78 * scale],
    [34 * scale, 78 * scale],
  ];
  const sparkles = [
    { cx: 92 * scale, cy: 30 * scale, r: 9 * scale },
    { cx: 100 * scale, cy: 72 * scale, r: 5 * scale },
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // 圆角矩形 alpha 蒙版
      const inCorner = !inRoundedRect(x, y, 0, 0, size, size, r);
      if (inCorner) {
        buf[i] = 0;
        buf[i + 1] = 0;
        buf[i + 2] = 0;
        buf[i + 3] = 0;
        continue;
      }
      // 渐变背景
      const t = y / (size - 1);
      let R = lerp(C_BG_TOP[0], C_BG_BOT[0], t);
      let G = lerp(C_BG_TOP[1], C_BG_BOT[1], t);
      let B = lerp(C_BG_TOP[2], C_BG_BOT[2], t);

      // 前景：图片框
      if (onRectStroke(x, y, frame.x, frame.y, frame.w, frame.h, frame.stroke)) {
        [R, G, B] = C_FG;
      }
      // 太阳
      if (size >= 32 && inCircle(x, y, sun.cx, sun.cy, sun.r)) {
        [R, G, B] = C_FG;
      }
      // 山脉填充
      if (size >= 32 && inPolygon(x, y, mountains)) {
        [R, G, B] = C_FG;
      }
      // 闪光
      for (const sp of sparkles) {
        if (size < 32 && sp.r < 6) continue;
        if (inSparkle(x, y, sp.cx, sp.cy, sp.r)) {
          [R, G, B] = C_FG;
        }
      }

      buf[i] = R;
      buf[i + 1] = G;
      buf[i + 2] = B;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function inRoundedRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + rw - r);
  const cy = Math.min(Math.max(y, ry + r), ry + rh - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function onRectStroke(x, y, rx, ry, rw, rh, sw) {
  const insideOuter =
    x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
  const insideInner =
    x >= rx + sw && x <= rx + rw - sw && y >= ry + sw && y <= ry + rh - sw;
  return insideOuter && !insideInner;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// 四角星
function inSparkle(x, y, cx, cy, r) {
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  return dx + dy <= r * 0.45 || (dx <= r * 0.15 && dy <= r) || (dy <= r * 0.15 && dx <= r);
}

// === PNG encoder ===
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crcData = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;     // bit depth
  ihdr[9] = 6;     // color type RGBA
  ihdr[10] = 0;    // compression
  ihdr[11] = 0;    // filter
  ihdr[12] = 0;    // interlace

  // 每行前加 filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of SIZES) {
  const pixels = makePixels(size);
  const png = encodePng(size, size, pixels);
  const out = join(outDir, `icon-${size}.png`);
  writeFileSync(out, png);
  console.log(`✓ ${out}`);
}
