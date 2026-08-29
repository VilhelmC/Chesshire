// Stockfish, in Node — the harness the corpus scripts have never had.
//
// ---------------------------------------------------------------------------
// Every engine measurement in this project has so far been impossible outside a
// browser: `src/engine/stockfish.ts` drives a Web Worker, and the corpus scripts
// are Node. So the ladder was measured against puzzle labels and never against
// the engine, and M0's gate — "does `searchmoves` agree with MultiPV" — could not
// be run at all.
//
// The WASM build does run under Node. Required as a module it exports the
// emscripten factory and nothing else: the wiring that the browser and CLI paths
// get for free (`processCommand`, the go-queue, `locateFile`) has to be supplied
// here. That is all this file is.
//
//   const e = await engine();
//   await e.analyse(fen, { movetime: 300, multipv: 3 });
//   await e.analyse(fen, { movetime: 300, searchmoves: ['e2e4', 'd2d4'] });
//   e.quit();
//
// SERIALISED BY CONSTRUCTION. One engine, one search at a time — `go` while a
// search is running is undefined behaviour, and the browser wrapper serialises
// for the same reason. Calls queue.
// ---------------------------------------------------------------------------
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WASM = join(ROOT, 'public/engine/stockfish-18-lite-single.wasm');

/**
 * The engine script, copied out to a `.cjs` extension.
 *
 * `package.json` sets `"type": "module"`, which makes every `.js` file under the
 * project ESM — including this one, which is emscripten's CommonJS output and
 * calls `require` at load. Requiring it in place fails with "require is not
 * defined in ES module scope", which reads as a bug in the engine and is really a
 * bug in where it is sitting. Copying it out is one line and needs no build step.
 */
const JS = join(tmpdir(), 'sf-18-lite-single.cjs');
if (!existsSync(JS)) copyFileSync(join(ROOT, 'public/engine/stockfish-18-lite-single.js'), JS);

const MATE_SCORE = 10000;

/** Parse a UCI `info` line. Deliberately the same shape as `src/engine/stockfish.ts`. */
export function parseInfo(line) {
	if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
	const tok = line.split(/\s+/);
	let depth = 0,
		multipv = 1,
		cp = null,
		mate = null,
		pv = [];
	for (let i = 0; i < tok.length; i++) {
		switch (tok[i]) {
			case 'depth':
				depth = Number(tok[++i]);
				break;
			case 'multipv':
				multipv = Number(tok[++i]);
				break;
			case 'score':
				if (tok[i + 1] === 'cp') {
					cp = Number(tok[i + 2]);
					i += 2;
				} else if (tok[i + 1] === 'mate') {
					mate = Number(tok[i + 2]);
					i += 2;
				}
				break;
			case 'pv':
				pv = tok.slice(i + 1);
				i = tok.length;
				break;
		}
	}
	if (cp === null && mate === null) return null;
	const score = mate !== null ? (mate > 0 ? MATE_SCORE - mate * 10 : -MATE_SCORE - mate * 10) : cp;
	return { multipv, cp: score, mate, depth, pv };
}

export async function engine({ hash = 16, quiet = true } = {}) {
	const factory = require(JS);
	const Mod = {
		// Required as a module the build never resolves its own .wasm — it looks
		// for `stockfish.wasm` beside the CWD and aborts. This is the whole reason
		// the first attempt failed.
		locateFile: (p) => (p.endsWith('.wasm') ? WASM : p),
		listener: (line) => {
			const s = String(line);
			if (!quiet) console.error('<', s);
			for (const fn of listeners) fn(s);
		},
	};
	const listeners = new Set();

	await factory()(Mod);

	// `processCommand` and the go-queue are wired by the build's own browser and
	// CLI entry points, neither of which runs here. `command` is the underlying
	// export; `go` is asyncify-wrapped, exactly as the build's own dispatcher does.
	const send = (cmd) => Mod.ccall('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) });

	/** Collect output until `until` matches, then resolve with everything seen. */
	const until = (pattern, fire, timeoutMs) =>
		new Promise((resolve, reject) => {
			const seen = [];
			const timer = setTimeout(() => {
				listeners.delete(onLine);
				reject(new Error(`engine timeout waiting for ${pattern}`));
			}, timeoutMs);
			const onLine = (line) => {
				seen.push(line);
				if (line.startsWith(pattern)) {
					clearTimeout(timer);
					listeners.delete(onLine);
					resolve(seen);
				}
			};
			listeners.add(onLine);
			Promise.resolve(fire()).catch(() => undefined);
		});

	await until('uciok', () => send('uci'), 30_000);
	send(`setoption name Hash value ${hash}`);
	send('setoption name Threads value 1');
	await until('readyok', () => send('isready'), 30_000);

	let queue = Promise.resolve();

	/**
	 * One search.
	 *
	 * `searchmoves` RESTRICTS the search to the named moves and scores each. Two
	 * things about it that are easy to get wrong and expensive to debug:
	 *
	 *   1. It must be the LAST token group on the `go` line. Stockfish's own
	 *      parser consumes every remaining token into the move list — its source
	 *      carries the comment "needs to be the last command on the line".
	 *   2. MultiPV has to be at least the number of moves named, or the engine
	 *      reports only the best few and the rest come back missing rather than
	 *      scored. Set here rather than left to the caller.
	 */
	function analyse(fen, { depth = 14, movetime, multipv = 1, searchmoves } = {}) {
		const run = async () => {
			const pvCount = searchmoves?.length ? Math.max(multipv, searchmoves.length) : multipv;
			const budget = movetime ? movetime + 20_000 : 120_000;
			const out = await until(
				'bestmove',
				() => {
					send('ucinewgame');
					send(`setoption name MultiPV value ${pvCount}`);
					send(`position fen ${fen}`);
					const go = movetime ? `go movetime ${movetime}` : `go depth ${depth}`;
					send(searchmoves?.length ? `${go} searchmoves ${searchmoves.join(' ')}` : go);
				},
				budget,
			);
			const lines = new Map();
			for (const raw of out) {
				const p = parseInfo(raw);
				// Keep the LAST line per multipv index: earlier iterations are
				// shallower answers to the same question.
				if (p) lines.set(p.multipv, p);
			}
			return { fen, lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv) };
		};
		const result = queue.then(run, run);
		queue = result.catch(() => undefined);
		return result;
	}

	return { analyse, send, quit: () => send('quit') };
}
