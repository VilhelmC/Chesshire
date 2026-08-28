// `process` is a Node global, and tsconfig sets an explicit `types` array,
// which switches OFF automatic inclusion of every @types package. Without this
// line the config only typechecks because vite's own index.d.ts happens to
// reference node types — borrowing a dependency's internals to compile our own
// file. Declared here so it is ours.
/// <reference types="node" />
// Vitest reads THIS file rather than a vitest.config.ts of its own, so the test
// run keeps the react plugin and everything else configured here. A separate
// config would silently drop them.
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
	// GitHub Pages serves the repo at /Schackal/, not at the origin root, so the
	// built asset URLs have to be prefixed. Set by the deploy workflow rather
	// than hardcoded: locally, and on any host that serves from the root, the
	// prefix must stay '/' or nothing loads.
	//
	// The manifest, the service worker and its registration all derive their own
	// base rather than assuming '/', so this is the only place the path lives.
	base: process.env.BASE_PATH ?? '/',
	plugins: [react()],
	server: {
		port: 5173,
		// Listen on every interface, so the dev server is reachable from a phone
		// on the same wifi. Set here rather than left to `npm run dev -- --host`:
		// npm eats the forwarded flag ("Unknown cli config") and vite starts on
		// localhost anyway, which looks from the phone like the site is down.
		host: true,
		// Fail rather than fall forward to 5174. localStorage is per-origin, so a
		// different port is a different app: the Lichess token and the practice
		// settings both silently vanish. That cost an hour once already.
		strictPort: true,
		// Hot reload talks over a WebSocket, and some browser configurations will
		// not open one to localhost even though they load the page over HTTP from
		// the same origin. Firefox's HTTPS-Only Mode is the usual culprit — it
		// upgrades `ws://` to `wss://`, the dev server speaks neither TLS nor
		// disappointment, and the console fills with "can't establish a connection
		// to ws://localhost:5173". A proxy without a localhost bypass does the same.
		//
		// Neither is fixable from here, but neither is worth reading past on every
		// reload either, so `HMR=off npm run dev` turns hot reload off cleanly:
		// edits then need a manual refresh, and the console stays quiet.
		//
		// To keep hot reload, the browser side is where it is fixed: allow HTTP for
		// localhost (Firefox: Settings > Privacy & Security > HTTPS-Only Mode >
		// Manage Exceptions, add http://localhost), or exclude localhost from the
		// proxy.
		hmr: process.env.HMR === 'off' ? false : undefined,
		// NOTE: we deliberately do NOT set COOP/COEP headers.
		// The single-threaded Stockfish build does not need SharedArrayBuffer,
		// and setting COEP: require-corp would break cross-origin fetches to
		// explorer.lichess.ovh and lichess.org. See SPEC.md §8.
	},
	build: {
		target: 'es2022',
	},
	worker: {
		format: 'es',
	},
	test: {
		// ATTIC IS NOT PART OF THE BUILD OR THE SUITE.
		//
		// Retired code moves to `attic/` rather than being deleted — see
		// offbook/AMEND-ARCHIVE-NOT-DELETE.md. `tsconfig.json` already excludes it
		// by including only ["src", "test", "vite.config.ts"], so archived modules
		// are not typechecked and their imports may dangle. Vitest has no such
		// luck: its default include is `**/*.{test,spec}.*` from the project root,
		// which would pick up archived tests and run them against code that is no
		// longer wired to anything.
		//
		// Listing the defaults explicitly rather than spreading `configDefaults`
		// from 'vitest/config', so this file keeps importing from 'vite' alone and
		// the production build does not depend on vitest being installed.
		exclude: ['**/node_modules/**', '**/dist/**', 'attic/**'],
	},
});
