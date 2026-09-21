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
import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * WHICH BUILD IS THIS, AND WHEN WAS IT MADE.
 *
 * ---------------------------------------------------------------------------
 * Will: "how do I know if the saved page / app updated?" and, later, "where can
 * I see the version stamp? Maybe there should be version and last updated info
 * somewhere?"
 *
 * There was no answer to the first question, which is why it kept being asked.
 * The deploy script prints the commit it is publishing and writes it into the
 * gh-pages COMMIT MESSAGE — visible on GitHub, and nowhere in the running app.
 * So on a phone, with a service worker holding a cached shell, there was
 * genuinely no way to tell a stale install from a fresh one except by looking
 * for a feature and not finding it.
 *
 * Baked in at build time because that is the only moment the answer exists: the
 * running app has no repository to ask, and a deployed one has no server of its
 * own to ask either.
 *
 * `git` may legitimately be absent — a source tarball, a CI checkout without
 * history — so every read falls back rather than failing the build. An unknown
 * commit is worth saying; a build that will not run is not.
 */
function git(args: string[]): string {
	try {
		return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return '';
	}
}

const COMMIT = git(['rev-parse', '--short', 'HEAD']);
/*
 * Uncommitted changes mean the build does not correspond to any commit, and a
 * stamp that named one anyway would be the most misleading kind of accurate.
 * The deploy script makes the same distinction and prints the same `+dirty`.
 */
const DIRTY = git(['status', '--porcelain']).length > 0;
const COMMITTED_AT = git(['log', '-1', '--format=%cI']);

export default defineConfig({
	// GitHub Pages serves the repo at /Schackal/, not at the origin root, so the
	// built asset URLs have to be prefixed. Set by the deploy workflow rather
	// than hardcoded: locally, and on any host that serves from the root, the
	// prefix must stay '/' or nothing loads.
	//
	// The manifest, the service worker and its registration all derive their own
	// base rather than assuming '/', so this is the only place the path lives.
	base: process.env.BASE_PATH ?? '/',
	define: {
		__BUILD_COMMIT__: JSON.stringify(COMMIT),
		__BUILD_DIRTY__: JSON.stringify(DIRTY),
		__BUILD_AT__: JSON.stringify(new Date().toISOString()),
		__COMMIT_AT__: JSON.stringify(COMMITTED_AT),
	},
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
