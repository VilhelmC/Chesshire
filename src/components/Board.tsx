// chessground wrapper. Deliberately dumb: it renders a FEN, reports moves,
// and knows nothing about drills.

import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';
import { positionFromFen, chessgroundDests, sideToMove, parseSquare } from '../domain/chess';
import { registerDebug } from '../data/debug';

import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

export type BoardProps = {
	fen: string;
	orientation?: 'white' | 'black';
	interactive?: boolean;
	/**
	 * Which side the user may move.
	 * 'auto' (default) — only the side to move, i.e. real game rules. Correct for
	 *   drills, where you are always one specific colour.
	 * 'both' — free play for either side. Used by the M0 harness and sandbox
	 *   analysis, where restricting to the side to move just looks broken.
	 */
	movableColor?: 'auto' | 'both';
	lastMove?: [string, string];
	/**
	 * Arrows. Alongside chessground's stock brushes, `q0`–`q4` are registered
	 * below as a quality ramp: one hue, strong-to-faint, thick-to-thin, so move
	 * quality is carried by two channels rather than colour alone.
	 */
	arrows?: { orig: string; dest: string; brush: string; label?: string }[];
	onMove?: (uci: string) => void;
	size?: number;
	/**
	 * Bump to force the board back to `fen` even though it has not changed.
	 *
	 * Chessground moves the piece optimistically on drop. When a move is REJECTED
	 * the run state does not change, so without this the board would keep showing
	 * a move that was never accepted.
	 */
	version?: number;
};

