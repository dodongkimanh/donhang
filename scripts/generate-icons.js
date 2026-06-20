/**
 * Generate PWA PNG icons from SVG.
 *
 * Usage: Open generate-icons.html in a browser,
 * or use an online SVG-to-PNG converter with the SVG files in public/
 *
 * Required sizes: 192x192 and 512x512
 */

import { readFileSync, writeFileSync } from 'fs';

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

function createSvg(size, maskable = false) {
  const rx = maskable ? 0 : Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.41);
  const y = Math.round(size * 0.645);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="#2563EB"/>
  <text x="${size/2}" y="${y}" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="bold" fill="white" text-anchor="middle" letter-spacing="${Math.round(size * 0.01)}">KA</text>
</svg>`;
}

for (const size of sizes) {
  writeFileSync(`public/icon-${size}.svg`, createSvg(size));
  console.log(`Created icon-${size}.svg`);
}

writeFileSync('public/icon-maskable-512.svg', createSvg(512, true));
console.log('Created icon-maskable-512.svg');
console.log('\nTo generate PNG versions, use: https://svgtopng.com/ or similar tool');
