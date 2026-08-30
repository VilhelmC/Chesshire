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
import { type Line, stepAt, arrowFor } from '../domain/line';
import type { MoveChip } from '../components/MoveList';
import type { BoardOverride } from '../components/LineStepper';

export type LineOverlay = {
	line: Line;
	label: string;
	/** -1 is before the line starts, so the claim can be seen from both ends. */
	at: number;
	/** Ask a further question about one ply — the explainer's recursion. */
	onAsk?: (ply: number) => void;
};

export type LineOverlayState = {
	overlay: LineOverlay | null;
	/** The line's plies as move-list chips, or null when nothing is borrowed. */
	chips: MoveChip[] | null;
	/** What the board should show while the overlay is up. */
	board: BoardOverride;
	show: (line: Line, label: string, onAsk?: (ply: number) => void) => void;
	close: () => void;
	setAt: (at: number) => void;
	step: (delta: number) => void;
	/** True when the step controls should drive the overlay rather than the game. */
	active: boolean;
};

export function useLineOverlay(): LineOverlayState {
	const [overlay, setOverlay] = useState<LineOverlay | null>(null);

	const show = useCallback((line: Line, label: string, onAsk?: (ply: number) => void) => {
		setOverlay({ line, label, at: -1, onAsk });
	}, []);

	const close = useCallback(() => setOverlay(null), []);

	const setAt = useCallback((at: number) => {
		setOverlay((o) => (o ? { ...o, at: Math.max(-1, Math.min(o.line.steps.length - 1, at)) } : o));
	}, []);

	const step = useCallback(
		(delta: number) => {
			setOverlay((o) => (o ? { ...o, at: Math.max(-1, Math.min(o.line.steps.length - 1, o.at + delta)) } : o));
		},
		[],
	);

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
		return overlay.line.steps.map((s, i) => ({
			san: s.san,
			ply: i,
			mistake: false,
			suboptimal: false,
			white: s.colour === 'w',
		}));
	}, [overlay]);

	const board = useMemo<BoardOverride>(() => {
		if (!overlay) return null;
		const { fen, lastMove } = stepAt(overlay.line, overlay.at);
		return { fen, lastMove, arrows: arrowFor(overlay.line, overlay.at) };
	}, [overlay]);

	return { overlay, chips, board, show, close, setAt, step, active: overlay !== null };
}
