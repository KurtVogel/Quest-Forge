/**
 * Generate the PWA icon set into public/icons/ with zero dependencies
 * (raw PNG chunks + zlib). Rerun after changing the palette or geometry:
 *   node scripts/generate-pwa-icons.mjs
 *
 * The mark is a gold gem/diamond on the app's dark slate — simple enough to
 * read at 48px and safe inside every launcher mask at the maskable padding.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [0x17, 0x17, 0x1f];       // app slate
const GOLD = [0xc9, 0xa2, 0x27];     // accent gold
const GOLD_DEEP = [0x8a, 0x6d, 0x12];
const INNER = [0x24, 0x24, 0x30];

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let c = 0xffffffff;
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type RGBA
    // Raw scanlines, filter byte 0 per row.
    const raw = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y++) {
        const rowStart = y * (size * 4 + 1);
        raw[rowStart] = 0;
        rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** Gem mark: outer gold diamond, dark core, small gold heart. `scale` shrinks it for maskable safe zones. */
function drawIcon(size, { scale = 1 } = {}) {
    const rgba = Buffer.alloc(size * size * 4);
    const center = (size - 1) / 2;
    const outer = center * 0.72 * scale;
    const core = outer * 0.66;
    const heart = outer * 0.26;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const d = Math.abs(x - center) + Math.abs(y - center);
            let color = BG;
            if (d <= outer) color = d >= outer - Math.max(2, size * 0.015) ? GOLD_DEEP : GOLD;
            if (d <= core) color = INNER;
            if (d <= heart) color = GOLD;
            const i = (y * size + x) * 4;
            rgba[i] = color[0];
            rgba[i + 1] = color[1];
            rgba[i + 2] = color[2];
            rgba[i + 3] = 255;
        }
    }
    return encodePng(size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'icon-192.png'), drawIcon(192));
writeFileSync(join(OUT_DIR, 'icon-512.png'), drawIcon(512));
writeFileSync(join(OUT_DIR, 'icon-maskable-512.png'), drawIcon(512, { scale: 0.72 }));
writeFileSync(join(OUT_DIR, 'apple-touch-icon.png'), drawIcon(180));
console.log(`PWA icons written to ${OUT_DIR}`);
