// The positions between two positions.
//
// ---------------------------------------------------------------------------
// Will: "I'm wondering whether whenever we step or forward we can actually show
// the animation? Including if we've been stepping through a branch move
// sequence, if we return to the game it would be useful to animate the sequence
// of moving the pieces back — that way user gets intuitive visual cue."
//
// Chessground animates every position change, so a single ply was always
// animated. A JUMP was the problem: going back four moves at once slides every
// piece straight to where it ends up, simultaneously, and a piece that moved
// twice cuts a diagonal across squares it was never on. The reader sees that
// something changed and learns nothing about what.
//
// Replaying the plies fixes it, and the only thing that needs deciding is which
// positions lie between the two — which is this, and which is arithmetic rather
// than anything to do with chess or with the board. Separated out because it is
// the part worth testing: the off-by-one at each end is the whole of it, and
// getting it wrong shows the destination twice or skips the first move.
// ---------------------------------------------------------------------------

/**
 * The positions strictly between `from` and `to`, in travel order.
 *
 * Both ends are excluded on purpose. The board is already showing `from`, and
 * it is about to be set to `to` by the ordinary path — this is only the middle,
 * so that the walk cannot disagree with the position the rest of the app thinks
 * is current.
 *
 * Returns `null` when there is nothing to walk: adjacent positions animate
 * correctly on their own, and a null means "no walk" rather than an empty one
 * so the board can tell the two apart.
 */
export function walkThrough(
	fens: readonly string[],
	from: number,
	to: number,
): { to: string; through: string[] } | null {
	if (from === to) return null;
	if (from < 0 || to < 0 || from >= fens.length || to >= fens.length) return null;
	// Adjacent: chessground's own animation is exactly right for one move, and
	// interposing a step would only delay it.
	if (Math.abs(from - to) === 1) return null;

	const step = to > from ? 1 : -1;
	const through: string[] = [];
	for (let i = from + step; i !== to; i += step) through.push(fens[i]);
	return { to: fens[to], through };
}

/**
 * The walk back out of a borrowed line and onto a position of its own.
 *
 * The line's positions are indexed from −1 (before its first move), so the
 * reverse walk runs down to that and then lands somewhere the line does not
 * contain at all — the live game. That last hop is the destination rather than
 * a step, which is why this cannot just be `walkThrough` with the arguments
 * swapped.
 */
export function walkBackTo(
	linePositions: readonly string[],
	at: number,
	destination: string,
): { to: string; through: string[] } | null {
	// `at` is −1 at the start of a line, so index 0 of `linePositions` is that
	// starting position and `at + 1` is where the cursor actually sits.
	const cursor = at + 1;
	if (cursor <= 0) return null;
	const through: string[] = [];
	for (let i = cursor - 1; i >= 0; i--) through.push(linePositions[i]);
	return { to: destination, through };
}

/**
 * The walk back to an earlier ply of THIS game, landing on a different position.
 *
 * ---------------------------------------------------------------------------
 * Will: "I asked you before that whenever we rewind the animation is a single
 * move at a time. That is not happening when user clicks 'new reply'."
 *
 * It was not, and the reason is that "new reply" is not a rewind — it is a
 * rewind FOLLOWED BY a different move. The board ends up somewhere the current
 * game's positions do not contain, so neither `walkThrough`, which travels
 * between two plies of one line, nor `walkBackTo`, which leaves a borrowed line
 * for the game, described it. Nothing did, so nothing animated, so the one
 * control whose whole point is "same position, different outcome" teleported
 * to the outcome.
 *
 * `from` and `to` are ply counts into `fens`. The walk starts one ply back from
 * `from` — the board is already showing `from` — runs down to and INCLUDING
 * `to`, which is the position being returned to, and then lands on
 * `destination`, which is what was played from it instead.
 */
export function walkBack(
	fens: readonly string[],
	from: number,
	to: number,
	destination: string,
): { to: string; through: string[] } | null {
	if (from <= to || to < 0 || from >= fens.length) return null;
	const through: string[] = [];
	for (let i = from - 1; i >= to; i--) through.push(fens[i]);
	// The destination can BE the position returned to, when nothing has been
	// played from it yet. Showing it twice in a row is a dropped frame that reads
	// as a stutter.
	while (through.length && through[through.length - 1] === destination) through.pop();
	return through.length ? { to: destination, through } : null;
}
