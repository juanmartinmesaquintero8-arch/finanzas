// Genera los íconos PNG de la app a partir de un SVG simple (barras que suben sobre fondo verde).
// Uso: pnpm --filter @finanzas/mobile icons   (los PNG resultantes se guardan en el repo)
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const GREEN = '#0b6b4f';
const LIGHT = '#d9efe6';

/** `scale` encoge el dibujo para respetar la zona segura de los íconos "maskable". */
function svg({ rounded, scale }) {
  const bars = [
    { x: 150, h: 130 },
    { x: 237, h: 210 },
    { x: 324, h: 300 },
  ]
    .map((b) => `<rect x="${b.x}" y="${392 - b.h}" width="62" height="${b.h}" rx="14" fill="#fff"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="${GREEN}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    ${bars}
    <rect x="124" y="410" width="264" height="14" rx="7" fill="${LIGHT}"/>
  </g>
</svg>`;
}

const targets = [
  { file: 'icon-192.png', size: 192, rounded: true, scale: 1 },
  { file: 'icon-512.png', size: 512, rounded: true, scale: 1 },
  { file: 'icon-maskable-192.png', size: 192, rounded: false, scale: 0.78 },
  { file: 'icon-maskable-512.png', size: 512, rounded: false, scale: 0.78 },
];

for (const t of targets) {
  await sharp(Buffer.from(svg(t))).resize(t.size, t.size).png().toFile(join(outDir, t.file));
  console.log('listo', t.file);
}
