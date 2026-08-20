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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4173;
const HOST = `http://localhost:${PORT}`;
// Set BASE_PATH to check the subpath deploy — `BASE_PATH=/Chesshire/` is what
// GitHub Pages actually serves, and it is a different code path for every URL
// in the app. Vite preview honours the same config value the build used.
const BASE = process.env.BASE_PATH ?? '/';
// Always with the trailing slash: without it a subpath deploy 404s rather
// than redirecting, and the failure looks like a broken build.
const ORIGIN = HOST + BASE;

// Vite's own entry, not `npx vite`. npx wraps the real server in a launcher
// process; killing the wrapper leaves the server holding the port, so the next
// run silently measures the PREVIOUS build. That produced two wrong answers
// before it was noticed, which is the worst kind of test infrastructure bug —
// it does not fail, it lies.
const VITE = join(
	dirname(dirname(fileURLToPath(import.meta.url))),
	'node_modules',
	'vite',
	'bin',
	'vite.js',
);
const server = spawn(process.execPath, [VITE, 'preview', '--port', String(PORT), '--strictPort'], {
	stdio: ['ignore', 'pipe', 'pipe'],
	env: process.env,
});

const failures = [];
function check(name, ok, detail = '') {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
	if (!ok) failures.push(name);
}

// A preview server left behind by an earlier run answers on the same port and
// serves a DIFFERENT build — which looks like the app being broken rather than
// the check pointing at the wrong thing. Refuse to start instead of guessing.
if (await isUp()) {
	server.kill();
	throw new Error(`Something is already listening on ${PORT}. Stop it and re-run.`);
}
process.on('exit', () => server.kill());
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

	// --- the engine actually loads --------------------------------------
	//
	// This is the check that was missing. The manifest parsed, the worker
	// registered, the app booted offline — and Stockfish 404'd on every page,
	// because its URL was root-absolute and the app is served from a subpath.
	// Asserting the app "loads" says nothing about whether the app WORKS.
	const engine = await page.evaluate(async (base) => {
		// The URL the APP resolves, read from its debug dump, not one this script
		// recomputes. A check that derives the path the same way the app does
		// would have agreed with the bug and passed.
		const dump = await window.schackal?.collect?.();
		// Providers are collected under `views`; see src/data/debug.ts.
		const url = dump?.views?.engine?.workerUrl;
		if (!url) {
			// Not a pass. If the app cannot say where it loads the engine from,
			// this check has nothing to check and must say so.
			return { ok: false, url: '(none)', why: 'app did not report an engine URL' };
		}
		const head = await fetch(url, { method: 'GET' });
		if (!head.ok) return { ok: false, url, why: `HTTP ${head.status}` };
		return await new Promise((resolve) => {
			let w;
			const done = (r) => {
				try {
					w?.terminate();
				} catch {
					/* already gone */
				}
				resolve(r);
			};
			const timer = setTimeout(() => done({ ok: false, url, why: 'no uciok in 30s' }), 30_000);
			try {
				w = new Worker(url);
			} catch (e) {
				clearTimeout(timer);
				return done({ ok: false, url, why: String(e) });
			}
			w.onerror = (e) => {
				clearTimeout(timer);
				done({ ok: false, url, why: e.message || 'worker error' });
			};
			w.onmessage = (e) => {
				const text = typeof e.data === 'string' ? e.data : String(e.data?.data ?? '');
				if (text.includes('uciok')) {
					clearTimeout(timer);
					done({ ok: true, url });
				}
			};
			w.postMessage('uci');
		});
	}, BASE);
	check('Stockfish loads and answers uciok', engine.ok, engine.why ?? engine.url);

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

	// --- sign in with Lichess -------------------------------------------
	//
	// The entry point for every user who is not the author: without a token the
	// explorer 401s and Train cannot check a single move. The redirect cannot be
	// followed from here, so it is intercepted and its parameters inspected —
	// which is the part that has to be right anyway.
	//
	// In its OWN context, and last. Playwright's request interception and the
	// service worker do not coexist happily: registering a route on the main
	// page made the later offline reload fail with ERR_INTERNET_DISCONNECTED,
	// because the worker was no longer serving it. Isolating the interception
	// keeps the offline result meaning what it says.
	const authCtx = await browser.newContext();
	const authPage = await authCtx.newPage();
	let authorizeUrl = null;
	await authPage.route('https://lichess.org/oauth**', (route) => {
		authorizeUrl = route.request().url();
		return route.abort();
	});
	try {
		await authPage.goto(ORIGIN, { waitUntil: 'load' });
		await authPage.locator('nav button', { hasText: 'Settings' }).click();
		const signInButton = authPage.locator('button', { hasText: 'Sign in with Lichess' }).first();
		check('sign-in button is offered', (await signInButton.count()) > 0);

		if (await signInButton.count()) {
			await signInButton.click();
			await authPage.waitForTimeout(1500);
			check('sign-in redirects to Lichess', !!authorizeUrl, authorizeUrl ? '' : 'no navigation');

			if (authorizeUrl) {
				const q = new URL(authorizeUrl).searchParams;
				check('uses the authorization code flow', q.get('response_type') === 'code');
				// S256 is the only method Lichess accepts; `plain` would be refused.
				check('challenge method is S256', q.get('code_challenge_method') === 'S256');
				check('sends a challenge', (q.get('code_challenge') ?? '').length >= 43);
				check('sends a state', (q.get('state') ?? '').length >= 43);
				// The redirect must come back to the app, subpath included, or the
				// exchange is refused for a mismatch.
				check(
					'redirect_uri points at the app',
					q.get('redirect_uri') === ORIGIN,
					q.get('redirect_uri') ?? '',
				);
				// No scopes: the app cannot act on the account, and the consent
				// screen should say so by being empty.
				check('asks for no scopes', !q.get('scope'), q.get('scope') ?? '(none)');
			}
		}
	} finally {
		await authCtx.close();
	}
} finally {
	await browser.close();
	server.kill();
}

console.log(failures.length ? `\n${failures.length} failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);

async function isUp() {
	try {
		await fetch(HOST + '/', { signal: AbortSignal.timeout(500) });
		return true;
	} catch {
		return false;
	}
}

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
