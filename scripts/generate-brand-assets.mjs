/**
 * Renders the MegaBot mark (chat bubble + signal bars) into the PNG assets
 * required by app.json: app icon, Android adaptive icon layers, splash icon
 * and favicon. Dependency-free: signed-distance rendering + a tiny PNG encoder.
 *
 * Geometry mirrors src/components/brand/BrandMark.tsx — keep them in sync.
 *
 * Usage: npm run generate:assets
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets/images');
mkdirSync(out, { recursive: true });

const BRAND = [0xe6, 0x00, 0x00];
const WHITE = [0xff, 0xff, 0xff];

// ─── Signed distance functions (unit space: the tile is [0,1]²) ─────────────

function sdRoundedBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

function sdDiamond(px, py, cx, cy, half) {
  // A square of side 2*half rotated 45°.
  const c = Math.SQRT1_2;
  const dx = px - cx;
  const dy = py - cy;
  const rx = dx * c + dy * c;
  const ry = -dx * c + dy * c;
  return sdRoundedBox(rx, ry, 0, 0, half, half, 0.012);
}

// Same layout as BrandMark: a 0.54-tall bubble container (bubble + tail) centered
// with a -0.02 top margin → bubble top at 0.22; the tail square sits 0.025 above
// the container bottom (0.76).
const bubble = { left: 0.19, top: 0.22, width: 0.62, height: 0.46, radius: 0.13 };
const tail = { cx: 0.19 + 0.62 * 0.185 + 0.065, cy: 0.76 - 0.025 - 0.065, half: 0.065 };
const barWidth = 0.075;
const barGap = 0.05;
const barsBottom = bubble.top + bubble.height - bubble.height * 0.22;
const barsLeft = 0.5 - (3 * barWidth + 2 * barGap) / 2;
const bars = [0.32, 0.5, 0.68].map((ratio, i) => {
  const h = bubble.height * ratio;
  return { cx: barsLeft + i * (barWidth + barGap) + barWidth / 2, cy: barsBottom - h / 2, hw: barWidth / 2, hh: h / 2 };
});

function sdBubble(x, y) {
  const body = sdRoundedBox(
    x, y,
    bubble.left + bubble.width / 2, bubble.top + bubble.height / 2,
    bubble.width / 2, bubble.height / 2, bubble.radius
  );
  return Math.min(body, sdDiamond(x, y, tail.cx, tail.cy, tail.half));
}

function sdBars(x, y) {
  return Math.min(...bars.map((b) => sdRoundedBox(x, y, b.cx, b.cy, b.hw, b.hh, barWidth / 2)));
}

const coverage = (distance, pixel) => Math.max(0, Math.min(1, 0.5 - distance / pixel));

// ─── Rendering ──────────────────────────────────────────────────────────────

/**
 * @param size       output size in px
 * @param tileScale  size of the virtual tile relative to the canvas (for safe zones)
 * @param tile       'full' (square fill) | 'rounded' | 'none'
 * @param colors     { tile, bubble, bars } — bars may be null to punch holes
 */
function render(size, { tileScale = 1, tile = 'none', colors }) {
  const data = Buffer.alloc(size * size * 4);
  const offset = (1 - tileScale) / 2;
  const pixel = 1 / (size * tileScale);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Pixel center → tile space.
      const x = ((px + 0.5) / size - offset) / tileScale;
      const y = ((py + 0.5) / size - offset) / tileScale;

      let tileCov = 0;
      if (tile === 'full') tileCov = 1;
      else if (tile === 'rounded') tileCov = coverage(sdRoundedBox(x, y, 0.5, 0.5, 0.5, 0.5, 0.28), pixel);

      const bubbleCov = coverage(sdBubble(x, y), pixel);
      const barCov = coverage(sdBars(x, y), pixel);

      let r = 0, g = 0, b = 0, a = 0;
      const over = (color, alpha) => {
        // Porter-Duff "source over" in straight alpha.
        const outA = alpha + a * (1 - alpha);
        if (outA === 0) return;
        r = (color[0] * alpha + r * a * (1 - alpha)) / outA;
        g = (color[1] * alpha + g * a * (1 - alpha)) / outA;
        b = (color[2] * alpha + b * a * (1 - alpha)) / outA;
        a = outA;
      };

      if (tileCov > 0) over(colors.tile, tileCov);
      if (colors.bars) {
        over(colors.bubble, bubbleCov);
        over(colors.bars, bubbleCov * barCov);
      } else {
        // Bars are holes in the bubble (background shows through).
        over(colors.bubble, bubbleCov * (1 - barCov));
      }

      const i = (py * size + px) * 4;
      data[i] = Math.round(r);
      data[i + 1] = Math.round(g);
      data[i + 2] = Math.round(b);
      data[i + 3] = Math.round(a * 255);
    }
  }
  return data;
}

// ─── PNG encoding ───────────────────────────────────────────────────────────

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Assets ─────────────────────────────────────────────────────────────────

const assets = [
  // iOS / store icon: full-bleed brand square (the OS applies the corner mask).
  { file: 'icon.png', size: 1024, tile: 'full', colors: { tile: BRAND, bubble: WHITE, bars: BRAND } },
  // Android adaptive icon: red background comes from app.json; keep the mark in the 66% safe zone.
  { file: 'android-icon-foreground.png', size: 1024, tileScale: 0.667, colors: { bubble: WHITE, bars: null } },
  { file: 'android-icon-monochrome.png', size: 1024, tileScale: 0.667, colors: { bubble: WHITE, bars: null } },
  // Splash: white tile with red bubble on the red splash background (matches <AppSplash />).
  { file: 'splash-icon.png', size: 512, tile: 'rounded', colors: { tile: WHITE, bubble: BRAND, bars: WHITE } },
  { file: 'favicon.png', size: 64, tile: 'rounded', colors: { tile: BRAND, bubble: WHITE, bars: BRAND } },
];

for (const asset of assets) {
  const png = encodePng(asset.size, render(asset.size, asset));
  writeFileSync(join(out, asset.file), png);
  console.log(`✓ ${asset.file} (${asset.size}px, ${(png.length / 1024).toFixed(1)} KB)`);
}
