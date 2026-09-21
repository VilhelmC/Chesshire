// Where a "looking back" cursor lands.
//
// ---------------------------------------------------------------------------
// The arithmetic behind `hooks/useStepBack`, pulled out for the same reason
// `domain/walk.ts` was: the off-by-one at each end is the whole of it, and it
// is the part worth testing. Rendering a hook needs a DOM this project does not
// install, and the claim being made is not about React anyway.
//
// ONE CONVENTION, WRITTEN DOWN ONCE. The cursor is either a ply index into the
// game's positions, or NULL, meaning "wherever the game actually is". Null
// rather than `last` so that playing a move does not have to move the cursor —
// "live" stays true by itself, and the alternative is a cursor that silently
// stops following the game the moment anyone forgets to advance it.
// ---------------------------------------------------------------------------

/**
 * The cursor's position as an index, treating live as the last position.
 *
 * `last` is the index of the live position, which for a game of n moves is n:
 * `replayLine` puts the starting position at 0 and each move after it.
 */
export function cursorIndex(at: number | null, last: number): number {
	return at ?? last;
}

/**
 * Where a request to go to `target` actually lands.
 *
 * Returns null — live — for anything at or past the end, so stepping forward
 * off the last ply hands the board back to the game. The end of the list IS the
 * live position, and a forward control that refused the final press would look
 * broken for no reason a reader could see.
 */
export function clampCursor(target: number, last: number): number | null {
	if (last <= 0) return null;
	if (target >= last) return null;
	return Math.max(0, target);
}

/** There is history behind the cursor to step into. */
export function canStepBack(at: number | null, last: number): boolean {
	return last > 0 && cursorIndex(at, last) > 0;
}

/** The cursor is somewhere other than live, so forward means something. */
export function canStepForward(at: number | null): boolean {
	return at !== null;
}
