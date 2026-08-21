// What counts as a book move.
//
// ---------------------------------------------------------------------------
// This replaces the hand-written list of lines.
//
// A list of lines is a lie about the shape of an opening. "Giuoco Piano" and
// "Two Knights" are not two things you learn separately — they are one thing
// that forks at move 3, and everything before the fork is shared. Written as
// five strings, the shared prefix is duplicated five times, a position can only
// be understood as belonging to a named line, and any move outside those five
// strings is "wrong" even when it is a perfectly good opening.
//
// The opening IS a tree, and the explorer already holds it. So there is no
// list: at every position we ask what is actually played there, check what the
// engine thinks of it, and the answer defines both what you may play and what
// the opponent may reply. The line you are in is discovered — read off the
// explorer's own ECO naming — rather than prescribed in advance.
//
// The strictness of "may play" is the user's to set, because it is genuinely a
// choice about what is being trained rather than a fact about chess:
//
//   'repertoire' — one answer per position. Memorisation.
//   'book'       — any sound, reasonably common move. Exploration.
//   'free'       — anything not actually bad. Only real errors are corrected.
// ---------------------------------------------------------------------------

import type { ExplorerMove, ExplorerResponse } from './types';

export type Strictness = 'repertoire' | 'book' | 'free';

export const STRICTNESS: { id: Strictness; label: string; note: string }[] = [
	{
		id: 'repertoire',
		label: 'One answer',
		note: 'The most popular sound move, and only that. Strict memorisation.',
	},
	{
		id: 'book',
		label: 'Any book move',
		note: 'Any sound move played often enough to be real theory. You discover the tree by playing it.',
	},
	{
		id: 'free',
		label: 'Anything sound',
		note: 'Only moves that actually cost something are wrong. Popularity is ignored.',
	},
];

/** How common a move must be to count as theory, by default. */
export const DEFAULT_MIN_FREQ = 0.03;

/**
 * Centipawns a move may cost and still be called sound.
 *
 * Popularity alone cannot decide this — Damiano's Defence is named theory and
 * also close to losing, which is why the earlier frequency-only filter called
 * it book.
 */
export const SOUND_CP = 60;
/** Beyond this it is not a slip, it is the mistake the drill exists to punish. */
export const BLUNDER_CP = 120;

/**
 * ---------------------------------------------------------------------------
 * `main` USED TO BE CALLED `best`, AND THAT NAME WAS A LIE.
 *
 * It is assigned to the most-PLAYED sound move, not to the strongest one. The
 * app also has a genuine best-by-evaluation elsewhere (engine/candidates.ts),
 * so a move could be shown as the engine's top choice and simultaneously
 * rejected as not-book — which is what happened with 6...Bd3 in the Queen's
 * Gambit Accepted, and which quite reasonably put the whole exercise in doubt.
 *
 * Two different questions were sharing one word:
 *
 *   main   — what players at your band usually play here
 *   sound  — what does not lose anything
 *
 * They are not the same and neither one is "best".
 * ---------------------------------------------------------------------------
 */
export type Verdict = 'main' | 'book' | 'sound' | 'inaccuracy' | 'blunder';

export type BookMove = {
	uci: string;
	san: string;
	/** Share of games at your band that continue this way. */
	freq: number;
	games: number;
	/** Centipawns behind the best move here, from the mover's side. Null if unmeasured. */
	cpLoss: number | null;
	/** ECO name this move leads into, when the explorer knows one. */
	name: string | null;
	verdict: Verdict;
};

export type ClassifyOptions = {
	/** Centipawns behind best, keyed by uci. Missing entries leave cpLoss null. */
	losses?: Map<string, number>;
	minFreq?: number;
};

/**
 * Every reply the explorer knows here, with a verdict.
 *
 * Frequency and soundness are kept as separate axes rather than collapsed into
 * one score, because the interesting moves are exactly the ones where they
 * disagree: common and bad is a drill, sound and rare is a surprise.
 */
export function classifyBook(
	data: ExplorerResponse,
	opts: ClassifyOptions = {},
): BookMove[] {
	const minFreq = opts.minFreq ?? DEFAULT_MIN_FREQ;
	const total = data.moves.reduce((s, m) => s + gamesOf(m), 0);
	if (!total) return [];

	const rows = data.moves.map((m) => {
		const games = gamesOf(m);
		const freq = games / total;
		const cpLoss = opts.losses?.get(m.uci) ?? null;
		return { m, games, freq, cpLoss };
	});

	// The most-played move that is not unsound is the reference for 'repertoire'.
	const popularSound = [...rows]
		.filter((r) => (r.cpLoss ?? 0) <= SOUND_CP)
		.sort((a, b) => b.freq - a.freq)[0];

	return rows.map((r) => {
		const loss = r.cpLoss ?? 0;
		let verdict: Verdict;
		if (loss >= BLUNDER_CP) verdict = 'blunder';
		else if (loss > SOUND_CP) verdict = 'inaccuracy';
		else if (popularSound && r.m.uci === popularSound.m.uci) verdict = 'main';
		else if (r.freq >= minFreq) verdict = 'book';
		// Sound but seldom played. NOT an error — see `acceptable`. Rarity is a
		// fact about other people, not about the move.
		else verdict = 'sound';

		return {
			uci: r.m.uci,
			san: r.m.san,
			freq: r.freq,
			games: r.games,
			cpLoss: r.cpLoss,
			name: r.m.opening?.name ?? null,
			verdict,
		};
	});
}

