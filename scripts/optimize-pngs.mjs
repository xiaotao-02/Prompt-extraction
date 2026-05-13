/**
 * 零依赖 PNG 重压缩工具。
 *
 * 读取已生成的 PNG，解码 IDAT（zlib 解压），按行重新选择 Paeth / Sub / Up / None / Average
 * 这 5 种 filter 中能让 deflate 压缩比最高的那种，然后用 level 9 重新打包。
 *
 * 通常能在保留无损画质的前提下显著减小 PNG 体积。
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'public', 'icons');

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32Table() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crc32Table();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function parsePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('Not a PNG');
  let off = 8;
  const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, data });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function reverseFilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowSrc = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = rowSrc[x]; break;
        case 1: v = (rowSrc[x] + a) & 0xff; break;
        case 2: v = (rowSrc[x] + b) & 0xff; break;
        case 3: v = (rowSrc[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: v = (rowSrc[x] + paeth(a, b, c)) & 0xff; break;
        default: throw new Error('Bad filter ' + filter);
      }
      out[y * stride + x] = v;
    }
  }
  return out;
}

function applyFilters(pixels, width, height, bpp) {
  const stride = width * bpp;
  const filtered = Buffer.alloc((stride + 1) * height);
  const rowBuffers = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < height; y++) {
    const sums = [0, 0, 0, 0, 0];
    for (let x = 0; x < stride; x++) {
      const cur = pixels[y * stride + x];
      const a = x >= bpp ? pixels[y * stride + x - bpp] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= bpp ? pixels[(y - 1) * stride + x - bpp] : 0;
      const v0 = cur;
      const v1 = (cur - a) & 0xff;
      const v2 = (cur - b) & 0xff;
      const v3 = (cur - ((a + b) >> 1)) & 0xff;
      const v4 = (cur - paeth(a, b, c)) & 0xff;
      rowBuffers[0][x] = v0; sums[0] += v0 < 128 ? v0 : 256 - v0;
      rowBuffers[1][x] = v1; sums[1] += v1 < 128 ? v1 : 256 - v1;
      rowBuffers[2][x] = v2; sums[2] += v2 < 128 ? v2 : 256 - v2;
      rowBuffers[3][x] = v3; sums[3] += v3 < 128 ? v3 : 256 - v3;
      rowBuffers[4][x] = v4; sums[4] += v4 < 128 ? v4 : 256 - v4;
    }
    let best = 0;
    for (let i = 1; i < 5; i++) if (sums[i] < sums[best]) best = i;
    filtered[y * (stride + 1)] = best;
    rowBuffers[best].copy(filtered, y * (stride + 1) + 1);
  }
  return filtered;
}

function optimize(file) {
  const before = statSync(file).size;
  const buf = readFileSync(file);
  const chunks = parsePng(buf);

  const ihdr = chunks.find(c => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (bitDepth !== 8) return; // 仅处理 8bit
  if (interlace !== 0) return;
  let bpp;
  if (colorType === 6) bpp = 4;
  else if (colorType === 2) bpp = 3;
  else if (colorType === 4) bpp = 2;
  else if (colorType === 0) bpp = 1;
  else return;

  const idatRaw = Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
  const raw = inflateSync(idatRaw);
  const pixels = reverseFilter(raw, width, height, bpp);
  const refiltered = applyFilters(pixels, width, height, bpp);
  const idat = deflateSync(refiltered, { level: 9, memLevel: 9, strategy: 0 });

  const out = [Buffer.from(PNG_SIG)];
  for (const c of chunks) {
    if (c.type === 'IDAT') continue;
    if (c.type === 'IEND') {
      out.push(chunk('IDAT', idat));
      out.push(chunk('IEND', Buffer.alloc(0)));
      continue;
    }
    out.push(chunk(c.type, c.data));
  }
  const final = Buffer.concat(out);
  if (final.length < buf.length) {
    writeFileSync(file, final);
    console.log(`✓ ${file}: ${before} -> ${final.length} bytes  (-${(((before - final.length) / before) * 100).toFixed(1)}%)`);
  } else {
    console.log(`= ${file}: ${before} bytes  (already optimal)`);
  }
}

for (const s of [16, 32, 48, 128]) {
  optimize(join(iconsDir, `icon-${s}.png`));
}
