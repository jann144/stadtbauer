// Zeichnet das App-Symbol (kleine Skyline) und schreibt es als PNG in mehreren Größen nach public/.
// Aufruf: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZES = [180, 192, 512];
/** Jeder Bildpunkt wird aus so vielen Proben je Richtung gemittelt (glättet die Kanten). */
const SAMPLES = 3;

const SKY_TOP = [79, 163, 232];
const SKY_BOTTOM = [186, 224, 247];
const GRASS = [86, 148, 70];
const ROAD = [59, 62, 68];
const LINE = [230, 201, 100];
const WINDOW = [255, 236, 170];

// Gebäude: linke und rechte Kante, Oberkante (0 = oben, 1 = unten) und Farbe.
const HORIZON = 0.7;
const BUILDINGS = [
  { left: 0.16, right: 0.3, top: 0.42, color: [112, 128, 148] },
  { left: 0.31, right: 0.47, top: 0.24, color: [72, 92, 122] },
  { left: 0.48, right: 0.6, top: 0.36, color: [140, 152, 166] },
  { left: 0.61, right: 0.72, top: 0.17, color: [58, 76, 104] },
  { left: 0.73, right: 0.85, top: 0.46, color: [118, 134, 152] },
];

function mix(a, b, t) {
  return a.map((value, i) => value + (b[i] - value) * t);
}

/** Farbe an der Stelle (u, v), beide von 0 bis 1. */
function colorAt(u, v) {
  if (v >= 0.8 && v < 0.92) {
    const dashed = Math.abs(v - 0.86) < 0.008 && Math.floor(u * 10) % 2 === 0;
    return dashed ? LINE : ROAD;
  }
  if (v >= HORIZON) return GRASS;
  for (const building of BUILDINGS) {
    if (u < building.left || u >= building.right || v < building.top) continue;
    // Fensterraster mit Rand zur Gebäudekante.
    const column = (u - building.left) / 0.035;
    const row = (v - building.top) / 0.05;
    const inColumn = column % 1 > 0.3 && column % 1 < 0.75 && u < building.right - 0.012;
    const inRow = row % 1 > 0.35 && row % 1 < 0.75 && v < HORIZON - 0.03;
    return inColumn && inRow ? WINDOW : building.color;
  }
  return mix(SKY_TOP, SKY_BOTTOM, v / HORIZON);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const color = colorAt((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size);
          for (let i = 0; i < 3; i++) sum[i] += color[i];
        }
      }
      const offset = y * stride + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[offset + i] = Math.round(sum[i] / (SAMPLES * SAMPLES));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // Bit je Farbkanal
  header[9] = 2; // RGB ohne Transparenz
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
for (const size of SIZES) {
  writeFileSync(`public/icon-${size}.png`, png(size));
  console.log(`public/icon-${size}.png`);
}