/**
 * The moves the user may play here, under a given strictness.
 *
 * Always non-empty when anything at all is sound: a position where every answer
 * is marked wrong is a bug in the settings, not a lesson.
 */
export function acceptable(moves: BookMove[], strictness: Strictness): BookMove[] {
	const sound = moves.filter((m) => (m.cpLoss ?? 0) <= SOUND_CP);

	if (strictness === 'free') {
		return sound.length ? sound : [];
	}

	if (strictness === 'repertoire') {
		// The one line, deliberately. This is the mode for drilling a specific
		// repertoire, so following the main line IS the exercise.
		const main = moves.find((m) => m.verdict === 'main');
		return main ? [main] : sound.slice(0, 1);
	}

	// ---------------------------------------------------------------------
	// 'book' NO LONGER MEANS "frequently played".
	//
	// It used to require a move to clear a frequency bar, which meant a SOUND
	// move could be marked wrong for being unpopular — training you to
	// reproduce common moves rather than good ones. That inverts what the app
	// is for. At the extreme it rejected the engine's own top choice.
	//
	// Soundness decides right and wrong. Frequency decides what is worth
	// SAYING about a move — "that is theory" versus "that is fine, and almost
	// nobody plays it" — and `describeChoice` below is where that lives.
	//
	// Frequency still governs the OPPONENT (`opponentBook`), and that
	// asymmetry is the correct one: predicting them is a question about what
	// people play, judging yourself is a question about what is good.
	// ---------------------------------------------------------------------
	return sound;
}

/**
 * What to say about a move that was accepted.
 *
 * Returns null when there is nothing worth remarking on. The point is that a
 * remark is not a rejection: playing a sound rarity should tell you it is a
 * rarity, and then let you get on with the game.
 */
export function describeChoice(move: BookMove): string | null {
	switch (move.verdict) {
		case 'main':
			return null;
		case 'book':
			return null;
		case 'sound':
			return `Sound, and off the beaten track — ${percent(move.freq)} of players go this way.`;
		case 'inaccuracy':
			return `Playable, but it gives something up.`;
		case 'blunder':
			return null;
	}
}

function percent(f: number): string {
	const p = f * 100;
	if (p >= 10) return `${Math.round(p)}%`;
	if (p >= 1) return `${p.toFixed(1)}%`;
	return 'under 1%';
}

/** True when a move is theory rather than merely sound. */
export function isTheory(move: BookMove): boolean {
	return move.verdict === 'main' || move.verdict === 'book';
}

/** Replies the opponent may play as "book" — same rule, their side of the board. */
export function opponentBook(moves: BookMove[], minFreq = DEFAULT_MIN_FREQ): BookMove[] {
	const ok = moves.filter((m) => isTheory(m));
	if (ok.length) return ok;
	// A position the explorer barely knows still has to continue somehow.
	return moves.filter((m) => (m.cpLoss ?? 0) <= SOUND_CP && m.freq >= minFreq / 3).slice(0, 3);
}

/** Replies worth offering as a mistake to punish. */
export function punishable(moves: BookMove[], minFreq = DEFAULT_MIN_FREQ): BookMove[] {
	return moves.filter((m) => m.verdict === 'blunder' && m.freq >= minFreq / 3);
}

/**
 * The name of the opening a position sits in.
 *
 * The explorer names the position itself once it is nameable, and names each
 * move by where it leads. Preferring the position's own name means the label
 * describes where you ARE, not where you might go next.
 */
export function openingName(data: ExplorerResponse): string | null {
	return data.opening?.name ?? null;
}

function gamesOf(m: ExplorerMove): number {
	return m.white + m.draws + m.black;
}

/** Is `path` inside the subtree rooted at `root`, or on the way to it? */
export function withinRoot(path: string[], root: string[] | null): boolean {
	if (!root || !root.length) return true;
	// A path shorter than the root is on the way to it, which counts.
	const n = Math.min(path.length, root.length);
	for (let i = 0; i < n; i++) if (path[i] !== root[i]) return false;
	return true;
}

/**
 * Roots still reachable from this path.
 *
 * With several openings pinned, a run is inside the filter if it is inside ANY
 * of them — and while still on the way there, the set narrows as moves are
 * played. After 1.e4 both the Scotch and the Two Knights are live; after 3.Bc4
 * only one is.
 */
export function liveRoots(path: string[], roots: { path: string[] }[]): { path: string[] }[] {
	if (!roots.length) return [];
	return roots.filter((r) => withinRoot(path, r.path));
}

/** Is this path allowed under the pinned set? Empty set means everything is. */
export function withinAnyRoot(path: string[], roots: { path: string[] }[]): boolean {
	return !roots.length || liveRoots(path, roots).length > 0;
}

/**
 * Moves that keep the run heading towards at least one pinned root.
 *
 * Empty when every live root has already been reached, which is the signal that
 * ordinary book rules take over from here.
 */
export function movesTowardRoots(path: string[], roots: { path: string[] }[]): string[] {
	const out = new Set<string>();
	for (const r of liveRoots(path, roots)) {
		if (path.length < r.path.length) out.add(r.path[path.length]);
	}
	return [...out];
}
