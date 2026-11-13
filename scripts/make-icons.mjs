// Génère l'icône de l'app et l'écran de chargement à partir du logo B1-a (seule source des tracés).
// Usage : SHARP_DIR=<dossier où sharp est installé> node scripts/make-icons.mjs
//   ex. npm i sharp --prefix /tmp/sharp && SHARP_DIR=/tmp/sharp node scripts/make-icons.mjs
// Écrit assets/icon.svg (source lisible) et les PNG de app/assets/.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(process.env.SHARP_DIR ?? root, 'node_modules', 'x.js'));
const sharp = require('sharp');

const BG = '#0B0D10';
const BLUE = '#60A5FA';
const VIOLET = '#A78BFA';

/** « SF » B1-a : la barre du haut du S se prolonge en barre du F et finit sur un point. Repère 64 × 64. */
function glyph({ mono = false, scale = 1 } = {}) {
  const stroke = mono ? '#FFFFFF' : 'url(#g)';
  const dot = mono ? '#FFFFFF' : VIOLET;
  const t = scale === 1 ? '' : ` transform="translate(32 32) scale(${scale}) translate(-32 -32)"`;
  return `<g${t}>
    <g fill="none" stroke="${stroke}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M48 20 H18.5 a6 6 0 0 0 0 12 h4 a6 6 0 0 1 0 12 H11"/>
      <path d="M37 20 V44"/><path d="M37 32 H45"/>
    </g>
    <circle cx="52.5" cy="20" r="4" fill="${dot}"/>
  </g>`;
}

// Dégradé en coordonnées absolues : un dégradé « boîte englobante » ne s'affiche pas sur un trait droit.
const defs = `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="10" y1="48" x2="54" y2="16">
  <stop offset="0" stop-color="${BLUE}"/><stop offset="1" stop-color="${VIOLET}"/></linearGradient></defs>`;
const svg = (body, bg = true) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}${bg ? `<rect width="64" height="64" fill="${BG}"/>` : ''}${body}</svg>`;

const icon = svg(glyph());
writeFileSync(join(root, 'assets', 'icon.svg'), icon + '\n');

// Icône adaptative Android : seul le cercle central (~66 %) est toujours visible → motif réduit à 80 %.
const outputs = [
  ['icon.png', icon, 1024],
  ['android-icon-foreground.png', svg(glyph({ scale: 0.8 }), false), 1024],
  ['android-icon-background.png', svg(''), 1024],
  ['android-icon-monochrome.png', svg(glyph({ mono: true, scale: 0.8 }), false), 1024],
  ['favicon.png', icon, 48],
  ['splash-icon.png', svg(glyph(), false), 1024],
];

for (const [name, source, size] of outputs) {
  const file = join(root, 'app', 'assets', name);
  await sharp(Buffer.from(source), { density: (72 * size) / 64 }).resize(size, size).png().toFile(file);
  const m = await sharp(file).metadata();
  console.log(`${name} ${m.width}×${m.height}${m.hasAlpha ? ' (transparent)' : ''}`);
}
