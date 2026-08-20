// Screenshot every tab, at a phone width and a desktop one.
//
//   npm run build && node scripts/shots.mjs
//
// Not an assertion — a way to LOOK. Layout regressions are invisible to a test
// suite that only knows the DOM parsed, and every layout bug in this project so
// far was found by someone opening the app rather than by anything automated.
// This makes opening it cheap.
//
// Output lands in .shots/ (gitignored).

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 4179;
const BASE = process.env.BASE_PATH ?? '/';
const ORIGIN = `http://localhost:${PORT}${BASE}`;
const OUT = join(ROOT, '.shots');

const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(process.execPath, [VITE, 'preview', '--port', String(PORT), '--strictPort'], {
	stdio: ['ignore', 'pipe', 'pipe'],
	env: process.env,
});
process.on('exit', () => server.kill());

for (let i = 0; i < 60; i++) {
	try {
		if ((await fetch(ORIGIN)).ok) break;
	} catch {
		/* not yet */
	}
	await new Promise((r) => setTimeout(r, 300));
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
	process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);

const SIZES = [
	{ name: 'phone', width: 393, height: 852 },
	{ name: 'desktop', width: 1280, height: 900 },
];
const TABS = (process.env.SHOT_TABS ?? 'Train,Mistakes,Progress,Settings').split(',');
// Dark is not a variant of the screenshots — it is half of them. A palette
// nobody looks at is a palette nobody has checked.
const SCHEMES = (process.env.SHOT_SCHEMES ?? 'light,dark').split(',');

for (const size of SIZES) {
	for (const scheme of SCHEMES) {
	const ctx = await browser.newContext({
		viewport: { width: size.width, height: size.height },
		deviceScaleFactor: 1,
		colorScheme: scheme,
	});
	const page = await ctx.newPage();
	await page.goto(ORIGIN, { waitUntil: 'load' });
	await page.waitForSelector('nav button');

	for (const tab of TABS) {
		await page.locator('nav button', { hasText: tab }).first().click();
		// Long enough for a board to size itself and a deck to load from IndexedDB.
		await page.waitForTimeout(1200);
		const file = join(OUT, `${size.name}-${scheme}-${tab.toLowerCase()}.png`);
		await page.screenshot({ path: file, fullPage: size.name === 'desktop' });
		console.log(file);
	}
	await ctx.close();
	}
}

await browser.close();
