// The rows progress is computed from.
//
// The aggregation itself moved to domain/tree.ts when the hardcoded lines went.
// A flat per-line rollup could not answer the question the page exists for —
// WHERE does recall break down — because every line sharing a prefix counted the
// same answer, so each line's accuracy was mostly measuring the shared trunk.
// Positions form a tree, so the numbers are computed on a tree.
//
// What remains here is the shape of what gets written, plus the two populations
// the rating estimate is built from.

import { annotate } from './annotate';
import { isMateScore } from './playedGames';
import type { Reviewable } from './reviewable';

export type AnswerRow = {
	id: string;
	ts: number;
	runId: string;
	/**
	 * The moves played before this answer — its position in the opening tree.
	 *
	 * Replaces `lineIds`. A list of line IDs could not say WHERE an answer
	 * happened: an answer on move 2 belonged to every line sharing that prefix,
	 * so each line's accuracy was mostly measuring moves that had nothing to do
	 * with it. A path places the answer exactly once, and the tree is rebuilt
	 * from paths rather than asserted in advance. See domain/tree.ts.
	 */
	path: string[];
	/** Line IDs, on rows written before paths were recorded. Never written now. */
	lineIds?: string[];
	/** Half-moves played when the answer was given. */
	ply: number;
	phase: 'book' | 'punish' | 'freeplay';
	/** First attempt correct, without a reveal. */
	correct: boolean;
	revealed: boolean;
	/**
	 * The answer was given after asking for help — the move shown, or every
	 * option drawn on the board.
	 *
	 * Assisted answers are excluded from accuracy entirely, numerator AND
	 * denominator. Counting one as correct would let a session of pressing
	 * "show me" read as mastery; counting it as a miss would punish the exact
	 * behaviour a learner should use when stuck. It is not evidence either way,
	 * so it is reported separately instead.
	 */
	assisted: boolean;
	cpLoss: number;
};

export type RunRow = {
	id: string;
	ts: number;
	/** What the explorer called the position the run reached, if anything. */
	opening?: string | null;
	/** Legacy; see AnswerRow.path. */
	lineIds?: string[];
	/** SAN moves, so the run can be replayed on the review page. */
	moves?: string[];
	/** Evaluation after each ply, our point of view. Aligned with `moves`. */
	evals?: (number | null)[];
	/** Centipawns lost on each of OUR plies, keyed by ply index. */
	losses?: Record<number, number>;
	ourColour?: 'w' | 'b';
	/** Plies reached. */
	plies: number;
	finished: string | null;
	/** A mistake was offered at some point during the run. */
	sawMistake: boolean;
	/** The punishment was carried through to the end. */
	punished: boolean;
};

/**
 * Centipawn losses from free play only.
 *
 * Repertoire answers are excluded deliberately: recalling a memorised move
 * measures memory, and counting it as strength would show the rating climbing
 * every time you revised.
 */
export function freeplayLosses(answers: AnswerRow[]): number[] {
	return answers
		.filter(
			(a) =>
				a.phase === 'freeplay' &&
				!a.assisted &&
				// A negative loss means the move was never scored. The writer already
				// declines to log those, but the rule belongs here too: this is the
				// last point before the number reaches the rating estimate, and an
				// unmeasured move counted as a small loss can only ever flatter it.
				a.cpLoss >= 0,
		)
		.map((a) => a.cpLoss);
}

/**
 * Centipawn losses from the games you actually played.
 *
 * ---------------------------------------------------------------------------
 * Will: "why is my rating estimate only based on 28 scored moves, when there
 * are plenty of games imported."
 *
 * Because none of them counted. `freeplayLosses` reads `db.answers`, which only
 * Train writes, and only in the `freeplay` phase — the moves played on against
 * the bot after a punished mistake. Imported games go to `db.imported` and fed
 * the transfer and accuracy sections and nothing else. So a deck built from
 * seventeen real games contributed nothing to the number claiming to estimate
 * how well he plays, and 461 of his own scored moves sat one table away.
 *
 * That was an omission and not a decision. The exclusion this file already
 * carried is about REPERTOIRE ANSWERS — "recalling a memorised move measures
 * memory" — and a real game against a real opponent is not that.
 *
 * ---------------------------------------------------------------------------
 * BUT THE SAME ARGUMENT REACHES INTO THE GAMES THEMSELVES.
 *
 * The opening plies of a real game are also recall, and they are also nearly
 * lossless, so counting them flatters the estimate exactly as counting book
 * answers would. Measured on the 17 games in the deck:
 *
 *   every move of ours          461 moves, 49cp  ->  1666
 *   past the named opening      433 moves, 51cp  ->  1640
 *   past a fixed ply 10         388 moves, 54cp  ->  1615
 *
 * So the effect is real and worth about 25-50 points. This takes the middle
 * row, and takes it by the app's OWN notion of where the book ends — the
 * longest named opening that is a prefix of the game — rather than by a ply
 * number chosen to look reasonable. That is the same question the whole app is
 * about, asked once more.
 */
export function gameLosses(
	games: readonly Reviewable[],
	bookDepth: (moves: string[]) => number,
): number[] {
	const out: number[] = [];
	for (const g of games) {
		if (!g.evals.length) continue;
		const book = bookDepth(g.moves);
		for (const a of annotate(g.evals, g.ourColour)) {
			// Ours, measured, and past the point where it was still recall.
			if (a.side !== 'us' || a.loss === null || a.ply <= book) continue;
			// A MATE SCORE IS NOT A QUANTITY OF CENTIPAWNS. Differencing one against
			// an evaluation gave losses of nine and nineteen thousand — the same
			// error this repo has now caught three times. Ten of the deck's 433
			// moves touched one; each was being capped to 600 and counted.
			if (
				(a.before !== null && isMateScore(a.before)) ||
				(a.after !== null && isMateScore(a.after))
			)
				continue;
			out.push(a.loss);
		}
	}
	return out;
}

export function accuracy(correct: number, attempts: number): number | null {
	return attempts > 0 ? correct / attempts : null;
}

export function median(xs: number[]): number | null {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The first ply where accuracy falls below `threshold`, given enough attempts.
 *
 * This is the actionable number: the point in the line where recall breaks down.
 * Buckets with almost no attempts are skipped — a single miss at ply 12 is not
 * evidence of anything.
 */
/** Move number (1-based) for a ply index, for display. */
