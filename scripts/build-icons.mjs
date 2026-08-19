// Generate the app icons from one SVG.
//
//   npm i -D playwright && node scripts/build-icons.mjs
//
// Playwright is not a dependency and the output PNGs are committed — the icons
// change roughly never. Same reasoning as the openings index and board-check.
// (Chromium is the rasteriser because ImageMagick's SVG delegate is not
// installed everywhere, and a browser is the one renderer guaranteed to agree
// with what the phone will actually show.)
//
// Two shapes are produced because Android needs both:
//
//   icon-512        the plain mark, used where the platform draws no mask
//   icon-maskable   the same mark inside the 80% safe zone, for adaptive icons
//                   that get cropped to a circle, squircle or rounded square
//
// A maskable icon that ignores the safe zone gets its edges shaved off, which
// is why it is a separate file rather than the same one declared twice.

import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const INK = '#1a1a19';
const LIGHT = '#f2f1ee';
const ACCENT = '#1565c0';

/**
 * A knight, because it is the piece that moves where the others cannot — which
 * is the whole subject of the app — and because it is the one chess glyph that
 * is still legible at 48px.
 */
const KNIGHT =
	'M 46 78 C 46 66 52 58 62 52 C 56 50 52 46 52 40 L 46 44 L 42 36 L 52 30 ' +
	'C 54 22 60 16 70 16 C 84 16 94 26 94 42 C 94 62 82 68 74 74 C 70 77 68 80 68 84 ' +
	'L 46 84 Z';

function svg({ pad, bg }) {
	// pad is the fraction of the canvas left as margin on each side.
	const scale = 1 - pad * 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${bg === 'square' ? 0 : 96}" fill="${INK}"/>
  <g transform="translate(${512 * pad} ${512 * pad}) scale(${(512 * scale) / 110})">
    <!-- The drawing's own bounding box is x 40..94, y 16..93; the inner
         translate recentres it in the 110 box so the padding is even. -->
    <g transform="translate(-12 0.5)">
      <path d="${KNIGHT}" fill="${LIGHT}"/>
      <circle cx="82" cy="34" r="4" fill="${INK}"/>
      <rect x="40" y="84" width="54" height="9" rx="3" fill="${ACCENT}"/>
    </g>
  </g>
</svg>`;
}

const targets = [
	{ file: 'public/icon-512.png', size: 512, pad: 0.12, bg: 'rounded' },
	{ file: 'public/icon-192.png', size: 192, pad: 0.12, bg: 'rounded' },
	// Maskable: the mark sits inside the middle 80%, so cropping cannot clip it.
	{ file: 'public/icon-maskable-512.png', size: 512, pad: 0.22, bg: 'square' },
	{ file: 'public/apple-touch-icon.png', size: 180, pad: 0.12, bg: 'square' },
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const t of targets) {
	// Render at the target size directly rather than downscaling from 512: a
	// browser re-runs the vector at whatever size you give it, so 192px is a
	// fresh render rather than a resampled one.
	await page.setViewportSize({ width: t.size, height: t.size });
	await page.setContent(
		`<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${t.size}px;height:${t.size}px}</style>${svg(t)}`,
	);
	await page.screenshot({ path: t.file, omitBackground: true });
	console.log(`${t.file} (${t.size}px)`);
}

await browser.close();

writeFileSync('public/icon.svg', svg({ pad: 0.12, bg: 'rounded' }));
console.log('public/icon.svg');
