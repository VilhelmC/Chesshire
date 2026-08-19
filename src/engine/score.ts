// Scoring a move against the engine's choice.
//
// ---------------------------------------------------------------------------
// Why this is its own module rather than two calls inline.
//
// Centipawn loss is a DIFFERENCE between two evaluations, so the two must be
// measured the same way. The first version compared `state.evalNow` — whatever
// happened to be cached for the position, possibly a depth-45 cloud entry —
// against a fresh analysis of the position after the move. Comparing a deep
// evaluation with a shallow one produces a number dominated by the depth gap
// rather than by the move, and since negatives are clamped to zero the error
// only ever flatters: real losses survive, spurious gains vanish. That is how a
// poor game came out at 1639.
//
// Both evaluations here come from the same engine with the same budget.
// ---------------------------------------------------------------------------

import { engine, toWhitePov } from './stockfish';
import { applyUci, sideToMove } from '../domain/chess';

/** Search budget for scoring, in milliseconds, used for BOTH evaluations. */
const SCORE_MOVETIME_MS = 300;
const SCORE_DEPTH = 14;
/** A single catastrophe is capped so it cannot dominate an average. */
const MAX_LOSS = 600;

export type MoveScore = {
	/** Evaluation with best play, our point of view. */
	best: number;
	/** Evaluation after the move played, our point of view. */
	after: number;
	/** Centipawns given up, clamped to [0, MAX_LOSS]. */
	loss: number;
	bestUci: string | null;
};

/**
 * Score one move. Returns null when either evaluation is unavailable.
 *
 * Null matters: an earlier version logged a failed analysis as a loss of zero,
 * which records "played the best move" every time the engine hiccups. Silence
 * is the honest answer.
 */
export async function scoreMove(
	fen: string,
	uci: string,
	ourColour: 'w' | 'b',
): Promise<MoveScore | null> {
	let afterFen: string;
	try {
		afterFen = applyUci(fen, uci).fen;
	} catch {
		return null;
	}

	try {
		const before = await engine.analyse(fen, SCORE_DEPTH, 1, SCORE_MOVETIME_MS);
		const after = await engine.analyse(afterFen, SCORE_DEPTH, 1, SCORE_MOVETIME_MS);

		const b = before.lines[0];
		const a = after.lines[0];
		if (!b || !a) return null;

		const bestOurs = pov(toWhitePov(b.cp, sideToMove(fen)), ourColour);
		const afterOurs = pov(toWhitePov(a.cp, sideToMove(afterFen)), ourColour);

		return {
			best: bestOurs,
			after: afterOurs,
			loss: Math.min(MAX_LOSS, Math.max(0, Math.round(bestOurs - afterOurs))),
			bestUci: b.pv[0] ?? null,
		};
	} catch {
		return null;
	}
}

function pov(cpWhite: number, colour: 'w' | 'b'): number {
	return colour === 'w' ? cpWhite : -cpWhite;
}
