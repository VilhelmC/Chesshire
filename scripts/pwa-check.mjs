// Does the installable app actually install, and does it actually work offline?
//
//   npm run build && node scripts/pwa-check.mjs
//
// Run against `vite preview` on localhost, because localhost is a secure
// context and a LAN address is not — the service worker will not register at
// all over http://192.168.x.x, so testing there proves nothing either way.
//
// The offline leg is the point. A manifest that parses and a worker that
// registers are both easy to get right and neither one means the app opens
// with the network off.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4173;
const HOST = `http://localhost:${PORT}`;
// Set BASE_PATH to check the subpath deploy — `BASE_PATH=/Schackal/` is what
// GitHub Pages actually serves, and it is a different code path for every URL
// in the app. Vite preview honours the same config value the build used.
const BASE = process.env.BASE_PATH ?? '/';
// Always with the trailing slash: without it a subpath deploy 404s rather
// than redirecting, and the failure looks like a broken build.
const ORIGIN = HOST + BASE;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
	stdio: ['ignore', 'pipe', 'pipe'],
	env: process.env,
});

const failures = [];
function check(name, ok, detail = '') {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
	if (!ok) failures.push(name);
}

await waitForServer();

// PLAYWRIGHT_CHROMIUM lets a sandbox point at a browser it already has,
// rather than downloading one. Unset everywhere else, so this is a no-op.
const browser = await chromium.launch(
	process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const context = await browser.newContext();
const page = await context.newPage();

try {
	await page.goto(ORIGIN, { waitUntil: 'load' });

	// --- manifest -------------------------------------------------------
	const manifestHref = await page.getAttribute('link[rel=manifest]', 'href');
	check('manifest is linked', !!manifestHref, manifestHref ?? '');

	const manifestURL = new URL(manifestHref, ORIGIN);
	const manifest = await (await context.request.get(manifestURL.href)).json();
	check('manifest has a name', !!manifest.name, manifest.name);
	check('display is standalone', manifest.display === 'standalone', manifest.display);
	// Relative, so the app survives being served from a subpath. Absolute '/'
	// here would silently point outside a GitHub Pages deploy.
	check(
		'start_url resolves to the app root',
		new URL(manifest.start_url, manifestURL).href === ORIGIN,
		manifest.start_url,
	);

	const maskable = manifest.icons.filter((i) => String(i.purpose).includes('maskable'));
	check('has a maskable icon', maskable.length > 0);
	check(
		'has a 512px any-purpose icon',
		manifest.icons.some((i) => i.sizes === '512x512' && String(i.purpose).includes('any')),
	);

	for (const icon of manifest.icons) {
		const res = await context.request.get(new URL(icon.src, manifestURL).href);
		check(`icon ${icon.src} exists`, res.ok(), String(res.status()));
	}

	// --- service worker -------------------------------------------------
	const controlled = await page.evaluate(async () => {
		const reg = await navigator.serviceWorker.ready;
		// `ready` resolves on activation; controlling this page takes clients.claim
		// or one more navigation.
		return { scope: reg.scope, active: reg.active?.state ?? null };
	});
	check('service worker activates', controlled.active === 'activated', controlled.active ?? 'none');
	check('scope covers the app', controlled.scope === ORIGIN, controlled.scope);

	// A reload so the worker is unambiguously in control of the document.
	await page.reload({ waitUntil: 'load' });
	const isControlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
	check('worker controls the page', isControlled);

	// The app itself rendered, not just an empty shell.
	await page.waitForSelector('nav button', { timeout: 10_000 });

	// --- offline --------------------------------------------------------
	await context.setOffline(true);
	await page.reload({ waitUntil: 'load' });
	const tabs = await page.$$eval('nav button', (bs) => bs.map((b) => b.textContent?.trim()));
	check('app boots with the network off', tabs.includes('Mistakes'), `${tabs.length} tabs`);

	// And the deck it claims to work on offline is reachable.
	const mistakes = page.locator('nav button', { hasText: 'Mistakes' });
	await mistakes.click();
	await page.waitForTimeout(500);
	const bodyText = (await page.textContent('body')) ?? '';
	check('Mistakes tab renders offline', bodyText.length > 200, `${bodyText.length} chars`);

	await context.setOffline(false);
} finally {
	await browser.close();
	server.kill();
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);

async function waitForServer() {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(ORIGIN);
			if (res.ok) return;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error('vite preview did not start');
}