export function Board({
	fen,
	orientation = 'white',
	interactive = false,
	movableColor = 'auto',
	lastMove,
	arrows = [],
	onMove,
	size = 420,
	version = 0,
}: BoardProps) {
	const ref = useRef<HTMLDivElement>(null);
	const api = useRef<Api | null>(null);
	const onMoveRef = useRef(onMove);
	onMoveRef.current = onMove;

	const lastFen = useRef<string>('');
	const lastVersion = useRef<number>(-1);
	const lastMoveKey = lastMove ? lastMove.join('') : '';
	const arrowsKey = arrows.map((a) => `${a.orig}${a.dest}${a.brush}${a.label ?? ''}`).join(',');

	useEffect(() => {
		if (!ref.current) return;
		api.current = Chessground(ref.current, {
			fen,
			// Rank and file labels are drawn inside the edge squares. On a phone
			// each square is about 40px with a piece already filling it, and the
			// label becomes clutter you cannot read rather than a reference you
			// can. The board's own geometry is the reference at that size.
			coordinates: size >= COORDS_MIN,
			// `fen` sets the PIECES ONLY. Chessground keeps `turnColor` as separate
			// state and defaults it to white, and a piece is draggable only when
			// `turnColor === piece.color`. Omitting it here meant every board built
			// on a black-to-move position was inert until something else happened to
			// push a new position through.
			turnColor: turnOf(fen),
			orientation,
			lastMove: lastMove as Key[] | undefined,
			movable: { free: false, showDests: true },
			draggable: { enabled: interactive },
			drawable: {
				enabled: false,
				brushes: {
					...QUALITY_BRUSHES,
				},
			},
		});

		// These refs cache what was last pushed to THIS instance, so they belong to
		// its lifetime. Leaving them set across a remount is what let the guard in
		// the position effect below skip the one write a fresh board needs.
		lastFen.current = fen;
		lastVersion.current = version;

		return () => {
			api.current?.destroy();
			api.current = null;
			lastFen.current = '';
			lastVersion.current = -1;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ---------------------------------------------------------------------
	// Position and interaction are updated by SEPARATE effects, on purpose.
	//
	// They used to share one. While a move was being evaluated `interactive`
	// flipped to false, which changed the effect's dependencies and re-ran
	// `cg.set({ fen })` with the position from BEFORE the move — chessground
	// animated the piece back to where it started, then animated it forward
	// again alongside the reply. That is the "my move plays twice" bug.
	//
	// Writing `fen` only when the position actually changes keeps every other
	// prop free to change without disturbing the board.
	// ---------------------------------------------------------------------

	useEffect(() => {
		const cg = api.current;
		if (!cg) return;
		if (lastFen.current === fen && lastVersion.current === version) return;
		lastFen.current = fen;
		lastVersion.current = version;

		cg.set({
			fen,
			turnColor: turnOf(fen),
			lastMove: lastMove as Key[] | undefined,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fen, lastMoveKey, version]);

	useEffect(() => {
		const cg = api.current;
		if (!cg) return;
		// Set here as well as at construction: the board is not rebuilt when the
		// window is resized, and rotating a phone crosses this threshold.
		cg.set({ coordinates: size >= COORDS_MIN });

		let dests = new Map<Key, Key[]>();
		try {
			dests = chessgroundDests(positionFromFen(fen)) as Map<Key, Key[]>;
		} catch {
			/* invalid FEN — no legal-move data */
		}
		const turn = turnOf(fen);

		cg.set({
			orientation,
			movable: {
				free: false,
				color: interactive ? (movableColor === 'both' ? 'both' : turn) : undefined,
				dests: interactive ? dests : new Map(),
				showDests: true,
				events: {
					after: (orig, dest) => {
						const promo = isPromotion(fen, orig, dest) ? 'q' : '';
						onMoveRef.current?.(`${orig}${dest}${promo}`);
					},
				},
			},
			draggable: { enabled: interactive },
			selectable: { enabled: interactive },
			drawable: {
				enabled: false,
				autoShapes: arrows.map((a) => ({
					orig: a.orig as Key,
					dest: a.dest as Key,
					brush: a.brush,
					// Chessground draws this at the arrow head. Putting the evaluation
					// on the board means the arrow's weight and its actual value are
					// read in one place, rather than eye-tracking to a side list.
					...(a.label ? { label: { text: a.label } } : {}),
				})),
			},
		});
		// `version` is in here as well as in the position effect, and it has to be.
		// Chessground CONSUMES movable.dests when a move is played — after a drop
		// the board has no legal destinations until they are set again. Re-showing
		// the same position (a rejected move, a second attempt at the same card)
		// changes neither `fen` nor any other dependency, so without `version` the
		// position would be restored with an empty dests map and the board would
		// simply stop accepting moves. That is the "I can't move on this card" bug.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fen, orientation, interactive, movableColor, arrowsKey, version, size]);

	// What chessground ITSELF believes, as opposed to what we asked for. The two
	// diverging is the whole class of "the board looks right but will not move".
	useEffect(() =>
		registerDebug('chessground', () => {
			const st = api.current?.state;
			if (!st) return { mounted: false };
			return {
				mounted: true,
				turnColor: st.turnColor,
				orientation: st.orientation,
				movableColor: st.movable.color ?? null,
				movableFree: st.movable.free,
				destsSize: st.movable.dests?.size ?? 0,
				draggable: st.draggable.enabled,
				selectable: st.selectable.enabled,
				viewOnly: st.viewOnly,
				boundsKnown: !!st.dom?.bounds?.(),
				// The invariant that broke: chessground only allows a drag when
				// turnColor matches the piece's colour, so this must agree with
				// movableColor or the board is inert.
				canMove: st.movable.color === 'both' || st.movable.color === st.turnColor,
				// Chessground's OWN dests, not our recomputation of them. The two
				// diverging is invisible otherwise: `describePosition` derives the
				// legal moves from the FEN and will happily report a move as legal
				// that the board was never told about.
				dests: Object.fromEntries([...(st.movable.dests ?? new Map())]),
			};
		}),
	);

	return <div ref={ref} style={{ width: size, height: size }} />;
}

/** Board size below which rank/file labels stop being legible and become noise. */
const COORDS_MIN = 360;

/** Chessground's turn colour for a FEN; white if the FEN is unreadable. */
function turnOf(fen: string): 'white' | 'black' {
	try {
		return sideToMove(fen) === 'w' ? 'white' : 'black';
	} catch {
		return 'white';
	}
}

/**
 * A single-hue quality ramp for candidate-move arrows.
 *
 * Sequential rather than red-to-green on purpose: the encoding is "how good",
 * a magnitude, and a red arrow on a legal move reads as "forbidden". Width
 * carries the same information as lightness so the ramp survives a colour-vision
 * difference, and the move list beside the board is direct-labelled so identity
 * never rests on the arrow alone.
 */
const STOCK_BRUSHES = {
	green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
	red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
	blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
	yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
};

const QUALITY_BRUSHES = {
	...STOCK_BRUSHES,
	q0: { key: 'q0', color: '#0b6b3a', opacity: 0.95, lineWidth: 14 },
	q1: { key: 'q1', color: '#1d8a52', opacity: 0.8, lineWidth: 11 },
	q2: { key: 'q2', color: '#4aa877', opacity: 0.65, lineWidth: 9 },
	q3: { key: 'q3', color: '#86bfa2', opacity: 0.5, lineWidth: 7 },
	q4: { key: 'q4', color: '#b9d6c8', opacity: 0.4, lineWidth: 5 },
};

/** True if moving orig->dest is a pawn reaching the last rank. */
export function isPromotion(fen: string, orig: string, dest: string): boolean {
	const rank = dest[1];
	if (rank !== '1' && rank !== '8') return false;
	try {
		const pos = positionFromFen(fen);
		const square = parseSquare(orig);
		if (square === undefined) return false;
		return pos.board.getRole(square) === 'pawn';
	} catch {
		return false;
	}
}
