// A temporary line, shown in the move list that is already on the screen.
//
// ---------------------------------------------------------------------------
// Will:
//
//   "The explain panel still has its own move list and stepper. Why isn't it
//    integrated in the standard move list under the board? It seems the explain
//    would only need to inject the line to be displayed in the move list and a
//    cursor marking the current position, and then use the existing buttons to
//    step through … Then we don't need two components and keep the app unified.
//    There is always just one move list and the explainer just injects the
//    temporary sequence."
//
// That is the right shape and it is smaller than what it replaces. The app had
// three ways to show a sequence of moves — the game's own list, `LineStepper`
// for an explanation, and a third arrangement in the mate proof — each with its
// own chips, its own cursor and its own step buttons. A reader had to learn the
// screen three times, and a change to any of it landed in one place out of
// three.
//
// SO THERE IS ONE MOVE LIST, and a line borrows it. The overlay holds a `Line`,
// a cursor and a label; the host renders the overlay's chips instead of the
// game's while it is set, and the step controls already under the board drive
// it. Closing gives the list back.
//
// ---------------------------------------------------------------------------
// WHAT THE OVERLAY DOES NOT OWN: the board. The host still publishes the
// position, because it is the host that knows where the board is and what else
// might be drawing on it — but it reads the position straight off this, so the
// two cannot disagree about which ply is showing.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from 'react';
import { type Line, stepAt, arrowFor, positionsOf } from '../domain/line';
import { walkThrough } from '../domain/walk';
import type { MoveChip } from '../components/MoveList';
import type { BoardOverride } from '../components/LineStepper';

/**
 * What a line can hang on its own moves.
 *
 * Will: "before the explain panel showed the move eval scores in the line, but
 * now it doesn't anymore?" It did, and moving the line into the shared move
 * list dropped it — `LineStepper` took a `mark` per ply and nothing replaced it.
 * `MoveChip` was given a `note` field for exactly this and then never handed
 * one, which is how a feature disappears without a single test noticing.
 *
 * Deliberately a callback rather than an array: the caller knows what its own
 * numbers mean and the overlay does not need to.
 */
/**
 * A mark is a verdict — good, bad, or worth a look — so it deliberately cannot
 * be `muted`. `MoveChip` allows muted for the Lab's "no verdict" chips, which is
 * the opposite of what a mark is for, and `LineStepper` never accepted it.
 */
export type LineMark = { text: string; tone?: 'good' | 'bad' | 'warn' };

export type LineExtras = {
	/** Ask a further question about one ply — the explainer's recursion. */
	onAsk?: (ply: number) => void;
	/** A number or a flag beside a move: a material swing, a forcing move. */
	mark?: (ply: number) => LineMark | undefined;
};

export type LineOverlay = LineExtras & {
	line: Line;
	label: string;
	/** -1 is before the line starts, so the claim can be seen from both ends. */
	at: number;
};

export type LineOverlayState = {
	overlay: LineOverlay | null;
	/** The line's plies as move-list chips, or null when nothing is borrowed. */
	chips: MoveChip[] | null;
	/** What the board should show while the overlay is up. */
	board: BoardOverride;
	show: (line: Line, label: string, extras?: LineExtras) => void;
	close: () => void;
	setAt: (at: number) => void;
	step: (delta: number) => void;
	/** True when the step controls should drive the overlay rather than the game. */
	active: boolean;
	/**
	 * Positions the board should pass through to reach the current one.
	 *
	 * -------------------------------------------------------------------------
	 * Will: "when I press 'Back to the start of the line' after viewing a branch
	 * sequence it animates all pieces moving back to their positions at the same
	 * time. It would be more intuitive if they were animated one at a time so it
	 * is actually reversing the move sequence."
	 *
	 * The walk was wired for jumps in the GAME's move list and for leaving a
	 * line, and not for jumps WITHIN one — so the one control whose whole job is
	 * to travel several plies at once, "back to the start", was the one that
	 * still teleported.
	 *
	 * It belongs here rather than in each host because the positions are the
	 * overlay's own: it already computes `board` from `stepAt`, so it is the only
	 * thing that can say what lies between two cursor positions without being
	 * told. Two hosts wiring this separately is how the arrows and the table came
	 * to disagree twice.
	 */
	via: { to: string; through: string[] } | null;
};

export function useLineOverlay(): LineOverlayState {
	const [overlay, setOverlay] = useState<LineOverlay | null>(null);
	const [via, setVia] = useState<{ to: string; through: string[] } | null>(null);

	/** Move the cursor, and remember the way there so the board can replay it. */
	const goTo = useCallback((next: (o: LineOverlay) => number) => {
		setOverlay((o) => {
			if (!o) return o;
			const at = Math.max(-1, Math.min(o.line.steps.length - 1, next(o)));
			// Computed here, in the same place the cursor moves, so the two cannot
			// describe different journeys.
			setVia(walkThrough(positionsOf(o.line), o.at + 1, at + 1));
			return { ...o, at };
		});
	}, []);

	const show = useCallback((line: Line, label: string, extras?: LineExtras) => {
		// A line that has just appeared has nothing to walk back through: the
		// board is arriving somewhere new, and pretending otherwise would animate
		// a journey that did not happen.
		setVia(null);
		setOverlay({ line, label, at: -1, ...extras });
	}, []);

	const close = useCallback(() => {
		// Leaving is the HOST's walk — the destination is the game's position,
		// which this deliberately knows nothing about. See Train's `closeLine`.
		setVia(null);
		setOverlay(null);
	}, []);

	const setAt = useCallback((at: number) => goTo(() => at), [goTo]);

	const step = useCallback((delta: number) => goTo((o) => o.at + delta), [goTo]);

	/**
	 * The line as chips the existing list can render.
	 *
	 * `ply` is the INDEX IN THE LINE, not a ply of the game — the list only uses
	 * it as a handle to jump to, and the overlay's `onJump` reads it back the same
	 * way. Numbering them as game plies would put a hypothetical move at a real
	 * move's number, which is a claim about the game that did not happen.
	 */
	const chips = useMemo<MoveChip[] | null>(() => {
		if (!overlay) return null;
		return overlay.line.steps.map((s, i) => {
			const mark = overlay.mark?.(i);
			return {
				san: s.san,
				ply: i,
				mistake: false,
				suboptimal: false,
				white: s.colour === 'w',
				note: mark?.text,
				tone: mark?.tone,
			};
		});
	}, [overlay]);

	const board = useMemo<BoardOverride>(() => {
		if (!overlay) return null;
		const { fen, lastMove } = stepAt(overlay.line, overlay.at);
		return { fen, lastMove, arrows: arrowFor(overlay.line, overlay.at) };
	}, [overlay]);

	return { overlay, chips, board, show, close, setAt, step, via, active: overlay !== null };
}
