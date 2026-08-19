// A console handle for reporting bugs.
//
// ---------------------------------------------------------------------------
// Describing a broken board over chat is lossy — "I can't move" is the symptom
// of at least four different causes. This collects the state that actually
// distinguishes them (what position the board thinks it is on, whose move it
// thinks it is, whether there are any legal destinations armed, what the card
// expects) and puts it on the clipboard as text.
//
//     schackal.dump()     copy everything to the clipboard
//     schackal.show()     the same object, logged rather than copied
//     schackal.help()
//
// Views register a snapshot function; nothing is captured until you ask.
//
// Secrets: the Lichess token is NEVER included. Whether one is stored, and how
// long it is, is reported — that has diagnosed a problem before — but the value
// never leaves localStorage.
// ---------------------------------------------------------------------------

import { db } from './db';
import { positionFromFen, chessgroundDests, sideToMove } from '../domain/chess';

type Snapshot = () => unknown;

const providers = new Map<string, Snapshot>();

/** Register a view's state. Call again to replace; returns an unregister fn. */
export function registerDebug(name: string, snapshot: Snapshot): () => void {
	providers.set(name, snapshot);
	return () => {
		if (providers.get(name) === snapshot) providers.delete(name);
	};
}

/**
 * What the board can actually do with a position, which is the question behind
 * most "it won't let me move" reports.
 */
export function describePosition(fen: string | undefined | null) {
	if (!fen) return { fen: null, error: 'no fen' };
	try {
		const pos = positionFromFen(fen);
		const dests = chessgroundDests(pos) as Map<string, string[]>;
		const moves: Record<string, string[]> = {};
		let count = 0;
		for (const [from, to] of dests) {
			moves[from] = to;
			count += to.length;
		}
		return {
			fen,
			sideToMove: sideToMove(fen),
			legalMoves: count,
			inCheck: pos.isCheck(),
			gameOver: pos.isEnd(),
			dests: moves,
		};
	} catch (e) {
		return { fen, error: (e as Error).message };
	}
}

async function counts() {
	const tables = [
		'nodes',
		'drills',
		'attempts',
		'explorerCache',
		'evalCache',
		'games',
		'memory',
		'answers',
		'runs',
		'session',
		'mistakes',
		'imported',
	] as const;

	const out: Record<string, number | string> = {};
	for (const t of tables) {
		try {
			out[t] = await db.table(t).count();
		} catch (e) {
			out[t] = `error: ${(e as Error).message}`;
		}
	}
	return out;
}

function storage() {
	const out: Record<string, unknown> = {};
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k?.startsWith('offbook.')) continue;
			const v = localStorage.getItem(k) ?? '';
			// Never the value.
			out[k] = /token/i.test(k) ? `<${v.length} chars, not shown>` : v;
		}
	} catch (e) {
		out.error = (e as Error).message;
	}
	return out;
}

export async function collect(): Promise<Record<string, unknown>> {
	const views: Record<string, unknown> = {};
	for (const [name, fn] of providers) {
		try {
			views[name] = fn();
		} catch (e) {
			views[name] = { error: (e as Error).message };
		}
	}

	let dbState = 'unknown';
	try {
		dbState = db.isOpen() ? `open (v${db.verno})` : 'closed';
	} catch {
		/* leave it */
	}

	return {
		app: 'schackal',
		at: new Date().toISOString(),
		url: location.href,
		userAgent: navigator.userAgent,
		db: { state: dbState, counts: await counts() },
		localStorage: storage(),
		views,
	};
}

export async function dump(): Promise<string> {
	const text = JSON.stringify(await collect(), null, '\t');
	try {
		await navigator.clipboard.writeText(text);
		console.log(`schackal: ${text.length} chars copied to the clipboard.`);
	} catch (e) {
		// Clipboard needs a user gesture in some browsers; do not lose the data.
		console.warn(`schackal: clipboard refused (${(e as Error).message}). Here it is:`);
		console.log(text);
	}
	return text;
}

export async function show(): Promise<Record<string, unknown>> {
	const state = await collect();
	console.log(state);
	return state;
}

export function help(): void {
	console.log(
		[
			'schackal.dump()   — copy full state to the clipboard as JSON',
			'schackal.show()   — log it instead (expandable in the console)',
			'schackal.board()  — legal moves for whatever position a view last reported',
			'',
			'The Lichess token is never included, only its length.',
		].join('\n'),
	);
}

/** Legal-move report for the position the given view is showing. */
export async function board(view = 'quiz'): Promise<unknown> {
	const state = (await collect()).views as Record<string, { fen?: string }>;
	return describePosition(state?.[view]?.fen);
}

export function installDebug(): void {
	const api = { dump, show, help, board, collect, describePosition };
	(window as unknown as { schackal: typeof api }).schackal = api;
	console.log('schackal debug ready — schackal.help()');
}
