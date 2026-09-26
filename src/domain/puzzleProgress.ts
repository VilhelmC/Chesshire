// What a pile of puzzle attempts says about you.
//
// Three readings of the same rows, kept here rather than in the view because
// each one is a rule and not a layout: which attempts the rating is allowed to
// learn from, the series a chart plots, and the streak.
//
// ---------------------------------------------------------------------------
// ONE DEFINITION OF "THIS ONE COUNTED".
//
// `data/puzzleHistory.record` decided it inline, and the moment a second reader
// wanted the same question answered — the streak, then the graph — that inline
// expression became the repo's oldest failure mode: one definition, two
// readers, drifting. `countsForRating` is now the only place the rule is
// written, and `record` asks it too.
// ---------------------------------------------------------------------------

import type { RatingPoint } from './rating';

/**
 * The fields every reading here needs.
 *
 * Structural rather than importing `PuzzleAttempt`, which lives in `data/` with
 * Dexie behind it — `domain/` stays free of the database so these rules can be
 * tested with object literals. A real `PuzzleAttempt` satisfies it.
 */
export type AttemptRow = {
	id: string;
	at: number;
	/** Lichess's rating for the puzzle met. */
	puzzleRating: number;
	/** 1 or 0 — stored as a number because Dexie cannot index a boolean. */
	solved: number;
	assist: string;
	ratingAfter: number;
};

/**
 * Did this attempt move the rating?
 *
 * Will: "doesn't count puzzle as solved if assistance were used." So a helped
 * solve is remembered and not rated.
 *
 * A FAILURE COUNTS WHATEVER THE HELP WAS, and that asymmetry is the load-bearing
 * half: if help suppressed both outcomes, the overlays could be switched on
 * whenever a puzzle looked hard and the rating would only ever meet the ones
 * that were going to be solved anyway.
 */
export function countsForRating(a: { solved: number | boolean; assist: string }): boolean {
	return !a.solved || a.assist === 'none';
}

/** The attempts the rating learned from, oldest first. */
export function rated<T extends AttemptRow>(rows: readonly T[]): T[] {
	return rows.filter(countsForRating).sort((a, b) => a.at - b.at);
}

/**
 * The puzzle rating over time, in the shape the Progress chart already plots.
 *
 * Will: "puzzle rating over time perhaps is just an option on existing graph in
 * 'Progress' tab?" It is, and no new arithmetic is needed to do it: every
 * attempt already stored the rating that came out of it, so this is a read
 * rather than a replay.
 *
 * The two lines mean something different here than they do for the cp-loss
 * estimates, which is why the chart is told what to call them:
 *
 * * `cumulative` — your rating after that attempt. THE line.
 * * `elo` — the rating of the puzzle you met. Not an estimate of you at all,
 *   but worth drawing faintly beside it, because it is how you see the app
 *   raising the difficulty as you climb.
 *
 * Only rated attempts are plotted. A helped solve left the rating exactly where
 * it was, so plotting it would add a flat step that looks like a result.
 */
export function puzzleSeries(rows: readonly AttemptRow[], limit = 120): RatingPoint[] {
	const rows2 = rated(rows);
	// The most recent `limit`, because the chart puts a dot on every point and a
	// thousand of them is a solid bar. Safe to slice: `ratingAfter` is absolute,
	// so a window of it is still true.
	return rows2.slice(Math.max(0, rows2.length - limit)).map((a) => ({
		runId: a.id,
		ts: a.at,
		moves: 1,
		elo: Math.round(a.puzzleRating),
		cumulative: Math.round(a.ratingAfter),
	}));
}

export type Streak = { current: number; best: number };

/**
 * Solves in a row.
 *
 * Over RATED attempts only, which is the same population the rating uses and
 * therefore the same answer to "in a row" that the rest of the tab gives. A
 * helped solve is skipped: it neither extends the streak nor breaks it.
 *
 * That leaves a loophole — switch the arrows on for a hard one and the streak
 * survives — and it is the better of the two mistakes. Breaking a streak for
 * using a learning tool teaches readers to stop using it, while the rating,
 * which is the number that claims to measure sight, already refuses to count
 * helped solves at all.
 */
export function streaks(rows: readonly AttemptRow[]): Streak {
	let current = 0;
	let best = 0;
	for (const a of rated(rows)) {
		current = a.solved ? current + 1 : 0;
		best = Math.max(best, current);
	}
	return { current, best };
}
