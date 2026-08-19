// Service worker. Hand-written, no workbox.
//
// WHY RUNTIME CACHING AND NOT A PRECACHE MANIFEST
//
// The usual PWA setup generates a list of every built file at build time and
// downloads all of it on first load. Vite content-hashes asset filenames, so
// that list can only be produced by a build plugin, and the list would include
// the 7MB Stockfish WASM — which most first visits never need. Instead the
// worker caches what is actually requested, the first time it is requested.
// The cost is that the FIRST offline load only has what you have already used;
// the benefit is that installing the app does not download 7MB over a phone
// connection to do it.
//
// STRATEGIES
//
//   HTML document   network-first  — so a deploy is picked up, not shadowed by
//                                    a cached shell that never expires
//   hashed assets   cache-first    — the hash IS the version; if the name
//                                    matches, the bytes match
//   everything else network-first with a cache fallback
//
// WHAT IS HONESTLY NOT OFFLINE
//
// Train needs the Lichess explorer to know the book, and cloud eval to judge a
// move. Offline you get the Mistakes deck, Progress, Review, and any position
// already in the explorer cache — which is real, but it is not the whole app.
// The UI says so rather than letting you discover it mid-drill.

const VERSION = 'v1';
const SHELL = `offbook-shell-${VERSION}`;
const ASSETS = `offbook-assets-${VERSION}`;

/**
 * Where the app lives. Taken from the worker's own scope rather than hardcoded
 * as '/', so a deploy under a subpath (GitHub Pages serves /<repo>/) works
 * without a second set of paths to keep in step.
 */
const BASE = new URL('./', self.registration.scope).pathname;

/** Files worth having before they are asked for: small, and needed by every load. */
const SEED = ['', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'].map((f) => BASE + f);

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(SHELL);
			// Individually, and tolerantly: one 404 in addAll rejects the whole
			// install and leaves the app with no worker at all.
			await Promise.all(
				SEED.map((url) => cache.add(url).catch(() => undefined)),
			);
			// Deliberately NOT skipWaiting() here. A new worker that takes over
			// the moment it downloads swaps the code under a drill in progress
			// and reloads the page to do it. It waits instead, the app offers
			// "reload to update", and the message handler below is what actually
			// switches — so the reload happens when you asked for it.
		})(),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keep = new Set([SHELL, ASSETS]);
			for (const key of await caches.keys()) {
				if (key.startsWith('offbook-') && !keep.has(key)) await caches.delete(key);
			}
			await self.clients.claim();
		})(),
	);
});

self.addEventListener('message', (event) => {
	if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;

	const url = new URL(req.url);

	// Only our own origin. Lichess, the explorer and cloud eval are deliberately
	// untouched: caching an evaluation behind the app's back would show you a
	// stale number with no way to tell.
	if (url.origin !== self.location.origin) return;

	if (req.mode === 'navigate') {
		event.respondWith(networkFirst(req, SHELL, BASE));
		return;
	}

	if (isVersioned(url.pathname)) {
		event.respondWith(cacheFirst(req, ASSETS));
		return;
	}

	event.respondWith(networkFirst(req, ASSETS));
});

/**
 * A filename that carries its own version.
 *
 * Vite writes `index-a1b2c3d4.js`; the engine files under /engine/ are copied
 * verbatim and do not, but they are large, immutable in practice, and the thing
 * you most want cached — so they are treated the same way and invalidated by
 * bumping VERSION.
 */
function isVersioned(pathname) {
	return /-[A-Za-z0-9_]{8,}\.[a-z0-9]+$/.test(pathname) || pathname.startsWith(BASE + 'engine/');
}

async function cacheFirst(req, cacheName) {
	const cache = await caches.open(cacheName);
	const hit = await cache.match(req);
	if (hit) return hit;
	const res = await fetch(req);
	if (res.ok) cache.put(req, res.clone());
	return res;
}

async function networkFirst(req, cacheName, fallbackKey) {
	const cache = await caches.open(cacheName);
	try {
		const res = await fetch(req);
		if (res.ok) cache.put(req, res.clone());
		return res;
	} catch (err) {
		const hit = (await cache.match(req)) || (fallbackKey && (await cache.match(fallbackKey)));
		if (hit) return hit;
		throw err;
	}
}
