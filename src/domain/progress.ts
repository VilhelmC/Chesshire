// The rows progress is computed from.
//
// The aggregation itself moved to domain/tree.ts when the hardcoded lines went.
// A flat per-line rollup could not answer the question the page exists for —
// WHERE does recall break down — because every line sharing a prefix counted the
// same answer, so each line's accuracy was mostly measuring the shared trunk.
// Positions form a tree, so the numbers are computed on a tree.
//
// What remains here is the shape of what gets written, plus the free-play losses
// the rating estimate is built from.

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
