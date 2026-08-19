// Copies the single-threaded "lite" Stockfish WASM build into public/engine/
// so it can be loaded as a plain Worker with no SharedArrayBuffer / COOP+COEP
// requirement (see SPEC.md §8, "COOP/COEP gotcha").
//
// The full stockfish npm package is ~240 MB; we ship only the two files we
// need (~7 MB total). public/engine/ is gitignored.

import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dst = join(root, 'public', 'engine');

const FILES = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm'];

try {
	await access(src);
} catch {
	console.warn('[copy-engine] stockfish package not found — skipping.');
	process.exit(0);
}

await mkdir(dst, { recursive: true });

for (const f of FILES) {
	await copyFile(join(src, f), join(dst, f));
	console.log(`[copy-engine] ${f}`);
}
