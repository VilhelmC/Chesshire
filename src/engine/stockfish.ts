// Stockfish WASM worker wrapper (UCI, MultiPV).
//
// Uses the single-threaded "lite" build so no SharedArrayBuffer — and therefore
// no COOP/COEP headers — are required. See SPEC.md §8.

import { CONFIG } from '../config';
import { assetUrl } from '../base';
import { registerDebug } from '../data/debug';

export type PvLine = {
	multipv: number;
	/** Centipawns from the side-to-move's point of view. Mate is mapped to ±(10000 - plies). */
	cp: number;
	mate: number | null;
	depth: number;
	pv: string[]; // uci moves
};

export type AnalysisResult = {
	fen: string;
	depth: number;
	lines: PvLine[];
};

const MATE_SCORE = 10000;

export class Engine {
	private worker: Worker | null = null;
	private ready: Promise<void> | null = null;
	private listeners = new Set<(line: string) => void>();
	private queue: Promise<unknown> = Promise.resolve();

	async init(): Promise<void> {
		if (this.ready) return this.ready;

		this.ready = (async () => {
			// assetUrl, not the bare config value: under a subpath deploy the
			// root-absolute form resolves one directory ABOVE the app and 404s.
			const url = assetUrl(CONFIG.engine.workerPath);
			const w = new Worker(url);
			this.worker = w;

			w.onmessage = (e: MessageEvent) => {
				const text = typeof e.data === 'string' ? e.data : String(e.data?.data ?? '');
				for (const l of this.listeners) l(text);
			};

			// A worker whose script fails to load never speaks, so without this the
			// only symptom is a 30-second timeout waiting for `uciok` — which reads
			// as "the engine is broken" when the truth is "the file is not there".
			// Say which, and say the URL, because the URL is the whole answer.
			const failed = new Promise<never>((_, reject) => {
				w.onerror = (e) => {
					const detail = typeof e === 'object' && 'message' in e ? ` (${e.message})` : '';
					reject(new Error(`Engine failed to load from ${url}${detail}`));
				};
			});
			// Anything the worker might reject with has to beat the 30s timeout,
			// hence the race rather than an await in sequence.
			await Promise.race([this.expect('uciok', () => this.send('uci')), failed]);
			this.send(`setoption name Hash value ${CONFIG.engine.hashMb}`);
			this.send('setoption name Threads value 1');
			await Promise.race([this.expect('readyok', () => this.send('isready')), failed]);
		})();

		// A failed init used to be cached forever: `ready` held a rejected promise,
		// so every later call re-threw the first error and only a page reload could
		// clear it. Forget it instead, so the next attempt actually retries.
		this.ready.catch(() => {
			this.ready = null;
			this.worker?.terminate();
			this.worker = null;
		});

		return this.ready;
	}

	private send(cmd: string): void {
		this.worker?.postMessage(cmd);
	}

	private expect(token: string, trigger: () => void, timeoutMs = 30_000): Promise<string[]> {
		return new Promise((resolve, reject) => {
			const buf: string[] = [];
			const timer = setTimeout(() => {
				this.listeners.delete(onLine);
				reject(new Error(`Engine timeout waiting for "${token}"`));
			}, timeoutMs);

			const onLine = (line: string) => {
				buf.push(line);
				if (line.startsWith(token) || line.includes(token)) {
					clearTimeout(timer);
					this.listeners.delete(onLine);
					resolve(buf);
				}
			};

			this.listeners.add(onLine);
			trigger();
		});
	}

	/**
	 * Analyse a position. Calls are serialised — a single engine instance can
	 * only work on one position at a time.
	 */
	analyse(fen: string, depth: number, multiPv = 1, movetimeMs?: number): Promise<AnalysisResult> {
		const run = async (): Promise<AnalysisResult> => {
			await this.init();

			const lines = new Map<number, PvLine>();

			// A fixed 30s ceiling was fine for depth 12-18 but not for a long
			// search; scale it to what we actually asked the engine to do.
			const timeoutMs = movetimeMs ? movetimeMs + 20_000 : 120_000;
			const output = await this.expect('bestmove', () => {
				this.send('ucinewgame');
				this.send(`setoption name MultiPV value ${multiPv}`);
				this.send(`position fen ${fen}`);
				// `go depth` on the single-threaded WASM build has wildly variable
				// cost per position — fine for a one-off check, ruinous when you are
				// walking a tree. `go movetime` makes the total predictable:
				// nodes x movetime, instead of nodes x "however long depth N takes".
				this.send(movetimeMs ? `go movetime ${movetimeMs}` : `go depth ${depth}`);
			}, timeoutMs);

			for (const raw of output) {
				const parsed = parseInfo(raw);
				if (parsed) lines.set(parsed.multipv, parsed);
			}

			const sorted = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
			return { fen, depth, lines: sorted };
		};

		// Serialise: chain onto the queue, and keep the queue alive on failure.
		const result = this.queue.then(run, run);
		this.queue = result.catch(() => undefined);
		return result;
	}

	/** Convenience: best-move evaluation in centipawns from the side to move. */
	async evaluate(fen: string, depth: number): Promise<number> {
		const r = await this.analyse(fen, depth, 1);
		return r.lines[0]?.cp ?? 0;
	}

	terminate(): void {
		this.worker?.terminate();
		this.worker = null;
		this.ready = null;
	}
}

/** Parse a UCI `info ...` line into a PvLine, or null if it isn't one. */
export function parseInfo(line: string): PvLine | null {
	if (!line.startsWith('info ') || !line.includes(' pv ')) return null;

	const tok = line.split(/\s+/);
	let depth = 0;
	let multipv = 1;
	let cp: number | null = null;
	let mate: number | null = null;
	let pv: string[] = [];

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

	const score =
		mate !== null ? (mate > 0 ? MATE_SCORE - mate * 10 : -MATE_SCORE - mate * 10) : (cp as number);

	return { multipv, cp: score, mate, depth, pv };
}

/** Flip a side-to-move-relative score to White's point of view. */
export function toWhitePov(cp: number, sideToMove: 'w' | 'b'): number {
	return sideToMove === 'w' ? cp : -cp;
}

/** Flip a White-POV score to our point of view. */
export function toOurPov(cpWhite: number, ourColour: 'w' | 'b'): number {
	return ourColour === 'w' ? cpWhite : -cpWhite;
}

/**
 * The URL the worker is actually loaded from.
 *
 * Exported, and reported in the debug dump, because when it is wrong the
 * symptom is a timeout — a silence that says nothing about the cause. The
 * end-to-end check reads THIS rather than recomputing the path, so it exercises
 * the app's own resolution instead of agreeing with itself.
 */
export function engineWorkerUrl(): string {
	return assetUrl(CONFIG.engine.workerPath);
}

registerDebug('engine', () => ({ workerUrl: engineWorkerUrl() }));

export const engine = new Engine();
