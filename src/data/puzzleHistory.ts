// What you have solved, and what it says about you.
//
// Thin on purpose: the arithmetic is `domain/glicko`'s and the rules are
// `domain/puzzleSolve`'s, so what is left here is reading and writing two
// tables. The one decision it does make is stated in `record` — which attempts
// move the rating, and which are only remembered.

import { db, type AssistLevel, type PuzzleAttempt } from './db';
import { START, decayed, rate, type Rating } from '../domain/glicko';
import { countsForRating } from '../domain/puzzleProgress';
import type { Puzzle } from '../domain/puzzles';

/** The rating as it stands, widened for time away. */
export async function loadRating(now = Date.now()): Promise<Rating> {
	try {
		const row = await db.puzzleRating.get('current');
		if (!row) return { ...START, at: now };
		return decayed({ r: row.r, rd: row.rd, at: row.at }, now);
	} catch {
		// A rating that cannot be read is a rating with no evidence, which is
		// exactly what `START` says. Failing open here beats an empty screen.
		return { ...START, at: now };
	}
}

export async function saveRating(r: Rating): Promise<void> {
	try {
		await db.puzzleRating.put({ id: 'current', r: r.r, rd: r.rd, at: r.at });
	} catch {
		/* a lost autosave must not break the solve that triggered it */
	}
}

export async function attempts(limit = 500): Promise<PuzzleAttempt[]> {
	try {
		return await db.puzzleAttempts.orderBy('at').reverse().limit(limit).toArray();
	} catch {
		return [];
	}
}

/** Puzzle ids already served, so the next one is new. */
export async function seenIds(): Promise<Set<string>> {
	try {
		return new Set((await db.puzzleAttempts.toArray()).map((a) => a.puzzleId));
	} catch {
		return new Set();
	}
}

export type Recorded = { rating: Rating; attempt: PuzzleAttempt };

/**
 * Write down an attempt, and move the rating if it earned the right to.
 *
 * ---------------------------------------------------------------------------
 * ONLY AN UNAIDED SOLVE MOVES THE RATING, and a failure always does.
 *
 * Will: "doesn't count puzzle as solved if assistance were used". So a solve
 * with the arrows on is recorded, shown, and counted in the with-help tally —
 * and the rating does not move for it, because it is not evidence of sight.
 *
 * A FAILURE COUNTS WHATEVER THE HELP WAS. That asymmetry is deliberate and is
 * the one that keeps the number honest: if help suppressed both outcomes, a
 * reader could switch the overlays on whenever a puzzle looked hard and their
 * rating would only ever meet the ones they were going to solve anyway. Failing
 * with help is a stronger signal than failing without it, not a weaker one.
 * ---------------------------------------------------------------------------
 */
export async function record(args: {
	puzzle: Puzzle;
	solved: boolean;
	assist: AssistLevel;
	movesMade: number;
	rating: Rating;
	now?: number;
}): Promise<Recorded> {
	const now = args.now ?? Date.now();
	// The rule itself is `domain/puzzleProgress.countsForRating`, because the
	// streak and the rating graph ask the same question of the stored rows and
	// this was written inline here first. One definition, three readers.
	const counts = countsForRating({ solved: args.solved ? 1 : 0, assist: args.assist });
	const next = counts ? rate(args.rating, args.puzzle.rating, args.solved ? 1 : 0, now) : args.rating;

	const attempt: PuzzleAttempt = {
		id: `${args.puzzle.id}:${now}`,
		at: now,
		puzzleId: args.puzzle.id,
		puzzleRating: args.puzzle.rating,
		themes: args.puzzle.themes ?? [],
		solved: args.solved ? 1 : 0,
		assist: args.assist,
		ratingAfter: next.r,
		ratingDeviationAfter: next.rd,
		movesMade: args.movesMade,
	};

	try {
		await db.puzzleAttempts.put(attempt);
	} catch {
		/* the rating still moves; losing one row is survivable */
	}
	if (counts) await saveRating(next);
	return { rating: next, attempt };
}

export type Tally = {
	/** Attempts whose result moved the rating. */
	rated: { solved: number; total: number };
	/**
	 * Solves that were helped, which the rating ignored. Always `solved ===
	 * total`: a FAILURE with help still moved the rating, so it belongs above.
	 * Split on `countsForRating` rather than on `assist` for exactly that reason
	 * — bucketing by help alone filed rated failures under "not counted".
	 */
	helped: { solved: number; total: number };
};

/**
 * How you are doing, split by whether you were being helped.
 *
 * Will asked for a way to "track how they perform with help", and this is it
 * without a second rating: two solve rates, side by side. A second Glicko track
 * would claim a precision that a few dozen helped attempts cannot support,
 * where a rate says exactly what it counted.
 */
export function tally(rows: PuzzleAttempt[]): Tally {
	const out: Tally = { rated: { solved: 0, total: 0 }, helped: { solved: 0, total: 0 } };
	for (const a of rows) {
		const bucket = countsForRating(a) ? out.rated : out.helped;
		bucket.total++;
		if (a.solved) bucket.solved++;
	}
	return out;
}
