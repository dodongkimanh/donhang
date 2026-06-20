import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '../public');

const svg = readFileSync(resolve(publicDir, 'ka.svg'), 'utf-8');

const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];

function makeSvg(size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#2563EB"/>
  <text x="${size / 2}" y="${Math.round(size * 0.645)}" font-family="Arial,sans-serif" font-size="${Math.round(size * 0.41)}" font-weight="bold" fill="white" text-anchor="middle">KA</text>
</svg>`);
}

function makeMaskableSvg(size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="#2563EB"/>
  <text x="${size / 2}" y="${Math.round(size * 0.63)}" font-family="Arial,sans-serif" font-size="${Math.round(size * 0.37)}" font-weight="bold" fill="white" text-anchor="middle">KA</text>
</svg>`);
}

for (const size of sizes) {
  await sharp(makeSvg(size))
    .resize(size, size)
    .png()
    .toFile(resolve(publicDir, `icon-${size}.png`));
  console.log(`Created icon-${size}.png`);
}

await sharp(makeMaskableSvg(512))
  .resize(512, 512)
  .png()
  .toFile(resolve(publicDir, 'icon-maskable-512.png'));
console.log('Created icon-maskable-512.png');

console.log('\nAll PNG icons generated!');
