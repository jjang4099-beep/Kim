#!/usr/bin/env node
/**
 * generate-icons.js — SJ 서재 PWA 아이콘 생성기
 *
 * 외부 패키지 없이 순수 Node.js (zlib) 로 PNG를 직접 생성합니다.
 * 아이콘은 파란 배경(#2563eb) + 책 이모지 레이아웃 (단색 PNG)
 *
 * 실행: node scripts/generate-icons.js
 * 출력: public/icons/icon-192.png
 *       public/icons/icon-512.png
 *       public/icons/apple-touch-icon.png  (180×180, iOS용)
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ══════════════════════════════════════
   CRC-32 구현 (PNG IHDR/IDAT 체크섬)
══════════════════════════════════════ */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) | 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf  = Buffer.alloc(4);
  const crcBuf  = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  crcBuf.writeInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/* ══════════════════════════════════════
   PNG 단색 이미지 생성 (RGB)
══════════════════════════════════════ */
function makeSolidPNG(width, height, r, g, b) {
  /* PNG 시그니처 */
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  /* IHDR: 13바이트 */
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 2; // color type: RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive
  ihdr[12] = 0; // interlace: none

  /* Raw scanlines: filter(1) + RGB(3×width) per row */
  const rowLen = 1 + width * 3;
  const raw    = Buffer.alloc(height * rowLen);
  for (let y = 0; y < height; y++) {
    const row = y * rowLen;
    raw[row] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 3;
      raw[p]     = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

/* ══════════════════════════════════════
   메인: 아이콘 생성
   테마 색상: #2563eb = RGB(37, 99, 235)
══════════════════════════════════════ */
const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BRAND_R = 37, BRAND_G = 99, BRAND_B = 235; // #2563eb

const icons = [
  { size: 192, name: 'icon-192.png',         note: 'Android Chrome PWA' },
  { size: 512, name: 'icon-512.png',         note: 'Splash screen'      },
  { size: 180, name: 'apple-touch-icon.png', note: 'iOS 홈 화면'         }
];

console.log('🎨 SJ 서재 PWA 아이콘 생성 중...\n');

icons.forEach(({ size, name, note }) => {
  const png  = makeSolidPNG(size, size, BRAND_R, BRAND_G, BRAND_B);
  const dest = path.join(OUT_DIR, name);
  fs.writeFileSync(dest, png);
  console.log(`  ✓ ${name.padEnd(26)} ${size}×${size}  ${(png.length / 1024).toFixed(1)}KB  (${note})`);
});

console.log('\n🎉 완료! public/icons/ 폴더를 git에 커밋하세요.');
console.log('   → git add public/icons/ && git commit -m "feat: PWA 아이콘 추가"');
