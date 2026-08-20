// Where the app is served from, and how to build a URL under it.
//
// GitHub Pages serves a project site at /<repo>/, not at the origin root. Vite
// rewrites the asset URLs it can see — the ones in index.html and in imports —
// but a path held in a config object as a plain string is invisible to it and
// ships unchanged. A root-absolute '/engine/x.js' then resolves to
// https://host/engine/x.js, one directory above the app, and 404s.
//
// That is exactly how the Stockfish worker broke on the first deploy: the
// worker URL 404'd, the worker never answered, and the app reported it as
// "Engine timeout waiting for uciok" — the symptom being a timeout rather than
// a missing file is what made it look like a WASM problem instead of a path
// problem.
//
// So: no root-absolute paths to our own assets anywhere. Build them here.

/** Trailing-slash base path the app is served under: '/' or '/Schackal/'. */
export const BASE: string = import.meta.env.BASE_URL || '/';

/**
 * A URL for one of our own files in `public/`.
 *
 * @param path relative to the app root, WITHOUT a leading slash
 *             (`engine/stockfish.js`, not `/engine/stockfish.js`)
 */
export function assetUrl(path: string): string {
	return BASE + path.replace(/^\/+/, '');
}
