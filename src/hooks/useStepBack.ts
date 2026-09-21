// Looking back through the game you are in, without leaving it.
//
// ---------------------------------------------------------------------------
// THIS IS NOT A TAKE BACK, AND THE DIFFERENCE IS THE WHOLE DESIGN.
//
// Will, asked whether taking a move back in a game against the engine should
// cost anything:
//
//   "I don't think it should function as a take back — it should just step back
//    so user can review history by stepping through it. Game remains in current
//    position and user can only play on from that position. So no concession
//    needed."
//
// Which dissolves the question. A take back rewinds the GAME: the position
// moves, the moves after it are unplayed, and the result is a game you have
// edited, which is why it would have had to be declared as help before the
// rating estimate could trust the score. Stepping back rewinds only the VIEW.
// The game is exactly where it was, the engine is still waiting on the same
// position, and nothing has happened that anyone needs to be told about.
//
// So the board goes read-only while you are looking, and steps forward to the
// live position to hand control back. That is the same rule Mistakes already
// applies to a card's run-up — "stepping back is for looking; answering
// somewhere else in the game would be answering a different question."
//
// ---------------------------------------------------------------------------
// WHY IT IS A HOOK.
//
// Train and Mistakes each hold a `previewPly: number | null` and each replay
// the path themselves, and Play would have been the third. So this exists, and
// Play is its one reader TODAY — which is worth saying plainly rather than
// implying otherwise.
//
// MISTAKES IS THE NEXT ADOPTER and should be: its rule is already this one
// exactly ("stepping back is for looking"), so the migration is mechanical and
// the only reason it has not happened is that it would change a screen nobody
// asked to have changed.
//
// THE TRAINER IS NOT, and that is a decision rather than a backlog item. It can
// RESUME from a ply it has stepped to, which truncates the run and is a genuine
// take back. Folding that in would mean a hook whose cursor sometimes edits the
// game, which is the exact distinction this file exists to hold.
//
// Modelled on `useLineOverlay`, deliberately: the cursor and the board override
// live together so they cannot describe different plies, and the walk between
// two cursor positions is computed in the same place the cursor moves. A host
// that wired those separately is how the arrows and the move table came to
// disagree, twice.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from 'react';
import { replayLine } from '../domain/chess';
import { walkThrough } from '../domain/walk';
import { canStepBack, canStepForward, clampCursor, cursorIndex } from '../domain/cursor';

export type StepBack = {
	/**
	 * The ply being looked at, or null for the live position.
	 *
	 * Null rather than `path.length` so that playing a move does not have to
	 * move the cursor: "wherever the game is" stays true on its own.
	 */
	at: number | null;
	/** True when the board is showing the position the game is actually in. */
	live: boolean;
	/** What the board should show, or null to leave it to the host. */
	fen: string | null;
	lastMove: [string, string] | undefined;
	/** Positions to pass through on the way here — see `domain/walk`. */
	via: { to: string; through: string[] } | null;
	/** Move the cursor by whole plies. Clamped; forward past the end goes live. */
	step: (delta: number) => void;
	/** The start of the game. */
	first: () => void;
	/** Give the board back to the game. */
	toLive: () => void;
	canBack: boolean;
	canForward: boolean;
};

/**
 * @param path the game's moves in SAN, longest first — the live game's own.
 */
export function useStepBack(path: string[]): StepBack {
	const [at, setAt] = useState<number | null>(null);
	const [via, setVia] = useState<{ to: string; through: string[] } | null>(null);

	// Keyed on the moves rather than the array identity: the host rebuilds the
	// path object on every render and this would otherwise replay the game each
	// time.
	const key = path.join(' ');
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const line = useMemo(() => replayLine(path), [key]);
	const last = line.length - 1;

	/*
	 * ONE PLACE THE CURSOR MOVES, so the walk cannot describe a different
	 * journey from the one the board makes. The arithmetic is `domain/cursor`'s;
	 * what is here is remembering the way.
	 */
	const goTo = useCallback(
		(target: number) => {
			setAt((cur) => {
				const to = clampCursor(target, last);
				setVia(
					walkThrough(
						line.map((p) => p.fen),
						cursorIndex(cur, last),
						cursorIndex(to, last),
					),
				);
				return to;
			});
		},
		[line, last],
	);

	const step = useCallback((delta: number) => goTo(cursorIndex(at, last) + delta), [goTo, at, last]);
	const first = useCallback(() => goTo(0), [goTo]);
	const toLive = useCallback(() => goTo(last), [goTo, last]);

	const here = at === null ? null : line[at];

	return {
		at,
		live: at === null,
		fen: here?.fen ?? null,
		// The move that REACHED the position being looked at, which is the one the
		// board should be highlighting — `line[at]` carries the move that produced
		// it, and at ply 0 there is none.
		lastMove: here?.uci ? ([here.uci.slice(0, 2), here.uci.slice(2, 4)] as [string, string]) : undefined,
		via,
		step,
		first,
		toLive,
		canBack: canStepBack(at, last),
		canForward: canStepForward(at),
	};
}
