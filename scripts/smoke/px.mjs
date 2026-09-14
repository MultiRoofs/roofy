// Minimal PNG (8-bit truecolour/alpha, no interlace) reader + region probe.
//   node px.mjs <a.png> <b.png> <x> <y> <w> <h>
import fs from "node:fs";
import zlib from "node:zlib";

function decode(file) {
  const buf = fs.readFileSync(file);
  let off = 8,
    width = 0,
    height = 0,
    bitDepth = 0,
    colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("bitDepth " + bitDepth);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!channels) throw new Error("colorType " + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      switch (filter) {
        case 0:
          break;
        case 1:
          v += a;
          break;
        case 2:
          v += b;
          break;
        case 3:
          v += (a + b) >> 1;
          break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a),
            pb = Math.abs(pp - b),
            pc = Math.abs(pp - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          throw new Error("filter " + filter);
      }
      cur[i] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

const [a, b, X, Y, W, H] = process.argv.slice(2);
const A = decode(a),
  B = decode(b);
const x0 = +X,
  y0 = +Y,
  w = +W,
  h = +H;
let diff = 0,
  n = 0;
const avg = (img) => {
  let r = 0,
    g = 0,
    bl = 0,
    c = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = y * img.width * img.channels + x * img.channels;
      r += img.data[i];
      g += img.data[i + 1];
      bl += img.data[i + 2];
      c++;
    }
  return [Math.round(r / c), Math.round(g / c), Math.round(bl / c)];
};
for (let y = y0; y < y0 + h; y++)
  for (let x = x0; x < x0 + w; x++) {
    const i = y * A.width * A.channels + x * A.channels;
    const d =
      Math.abs(A.data[i] - B.data[i]) +
      Math.abs(A.data[i + 1] - B.data[i + 1]) +
      Math.abs(A.data[i + 2] - B.data[i + 2]);
    n++;
    if (d > 30) diff++;
  }
console.log(
  JSON.stringify({
    region: [x0, y0, w, h],
    avgA: avg(A),
    avgB: avg(B),
    changedPx: diff,
    totalPx: n,
    changedPct: +((100 * diff) / n).toFixed(1),
  }),
);
