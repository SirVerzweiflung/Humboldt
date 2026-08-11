// App icon generator — writes the PWA icon set with no dependencies at all.
//
// Node ships zlib, and a PNG is just "signature + a few length-prefixed CRC32'd
// chunks wrapped around a deflate stream", so an image library would buy us
// nothing here. Same reasoning as server/upload/index.mjs: fewer moving parts on
// a box we have to fix at 19:55.
//
//   node tools/icons/build.mjs
//
// Output (committed, so neither the server install nor CI ever runs this):
//   public/icons/icon-192.png
//   public/icons/icon-512.png
//   public/icons/icon-maskable-512.png   glyph inset for Android's mask
//   public/icons/apple-touch-180.png     iOS ignores the manifest and uses this
//
// Design: white "H" on pacific (#5296a5). Palette only (CLAUDE.md §15).

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "..", "public", "icons");

const BG = [0x52, 0x96, 0xa5]; // pacific
const FG = [0xff, 0xff, 0xff]; // white — the only non-palette addition allowed
const SS = 4; // supersampling factor; 4× is plenty for a glyph this blocky

// ── the glyph ───────────────────────────────────────────────────────────────
// The "H" as three rectangles in a 0..1 box, so it scales to any canvas size.
// Coordinates are deliberately chunky: at 192 px a hairline serif turns to mud.
const STEM_W = 0.16;
const CROSS_H = 0.16;
const LEFT = 0.22;
const RIGHT = 1 - LEFT - STEM_W;
const TOP = 0.2;
const BOTTOM = 0.8;

function insideGlyph(u, v) {
  if (v < TOP || v > BOTTOM) return false;
  if (u >= LEFT && u <= LEFT + STEM_W) return true;
  if (u >= RIGHT && u <= RIGHT + STEM_W) return true;
  const crossTop = 0.5 - CROSS_H / 2;
  return v >= crossTop && v <= crossTop + CROSS_H && u >= LEFT && u <= RIGHT + STEM_W;
}

// `inset` shrinks the glyph towards the centre. Android may mask an icon down to
// a circle covering ~80% of the canvas, so the maskable variant keeps the mark
// well inside that.
function renderRGBA(size, inset) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = 1 - 2 * inset;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;
          // Map the canvas point back into the un-inset glyph box.
          const u = (px - inset) / scale;
          const v = (py - inset) / scale;
          if (u >= 0 && u <= 1 && v >= 0 && v <= 1 && insideGlyph(u, v)) hits++;
        }
      }
      const a = hits / (SS * SS); // coverage → anti-aliasing
      const o = (y * size + x) * 4;
      buf[o] = Math.round(BG[0] + (FG[0] - BG[0]) * a);
      buf[o + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * a);
      buf[o + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * a);
      buf[o + 3] = 255; // fully opaque: maskable icons must not be transparent
    }
  }
  return buf;
}

// ── PNG container ───────────────────────────────────────────────────────────
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
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = truecolour with alpha
  // 10..12 = compression 0, filter 0, interlace 0 — already zeroed

  // Each scanline is prefixed with its filter byte. Filter 0 (None) keeps this
  // readable; deflate still compresses these flat fills to almost nothing.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Cheap self-check: a malformed header here would show up as a silently broken
// install prompt weeks later, which is a miserable thing to debug.
function assertValidPNG(png, size, name) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!png.subarray(0, 8).equals(sig)) throw new Error(`${name}: bad PNG signature`);
  if (png.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error(`${name}: first chunk is not IHDR`);
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size)
    throw new Error(`${name}: IHDR dimensions are not ${size}x${size}`);
}

const TARGETS = [
  { file: "icon-192.png", size: 192, inset: 0 },
  { file: "icon-512.png", size: 512, inset: 0 },
  { file: "icon-maskable-512.png", size: 512, inset: 0.2 },
  { file: "apple-touch-180.png", size: 180, inset: 0 },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, size, inset } of TARGETS) {
  const png = encodePNG(size, renderRGBA(size, inset));
  assertValidPNG(png, size, file);
  const path = join(OUT_DIR, file);
  writeFileSync(path, png);
  console.log(`${path}  ${size}x${size}  ${png.length} bytes`);
}
