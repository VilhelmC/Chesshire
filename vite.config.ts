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
});
