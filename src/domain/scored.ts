// How much of a game was actually measured.
//
// ---------------------------------------------------------------------------
// Will: "I notice many of the games in my review list are incompletely scored —
// often only a handful of plies at the beginning of the game."
//
// THE MECHANISM, and it is worth spelling out because the symptom names it
// exactly. Import analyses a game ply by ply and then stores the row — and it
// stores it whether or not the walk finished. `findMistakes` breaks out of its
// loop on `shouldCancel`, and a position that the engine refuses is counted as
// `unmeasured` and skipped. Either way the row is written with however many
// evaluations it got, and the next import skips it, because "already imported"
// was decided by ASKING WHETHER THE ROW EXISTS:
//
//     const seen = new Set((await safeImported()).map((r) => r.id));
//
// A row that exists and a game that was analysed are not the same fact. So a
// game cut off at ply eight looked identical in storage to one measured to the
// end, and there was no way back to it except `force`, which re-does all of
// them. "A handful of plies at the beginning" is precisely the shape of a walk
// that stopped.
//
// ---------------------------------------------------------------------------
// WHY A THRESHOLD AND NOT "ALL OF THEM".
//
// One position the engine could not evaluate should not condemn a game to being
// re-analysed on every import forever. A game missing a tenth of its plies was
// interrupted; a game missing one or two hit a hiccup and is, for every purpose
// this app has, measured. The line has to go somewhere and this is where, said
// out loud rather than left as an `every(...)` that nobody notices is strict.
// ---------------------------------------------------------------------------

/** Below this share of its plies, a game is worth analysing again. */
export const COMPLETE_ENOUGH = 0.9;

/**
 * How many plies carry an evaluation.
 *
 * Deliberately just "count the non-nulls", which is correct under both of the
 * app's two indexing conventions: a stored game's array is one entry per ply,
 * and a `Reviewable`'s has a leading null for the starting position — which is
 * not a ply and must not be counted as one. See `domain/reviewable.ts`.
 */
export function scoredPlies(evals: readonly (number | null)[] | undefined): number {
	if (!evals) return 0;
	let n = 0;
	for (const e of evals) if (e !== null && e !== undefined) n++;
	return n;
}

/** The share of the game that was measured, 0 to 1. Zero-length is zero. */
export function coverage(evals: readonly (number | null)[] | undefined, plies: number): number {
	if (plies <= 0) return 0;
	return Math.min(1, scoredPlies(evals) / plies);
}

/**
 * Measured enough to leave alone.
 *
 * A game with NO evaluations at all is complete in a different sense — nothing
 * was ever attempted, which happens when the site had no analysis and the
 * engine could not start. That is still "worth another go", so it is false
 * here, and the engine check at the top of import is what stops it looping.
 */
export function fullyScored(
	evals: readonly (number | null)[] | undefined,
	plies: number,
): boolean {
	return coverage(evals, plies) >= COMPLETE_ENOUGH;
}

/** What to tell the reader when it is not. Null when there is nothing to say. */
export function scoringNote(
	evals: readonly (number | null)[] | undefined,
	plies: number,
): string | null {
	if (plies <= 0) return null;
	const n = scoredPlies(evals);
	if (n >= plies) return null;
	if (n === 0) return 'none of this game was scored';
	return `${n} of ${plies} plies scored`;
}
