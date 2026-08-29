// Score a set of moves against each other, on one scale.
//
// ---------------------------------------------------------------------------
// THE PRODUCT REDUCES TO THIS.
//
// Every doorway into the explainer is the same question wearing different
// clothes — the user's move against the line's, an engine move against the other
// engine moves, a popular move against the rest, "why not X" against what was
// chosen, the move at ply k of a line against its alternatives. All of them are
// "here are some moves, tell me how they compare", so it is built once.
//
// ---------------------------------------------------------------------------
// ONE SEARCH PER MOVE, AND THAT IS MEASURED RATHER THAN CAUTIOUS.
//
// The obvious implementation is one `go searchmoves a b c` — one search, N moves,
// one scale. It does not work. `offbook/FINDING-ONE-MOVE-PER-SEARCH.md`, against
// a full-window search of each move alone:
//
//     identical scores    5/93   5.4%
//     pairs flipped >50cp  6/136  4.41%
//     g8h6 vs f8e8:  in-call +160   alone -74     234cp, verdict reversed
//
// In a multi-move search only the first root move gets a full window; the rest
// are searched against bounds derived from it, so their scores are bounds and not
// evaluations. Comparing two of them is comparing two bounds, and it reverses the
// verdict on about 4% of pairs with no way to tell which 4% from inside.
//
// A single root move gets a full window and an exact score. And the cost is
// nearly free — four single-move searches were 171ms against 151ms for one
// four-move search, **1.1x** — because a one-move root is cheap to search. So
// exactness costs 10% and this is a loop.
//
// ---------------------------------------------------------------------------
// FIXED DEPTH, NOT MOVETIME.
//
// The engine is perfectly deterministic at fixed depth: the same query twice was
// identical on 151/151 scores and 220/220 pairs. That matters more than
// predictable latency here, because these results are CACHED and re-read during
// recursion — an explanation that gives a different answer when you open it again
// is not an explanation. `movetime` trades that away for a latency ceiling, and
// can be passed explicitly where a ceiling matters more.
// ---------------------------------------------------------------------------

import { analysePosition, toColourPov } from '../data/cloudEval';
import { applyUci, sideToMove } from '../domain/chess';

export type Scored = {
	uci: string;
	/** Standard notation, for anything a person reads. */
	san: string;
	/** Centipawns from the MOVER's point of view. Mate is in the ±10000 band. */
	cp: number;
	/**
	 * Centipawns behind the best move in this set. Zero for the best, negative
	 * for the rest.
	 *
	 * Anchored on a move that was searched THE SAME WAY — see `bestOf`. A loss
	 * measured against an unrestricted search of the position would be the
	 * measurement error this whole module exists to avoid.
	 */
	loss: number;
	/** The engine's continuation after this move. Its tail is not reliable. */
	pv: string[];
	/** Moves to mate, engine sign, when this is a mate line. */
	mate: number | null;
};

export type CompareOpts = {
	/** Plies. Deterministic, and the default for that reason. */
	depth?: number;
	/** A latency ceiling instead of a depth. Gives up determinism. */
	movetimeMs?: number;
	/**
	 * Also score the position's best move, so `loss` is anchored on the truth
	 * rather than on the best of a bad set.
	 *
	 * On by default. Without it, a comparison between two mistakes reports the
	 * lesser one as `loss: 0`, which reads as "this is fine".
	 */
	includeBest?: boolean;
};

/**
 * Moves to mate, read back out of the score.
 *
 * `parseInfo` folds mate into the centipawn band as `±(10000 - plies·10)` so that
 * a mate in one outranks a mate in three on one number, and `cloudEval`'s `Pv`
 * carries only that number. Inverting the mapping here is cheaper than plumbing a
 * second field through two layers, and the arithmetic is exact rather than a
 * guess — but it MUST stay in step with `stockfish.ts`, which is why both ends
 * are pinned by a test.
 */
export function mateIn(cp: number): number | null {
	if (Math.abs(cp) < 9000) return null;
	return cp > 0 ? Math.round((10000 - cp) / 10) : Math.round((-10000 - cp) / 10);
}

/**
 * The position's best move, as UCI.
 *
 * Deliberately a separate unrestricted search: it is single-PV, so it can come
 * from the cloud cache, which the restricted searches never can. Its SCORE is not
 * used for anything — only its move — precisely because that score is not on the
 * same scale as the restricted ones.
 */
export async function bestOf(fen: string, opts: CompareOpts = {}): Promise<string | null> {
	const { depth = 14, movetimeMs } = opts;
	try {
		const a = await analysePosition(fen, depth, 1, movetimeMs);
		return a.pvs[0]?.pv[0] ?? null;
	} catch {
		return null;
	}
}

/**
 * Score every named move, best first.
 *
 * Moves that are illegal, or that the engine declines to report, are dropped
 * rather than guessed at — a missing row is honest and an invented score is not.
 */
export async function scoreMoves(fen: string, moves: string[], opts: CompareOpts = {}): Promise<Scored[]> {
	const { depth = 14, movetimeMs, includeBest = true } = opts;
	const stm = sideToMove(fen);

	// Deduplicate, and add the best move so `loss` has a true anchor. It is scored
	// by the same single-move search as everything else, so it lands on one scale.
	const wanted = new Set(moves);
	if (includeBest) {
		const best = await bestOf(fen, opts);
		if (best) wanted.add(best);
	}

	const out: Scored[] = [];
	for (const uci of wanted) {
		// An illegal move is a caller's mistake, not an engine question.
		let san: string;
		try {
			san = applyUci(fen, uci).san;
		} catch {
			continue;
		}
		try {
			const a = await analysePosition(fen, depth, 1, movetimeMs, [uci]);
			const pv = a.pvs[0];
			if (!pv) continue;
			out.push({
				uci,
				san,
				cp: toColourPov(pv.cpWhite, stm),
				loss: 0, // filled in below, once the set's best is known
				pv: pv.pv,
				mate: mateIn(toColourPov(pv.cpWhite, stm)),
			});
		} catch {
			/* the engine declined; the move simply does not appear */
		}
	}

	out.sort((a, b) => b.cp - a.cp);
	const top = out[0]?.cp ?? 0;
	for (const s of out) s.loss = s.cp - top;
	return out;
}
