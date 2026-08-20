// Generate the app icons from one drawing.
//
//   npm i -D playwright && node scripts/build-icons.mjs
//
// Playwright is not a dependency and the output is committed — the icons change
// roughly never. Same reasoning as the openings index and board-check. Chromium
// is the rasteriser because it is the one renderer guaranteed to agree with
// what the phone will actually show.
//
// THE SOURCE
//
// assets/chesshire.svg — a Cheshire grin whose teeth are chessboard squares,
// drawn for this app. It lives in assets/ and NOT in dist/, which is generated
// output: `vite build` empties dist on every run and the deploy script clears
// the published branch, so anything kept there is deleted by the next command
// you type.
//
// Two shapes are produced because Android needs both:
//
//   icon-512        the plain mark, used where the platform draws no mask
//   icon-maskable   the same mark inside the 80% safe zone, for adaptive icons
//                   that get cropped to a circle, squircle or rounded square
//
// A maskable icon that ignores the safe zone gets its edges shaved off, which
// is why it is a separate file rather than the same one declared twice.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const INK = '#1a1a19';
const LIGHT = '#f2f1ee';

const SOURCE = join(ROOT, 'assets', 'chesshire.svg');
const raw = readFileSync(SOURCE, 'utf8');

/** The drawing itself, without its own <svg> wrapper. */
const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
const viewBox = (raw.match(/viewBox="([^"]+)"/i) ?? [])[1];
if (!viewBox) throw new Error(`No viewBox in ${SOURCE}`);

const browser = await chromium.launch(
	process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const page = await browser.newPage();

// ---------------------------------------------------------------------------
// Measure the drawing's real extent.
//
// Padding a source by a guessed fraction pads its own margins along with it,
// and the maskable icon's safe zone then means whatever the artwork happened to
// leave around the edges. Asking the renderer for the bounding box makes the
// padding mean the same thing regardless of how the source was drawn.
// ---------------------------------------------------------------------------

await page.setContent(
	`<svg id="s" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><g id="art">${inner}</g></svg>`,
);
const box = await page.evaluate(() => {
	const g = document.getElementById('art');
	const b = g.getBBox();
	return { x: b.x, y: b.y, width: b.width, height: b.height };
});

/**
 * The finished icon as standalone SVG.
 *
 * `pad` is the fraction of the canvas left as margin on each side, applied to
 * the MEASURED drawing rather than to the source's own coordinate box.
 */
function icon({ pad, shape, ink = INK, mark = LIGHT }) {
	const S = 512;
	const inset = S * pad;
	const avail = S - inset * 2;
	const scale = Math.min(avail / box.width, avail / box.height);
	// Centre what is left over, so the mark sits in the middle of the tile even
	// when it is wider than it is tall.
	const dx = inset + (avail - box.width * scale) / 2 - box.x * scale;
	const dy = inset + (avail - box.height * scale) / 2 - box.y * scale;

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <style>
    /* The drawing is black on nothing. A CSS rule beats the fill="#000000"
       presentation attribute on every path, so the artwork is recoloured
       without being edited — the source file stays exactly as drawn. */
    #art path, #art polygon, #art circle, #art rect { fill: ${mark}; stroke: none; }
  </style>
  <rect width="${S}" height="${S}" rx="${shape === 'square' ? 0 : 96}" fill="${ink}"/>
  <g id="art" transform="translate(${dx.toFixed(3)} ${dy.toFixed(3)}) scale(${scale.toFixed(5)})">${inner}</g>
</svg>`;
}

const targets = [
	{ file: 'public/icon-512.png', size: 512, pad: 0.1, shape: 'rounded' },
	{ file: 'public/icon-192.png', size: 192, pad: 0.1, shape: 'rounded' },
	// Maskable: the safe zone is the middle 80%, so the padding only has to
	// exceed 10% on each side. 15% leaves a margin of error for the more
	// aggressive launcher masks without shrinking the mark to a speck, which is
	// the other way to fail this.
	{ file: 'public/icon-maskable-512.png', size: 512, pad: 0.15, shape: 'square' },
	{ file: 'public/apple-touch-icon.png', size: 180, pad: 0.1, shape: 'square' },
];

for (const t of targets) {
	// Rendered at the target size rather than downscaled from 512: a browser
	// re-runs the vector at whatever size it is given, so 192px is a fresh
	// render rather than a resampled one.
	await page.setViewportSize({ width: t.size, height: t.size });
	await page.setContent(
		`<style>html,body{margin:0;padding:0}svg{display:block;width:${t.size}px;height:${t.size}px}</style>` +
			icon(t),
	);
	await page.screenshot({ path: join(ROOT, t.file), omitBackground: true });
	console.log(`${t.file} (${t.size}px)`);
}

// The favicon and the manifest's scalable entry. Genuinely vector, because the
// source is.
writeFileSync(join(ROOT, 'public/icon.svg'), icon({ pad: 0.1, shape: 'rounded' }));
console.log('public/icon.svg');

await browser.close();
