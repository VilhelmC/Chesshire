// Where you are, in one line above the board.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A FUNCTION AND NOT A LINE OF JSX.
//
// Will: "I think 'Play' tab should be reporting the current Line we're in if
// position belongs to one, just like Train does … Mistakes could probably also
// show this above the board so layout is consistent … Perhaps that message
// should be part of the standard machinery everything consumes, so a board is
// always displayed with the line it belongs to if such a line exists."
//
// There were four answers to "where am I" on four screens. Train had a
// paragraph with three cases. Quiz and Play had nothing at all. Review had
// "ply 12 / 42", which is true and tells you nothing about the game. One
// definition, four readers, three of them silent — the repo's usual failure,
// in its quietest form: nothing is WRONG on any screen, there is just less
// there than there should be, and no single place to fix it.
//
// ---------------------------------------------------------------------------
// THE LINE SPLITS IN TWO, AND THE SPLIT IS WHAT MAKES IT SHAREABLE.
//
//   WHERE — the opening and the move number. Derivable from the moves that
//   reached the position and NOTHING else, which is exactly why every screen
//   can have it: a board that knows its path can always say this much, with no
//   engine, no deck, no network and no idea what tab it is on.
//
//   WHY YOU ARE LOOKING AT IT — "you played ♞Nxe5 · missed 4×" is mistake-card
//   data; "off book — find the strongest continuation" is the drill's phase;
//   "reviewing a game against nordicwolf" is Review's. No shared function can
//   know any of them, so they arrive as segments the view supplies.
//
// Only the first half lives here. A caller cannot get it wrong, and cannot get
// a different answer from the caller on the next tab.
//
// ---------------------------------------------------------------------------
// TWO SOURCES FOR THE NAME, AND THE ORDER IS DECIDED HERE.
//
// The explorer names a position when it recognises one, and the bundled table
// names it from the moves. They disagree, and both ways round:
//
//   * the explorer knows TRANSPOSITIONS — it is looking at the position, so it
//     recognises the Italian reached in an unusual order, and the table, which
//     only ever sees the move list it was handed, does not;
//   * the table is ALWAYS THERE — offline, tokenless, and instantly, whereas
//     the explorer is a fetch that may not have returned yet or at all.
//
// So: the explorer wins when it spoke, because it saw the actual position; the
// table answers when it did not. That is one rule, and the reason it is written
// down here rather than at each call site is that a rule applied in four places
// is four rules — which is how one position ends up named two things on two
// tabs, with no way to tell which tab is lying.
// ---------------------------------------------------------------------------

import { nameForPath } from './openings';

/** What a board knows about where it is. */
export type Where = {
	/** The SAN moves that reached the position. */
	path: string[];
	/**
	 * What the explorer called it, if it said anything.
	 *
	 * `undefined` and `null` both mean "it did not name this" — the explorer's
	 * own field is nullable and a caller that has not fetched has neither.
	 */
	opening?: string | null;
	/**
	 * Half-moves played, when that is not `path.length`.
	 *
	 * A mistake card carries its own `ply`, recorded when the card was made, and
	 * cards made before paths were stored have the ply and an empty path. Taking
	 * it separately means those still say which move it was.
	 */
	ply?: number;
};

/**
 * The move number a position is AT — the number that would be written before
 * the move about to be played.
 *
 * Eight half-moves have been played, so White is about to play their fifth:
 * `moveNumber(8) === 5`. Not `ply / 2` rounded anywhere, which gets Black's
 * side of the move wrong half the time.
 */
export function moveNumber(ply: number): number {
	return Math.floor(Math.max(0, ply) / 2) + 1;
}

/**
 * What this position is called, by whichever source knows — see the header for
 * why the explorer goes first.
 *
 * Separate from `whereYouAre` because the name alone is wanted too: pinning a
 * position to practise from labels it with this, and that call site had its own
 * copy of the same two-source rule before this existed.
 */
export function nameOf(w: Where): string | null {
	// An empty string is not a name: the explorer returns one for a position it
	// half-recognises, and `??` would keep it.
	return w.opening?.trim() || nameForPath(w.path)?.name || null;
}

/**
 * Where you are, or null at the start of a game.
 *
 * Null rather than "Starting position": the initial position is the one place
 * in chess where nobody needs telling where they are, and a caption that is
 * never empty is a caption that has stopped carrying information.
 */
export function whereYouAre(w: Where): string | null {
	const ply = w.ply ?? w.path.length;
	if (ply <= 0) return null;
	const named = nameOf(w);
	// "3…" is Black's third move. Chess notation's own convention, and the
	// mistake deck was already using it — which matters, because the deck's row
	// and the line above the board describe the same card and disagreeing about
	// whose move it was is exactly the kind of small difference that reads as a
	// bug in the app.
	const move = `move ${moveNumber(ply)}${ply % 2 === 0 ? '' : '…'}`;
	return named ? `${named}, ${move}` : move;
}
