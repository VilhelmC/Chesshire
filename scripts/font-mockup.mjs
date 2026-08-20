// Render the same slice of the app in several typefaces, to look at.
//
//   npm i --no-save @fontsource-variable/inter @fontsource-variable/source-sans-3 \
//                   @fontsource-variable/ibm-plex-sans @fontsource/ibm-plex-mono
//   node scripts/font-mockup.mjs
//
// Throwaway. Nothing here ships; it exists so a choice about type is made by
// looking at type rather than by reading adjectives about it. The slice is
// chosen to include the things this app actually asks of a typeface: a heading,
// small grey explanatory text, tabular numbers in stat tiles, and move notation
// with piece glyphs, which is the one surface no generic UI font is designed
// for.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, '.shots');
mkdirSync(OUT, { recursive: true });

/** Inline the woff2 so the page needs no server and no network. */
function face(pkg, file) {
	const bytes = readFileSync(join(ROOT, 'node_modules', pkg, 'files', file));
	return `url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2')`;
}

const CANDIDATES = [
	{
		id: '1-system',
		name: 'System (what it is now)',
		css: '',
		stack: 'system-ui, -apple-system, sans-serif',
		note: 'Zero bytes. Segoe UI on Windows, Roboto on Android, SF on iOS — a different face per device.',
	},
	{
		id: '2-inter',
		name: 'Inter',
		css: `@font-face{font-family:'InterV';src:${face('@fontsource-variable/inter', 'inter-latin-wght-normal.woff2')};font-weight:100 900;font-display:swap}`,
		stack: "'InterV', system-ui, sans-serif",
		note: 'Large x-height, very even colour, designed for screens at small sizes. The safe modern default — and neutral to the point of anonymous.',
	},
	{
		id: '3-source-sans',
		name: 'Source Sans 3',
		css: `@font-face{font-family:'SourceSansV';src:${face('@fontsource-variable/source-sans-3', 'source-sans-3-latin-wght-normal.woff2')};font-weight:200 900;font-display:swap}`,
		stack: "'SourceSansV', system-ui, sans-serif",
		note: 'Humanist rather than geometric — slightly narrower, a little warmth in the letterforms. Reads as considered rather than corporate.',
	},
	{
		id: '4-plex',
		name: 'IBM Plex Sans',
		css: `@font-face{font-family:'PlexV';src:${face('@fontsource-variable/ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal.woff2')};font-weight:100 700;font-display:swap}@font-face{font-family:'PlexMono';src:${face('@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2')};font-weight:400;font-display:swap}`,
		stack: "'PlexV', system-ui, sans-serif",
		mono: "'PlexMono', ui-monospace, monospace",
		note: 'Has an accent — squared terminals, distinctive a and g. Ships with a matching mono, so notation and prose come from one family.',
	},
];

const SAMPLE = (stack, mono) => `
<div class="app" style="font-family:${stack}">
  <header><div class="mark"></div><div>
    <h1>Chesshire</h1>
    <p class="tag">Offbook trainer — drills what happens when the book runs out.</p>
  </div></header>

  <nav><b>Train</b><span>Mistakes</span><span>Progress</span><span>Settings</span></nav>

  <h2>Does it carry into your games?</h2>
  <p class="note">Every other number here measures how you do inside the app, which is circular.
  This compares mistakes per game before you first drilled a position with after.</p>

  <div class="tiles">
    <div class="tile"><span class="label">Book recall</span><span class="value">78%</span><span class="note">124 of 159 moves, first try</span></div>
    <div class="tile"><span class="label">Depth reached</span><span class="value">move 11</span><span class="note">deepest answered correctly</span></div>
    <div class="tile"><span class="label">Punish accuracy</span><span class="value">61%</span><span class="note">38 of 62 refutations found</span></div>
  </div>

  <h2>Two knights defence</h2>
  <table class="moves" style="font-family:${mono ?? 'ui-monospace, monospace'}">
    <tr><td class="n">1.</td><td>♙e4</td><td>♟e5</td><td class="n">2.</td><td>♘f3</td><td>♞c6</td></tr>
    <tr><td class="n">3.</td><td>♗c4</td><td>♞f6</td><td class="n">4.</td><td>♘g5</td><td>♟d5</td></tr>
    <tr><td class="n">5.</td><td>♙exd5</td><td class="bad">♞xd5</td><td class="n">6.</td><td>♘xf7</td><td>♚xf7</td></tr>
  </table>
  <p class="note">5…♞xd5 — the mistake you were asked to punish. 1,847 games at your band.</p>
</div>`;

const PAGE = (c) => `<!doctype html><meta charset="utf-8"><style>
${c.css}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#1a1a19;-webkit-font-smoothing:antialiased}
.wrap{padding:20px}
.name{font:600 13px system-ui;color:#8a8884;margin-bottom:2px}
.why{font:400 12px system-ui;color:#52514e;margin-bottom:14px;max-width:560px;line-height:1.5}
.app{width:393px;border:1px solid #e6e5e2;border-radius:10px;padding:14px}
header{display:flex;gap:10px;align-items:center;margin-bottom:10px}
.mark{width:34px;height:34px;border-radius:7px;background:#1a1a19;flex:none}
h1{margin:0;font-size:24px;font-weight:700;letter-spacing:-0.01em}
.tag{margin:2px 0 0;font-size:12px;color:#52514e}
nav{display:flex;gap:14px;border-bottom:1px solid #e6e5e2;padding-bottom:8px;margin-bottom:14px;font-size:15px;color:#52514e}
nav b{color:#1565c0}
h2{font-size:16px;margin:0 0 4px}
.note{font-size:12px;color:#52514e;line-height:1.5;margin:0 0 10px}
.tiles{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px}
.tile{border:1px solid #e6e5e2;border-radius:8px;padding:8px;background:#faf9f7;display:flex;flex-direction:column}
.label{font-size:12px;color:#52514e}
.value{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}
.tile .note{font-size:11px;margin:0}
.moves{border-collapse:collapse;font-size:13px;margin-bottom:8px}
.moves td{padding:3px 8px 3px 0}
.moves .n{color:#8a8884;text-align:right;font-variant-numeric:tabular-nums}
.moves .bad{border-bottom:2px solid #c62828}
</style>
<div class="wrap">
  <div class="name">${c.name}</div>
  <div class="why">${c.note}</div>
  ${SAMPLE(c.stack, c.mono)}
</div>`;

const browser = await chromium.launch(
	process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 440, height: 760 }, deviceScaleFactor: 2 });

for (const c of CANDIDATES) {
	await page.setContent(PAGE(c));
	await page.waitForTimeout(400);
	const file = join(OUT, `font-${c.id}.png`);
	await page.screenshot({ path: file, fullPage: true });
	console.log(file);
}

await browser.close();

// Sizes, because a typeface has a download cost and it should be part of the choice.
for (const [label, pkg, file] of [
	['Inter', '@fontsource-variable/inter', 'inter-latin-wght-normal.woff2'],
	['Source Sans 3', '@fontsource-variable/source-sans-3', 'source-sans-3-latin-wght-normal.woff2'],
	['IBM Plex Sans', '@fontsource-variable/ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal.woff2'],
	['IBM Plex Mono', '@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2'],
]) {
	const kb = Math.round(readFileSync(join(ROOT, 'node_modules', pkg, 'files', file)).length / 1024);
	console.log(`${label}: ${kb}KB (latin subset, woff2)`);
}

writeFileSync(join(OUT, 'README.txt'), 'Throwaway font mockups — see scripts/font-mockup.mjs\n');
