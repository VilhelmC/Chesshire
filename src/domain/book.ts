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
// The rungs are `STRICTNESS` below, from narrowest to widest, plus one that is
// off the ladder entirely ('bestEngine' — the engine's best move whether or not
// anyone plays it). Leaving the book is reported at EVERY rung; the rung only
// decides what is accepted.
// ---------------------------------------------------------------------------

import type { ExplorerMove, ExplorerResponse } from './types';

/*
 * ---------------------------------------------------------------------------
 * WHAT WAS HERE, AND WHY IT HAD TO CHANGE.
 *
 * Will: "the strictness options should be revised. Current 'One answer' option
 * is useless — why would we care about which move is most popular."
 *
 * He is right, and it was worse than useless: of the three options, TWO OF THEM
 * ACCEPTED THE SAME SET. `'book'` and `'free'` both fell through to `sound`,
 * because an earlier and correct fix stopped frequency deciding right from wrong
 * and nothing re-separated the rungs afterwards. So the setting offered three
 * choices, one of which drilled the most popular move and two of which were
 * identical.
 *
 * ---------------------------------------------------------------------------
 * THE LADDER, strictest first. Each rung is a real narrowing of the one below.
 *
 *   bestBook   played, and as good as the best played move
 *   bookSound  played, and sound
 *   free       sound, played or not          (what 'book' and 'free' both were)
 *
 * And one that is NOT on the ladder:
 *
 *   bestEngine the best move here, book or not
 *
 * ---------------------------------------------------------------------------
 * WHY `bestEngine` IS SEPARATE, which was Will's own question: "does that make
 * sense or does it break the repertoire training functionality?"
 *
 * As a rung it would break it. You would never be marked wrong for leaving your
 * own lines, so the repertoire numbers would stop meaning anything. But his
 * instinct already carried the fix — "this should alert player they chose the
 * best move but deviated from training repertoire". That is not acceptance, it
 * is REPORTING, and once the two are separated the conflict disappears:
 * `describeChoice` says a move was off the beaten track whatever the setting,
 * so the deviation is always named, and `bestEngine` becomes an honest
 * find-the-best-move drill rather than a repertoire drill pretending to be one.
 */
export type Strictness = 'bestBook' | 'bookSound' | 'free' | 'bestEngine';

export const STRICTNESS: { id: Strictness; label: string; note: string }[] = [
	{
		id: 'bestBook',
		label: 'Best book move',
		note: 'The strongest move anybody actually plays here. Ties count — anything within a third of a pawn of it is the same move as far as this is concerned.',
	},
	{
		id: 'bookSound',
		label: 'Engine-approved book',
		note: 'A move real games play here, that the engine also has no objection to. Theory, minus the dubious parts of it.',
	},
	{
		id: 'free',
		label: 'Anything sound',
		note: 'Only moves that actually cost something are wrong. Popularity is ignored, so a good rarity is accepted and told you it is rare.',
	},
	{
		id: 'bestEngine',
		label: 'Best move, book or not',
		note: 'Find the strongest move regardless of theory. Not a repertoire drill — leaving your lines is allowed here, and said out loud when it happens.',
	},
];

/**
 * Close enough to the best move to count as the best move.
 *
 * The same number `explain.ts` calls `equal` and prints as "As good as Nxd4".
 * Kept here rather than imported to avoid a cycle, and pinned to that one by a
 * test, because two definitions of "equally good" is how a reader ends up being
 * told a move is fine and marked wrong for it in the same breath.
 */
export const EQUAL_CP = 30;

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

	// The most-played sound move is the one labelled 'main'. That is a fact about
	// the book — it is what the display calls the main line — and nothing in
	// `acceptable` reads it any more: the rungs sort by SCORE, not by popularity,
	// which is the whole point of the revision.
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
	// "Played here" is already decided by `classifyBook`, which marks a move
	// `main` or `book` when it clears the frequency bar and `sound` when it is
	// good but rare. Re-deriving it from `freq` would be a second definition.
	const played = moves.filter((m) => m.verdict === 'main' || m.verdict === 'book');

	/*
	 * THE BEST OF A SET, WITH TIES.
	 *
	 * Will: "for 'best' we consider moves within some negligible tolerance
	 * equally good". `EQUAL_CP`, which is the number the explainer already uses
	 * when it says one move is as good as another.
	 *
	 * AN UNMEASURED MOVE COUNTS AS BEST. `cpLoss` is null until something has
	 * paid for a search, and a position nobody has scored yet would otherwise
	 * have every move rejected — the reader marked wrong for playing the right
	 * move because the engine had not answered. Accepting too much is the safe
	 * direction; rejecting a correct answer is not.
	 */
	const best = (set: BookMove[]): BookMove[] => {
		if (!set.length) return [];
		const floor = Math.min(...set.map((m) => m.cpLoss ?? 0));
		return set.filter((m) => (m.cpLoss ?? 0) <= floor + EQUAL_CP);
	};

	switch (strictness) {
		case 'bestEngine':
			// Every move here, not just the played ones — that is the whole point
			// of this mode, and why it is not a rung on the ladder.
			return best(moves);

		case 'bestBook':
			// Fall back to the whole sound set rather than to nothing: a position
			// the explorer has no games for is the opening ending, not a failure.
			return best(played).length ? best(played) : sound;

		case 'bookSound':
			return played.filter((m) => (m.cpLoss ?? 0) <= SOUND_CP).length
				? played.filter((m) => (m.cpLoss ?? 0) <= SOUND_CP)
				: sound;

		case 'free':
			// ---------------------------------------------------------------------
			// SOUNDNESS DECIDES RIGHT AND WRONG HERE, and frequency decides nothing.
			//
			// This rung used to be the only behaviour, shared with 'book'. The
			// reasoning for it stands and is worth keeping: requiring a move to
			// clear a frequency bar means a SOUND move can be marked wrong for
			// being unpopular, which trains you to reproduce common moves rather
			// than good ones. At the extreme it rejected the engine's own choice.
			//
			// What changed is that the tighter rungs now ask for "played" ON TOP OF
			// sound, rather than INSTEAD OF it — an explicit narrowing the reader
			// chose, not a hidden rule.
			//
			// Frequency still governs the OPPONENT (`opponentBook`), and that
			// asymmetry is the correct one: predicting them is a question about
			// what people play, judging yourself is a question about what is good.
			// ---------------------------------------------------------------------
			return sound;
	}
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
