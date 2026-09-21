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

/**
 * One thing drawn on the board.
 *
 * `dest` omitted is a CIRCLE on `orig` rather than an arrow — a fact about a
 * square has no direction, and inventing one is a lie about the data. `label` is
 * drawn at the arrow head, so a weight and the move it belongs to are read in one
 * place.
 *
 * Declared here, with the board, rather than in whichever panel needed it first.
 * It lived in `ComplexPanel` and every later panel imported it from there, which
 * made a display type that has nothing to do with the deficiency formalism into a
 * dependency on a module scheduled for the attic.
 */
export type Shape = { orig: string; dest?: string; brush: string; label?: string };

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
	// (see `Shape`, exported above, for the arrow vocabulary)
	lastMove?: [string, string];
	/**
	 * Arrows. Alongside chessground's stock brushes, `q0`–`q4` are registered
	 * below as a quality ramp: one hue, strong-to-faint, thick-to-thin, so move
	 * quality is carried by two channels rather than colour alone.
	 */
	arrows?: Shape[];
	onMove?: (uci: string) => void;
	/**
	 * A square was clicked. Used by the Lab to choose what to inspect; ordinary
	 * boards leave it unset and behave exactly as before.
	 */
	onSelectSquare?: (square: string) => void;
	/**
	 * Edit mode: pieces drag freely, dragging one off the board removes it, and
	 * every change reports the new board FEN. Used only by the Lab.
	 */
	editable?: boolean;
	onEdit?: (boardFen: string) => void;
	/** Hands the chessground instance out, so a tray can start a drag onto it. */
	apiRef?: (api: Api | null) => void;
	size?: number;
	/**
	 * Bump to force the board back to `fen` even though it has not changed.
	 *
	 * Chessground moves the piece optimistically on drop. When a move is REJECTED
	 * the run state does not change, so without this the board would keep showing
	 * a move that was never accepted.
	 */
	version?: number;
	/**
	 * Positions to pass through on the way to `fen`, so a jump reads as moves.
	 *
	 * -------------------------------------------------------------------------
	 * Will: "I'm wondering whether whenever we step or forward we can actually
	 * show the animation? Including if we've been stepping through a branch move
	 * sequence, if we return to the game it would be useful to animate the
	 * sequence of moving the pieces back — that way user gets intuitive visual
	 * cue."
	 *
	 * Chessground already animates every position change, including a jump of
	 * four plies — measured, not assumed. But a jump animates pieces STRAIGHT TO
	 * THEIR DESTINATIONS: going back four moves at once slides the bishop from
	 * c4 to f1 and the knight from f3 to g1 at the same time, and a piece that
	 * moved twice cuts a diagonal across squares it was never on. That is motion
	 * without meaning — it says something changed and nothing about what.
	 *
	 * So a caller that knows the intervening positions hands them over and the
	 * board plays them in order. It has to be the caller: only it can say
	 * whether two positions are joined by a line of play at all, and a jump
	 * between unrelated ones (a new run, a different game) must stay a jump
	 * rather than pretending to be a sequence of moves.
	 *
	 * `to` is carried alongside so a stale value cannot be misapplied — if it
	 * does not name the fen being set, this is not that walk.
	 */
	via?: { to: string; through: string[] } | null;
};

/**
 * The graph overlay's palette (DEFICIENCY.md §7, PLAN.md M1f).
 *
 * White and Black get different hues rather than two shades of one, because the
 * question asked of this picture is almost always "whose?" — and a board covered
 * in one colour at two opacities answers it slowly. Latent edges are the same
 * hue at low opacity and half the width: present, and visibly not acting.
 */
const GRAPH_BRUSHES = {
	gWhite: { key: 'gWhite', color: '#1f6feb', opacity: 0.55, lineWidth: 6 },
	gBlack: { key: 'gBlack', color: '#d2691e', opacity: 0.55, lineWidth: 6 },
	gWhiteX: { key: 'gWhiteX', color: '#1f6feb', opacity: 0.28, lineWidth: 3 },
	gBlackX: { key: 'gBlackX', color: '#d2691e', opacity: 0.28, lineWidth: 3 },
	gSense: { key: 'gSense', color: '#8957e5', opacity: 0.5, lineWidth: 4 },
	// Square facts (PLAN-OVERLAY.md). Amber for a contested square, red for one
	// only the enemy bears on, violet for the pin family — so hue alone says
	// which KIND of fact it is, before any reading.
	gExchange: { key: 'gExchange', color: '#d29922', opacity: 0.75, lineWidth: 5 },
	gLoose: { key: 'gLoose', color: '#da3633', opacity: 0.8, lineWidth: 5 },
	gPin: { key: 'gPin', color: '#a371f7', opacity: 0.85, lineWidth: 6 },
	gPinSoft: { key: 'gPinSoft', color: '#a371f7', opacity: 0.5, lineWidth: 4 },
	gPinFaint: { key: 'gPinFaint', color: '#a371f7', opacity: 0.3, lineWidth: 3 },
	// Distance, cool to warm: one ply away is close, four is nearly out of reach.
	// The number is drawn on the square too — a colour ramp alone is read as
	// "roughly", and a deadline is not a roughly.
	gD1: { key: 'gD1', color: '#3fb950', opacity: 0.7, lineWidth: 4 },
	gD2: { key: 'gD2', color: '#9e6a03', opacity: 0.6, lineWidth: 4 },
	gD3: { key: 'gD3', color: '#bd561d', opacity: 0.5, lineWidth: 4 },
	gD4: { key: 'gD4', color: '#8b949e', opacity: 0.4, lineWidth: 4 },
	// A square on every minimal route: block it and the journey lengthens.
	gGate: { key: 'gGate', color: '#f0883e', opacity: 0.9, lineWidth: 7 },
	// The ledger's rows (M3f). Amber for a debt owed now, faint for one that is
	// latent — recorded and not yet collectable. A latent row is drawn rather
	// than hidden, because hiding it is what made races invisible.
	gOwed: { key: 'gOwed', color: '#ffa657', opacity: 0.85, lineWidth: 6 },
	gOwedX: { key: 'gOwedX', color: '#ffa657', opacity: 0.35, lineWidth: 3 },
	// Γ (M4). One hue per discharge type, per AMEND-2-ARRIVES §1's table, and the
	// `X` variant for a cover that needs more than one tempo — the same live and
	// latent convention the attack layers use, because a cost-3 cover is exactly
	// as real and exactly as not-yet-acting as a blocked x-ray.
	gCovEvade: { key: 'gCovEvade', color: '#3fb950', opacity: 0.8, lineWidth: 5 },
	gCovEvadeX: { key: 'gCovEvadeX', color: '#3fb950', opacity: 0.3, lineWidth: 3 },
	gCovCapture: { key: 'gCovCapture', color: '#f85149', opacity: 0.8, lineWidth: 5 },
	gCovCaptureX: { key: 'gCovCaptureX', color: '#f85149', opacity: 0.3, lineWidth: 3 },
	gCovBlock: { key: 'gCovBlock', color: '#58a6ff', opacity: 0.8, lineWidth: 5 },
	gCovBlockX: { key: 'gCovBlockX', color: '#58a6ff', opacity: 0.3, lineWidth: 3 },
	gCovDefend: { key: 'gCovDefend', color: '#2dd4bf', opacity: 0.8, lineWidth: 5 },
	gCovDefendX: { key: 'gCovDefendX', color: '#2dd4bf', opacity: 0.3, lineWidth: 3 },
	// An obligation with no discharge in time. An absence cannot be an arrow.
	gUncovered: { key: 'gUncovered', color: '#da3633', opacity: 0.95, lineWidth: 8 },
	// Couplings (M5). The piece doing two jobs is the loudest thing on the board
	// because §6.6 says it is the thing to look for: "not the threatened piece —
	// the defender that cannot be in two places."
	gTwoJobs: { key: 'gTwoJobs', color: '#e3b341', opacity: 0.95, lineWidth: 7 },
	// A resolution coupling, by direction: green where running one chain OPENS
	// another, blue where it closes it. Cause to effect.
	gOpens: { key: 'gOpens', color: '#56d364', opacity: 0.7, lineWidth: 5 },
	gCloses: { key: 'gCloses', color: '#79c0ff', opacity: 0.7, lineWidth: 5 },
	// Every exchange square, faintly, so a coupling reads as a relation between
	// two of them rather than a fact about two arbitrary squares.
	gChain: { key: 'gChain', color: '#8b949e', opacity: 0.3, lineWidth: 3 },
};

export function Board({
	fen,
	orientation = 'white',
	interactive = false,
	movableColor = 'auto',
	lastMove,
	arrows = [],
	onMove,
	onSelectSquare,
	editable = false,
	onEdit,
	apiRef,
	size = 420,
	version = 0,
	via = null,
}: BoardProps) {
	const ref = useRef<HTMLDivElement>(null);
	const api = useRef<Api | null>(null);
	const onMoveRef = useRef(onMove);
	onMoveRef.current = onMove;
	// Through a ref so the handler can change without rebuilding the board —
	// the same reason onMove goes through one.
	const onSelectRef = useRef(onSelectSquare);
	onSelectRef.current = onSelectSquare;
	const onEditRef = useRef(onEdit);
	onEditRef.current = onEdit;
	const apiRefRef = useRef(apiRef);
	apiRefRef.current = apiRef;

	const lastFen = useRef<string>('');
	const lastVersion = useRef<number>(-1);
	const lastMoveKey = lastMove ? lastMove.join('') : '';
	const arrowsKey = arrows.map((a) => `${a.orig}${a.dest}${a.brush}${a.label ?? ''}`).join(',');
	// Built once, from the props, for both the initial config and the update
	// effect below. Two copies of this mapping is how a shape type gets supported
	// in one path and silently dropped in the other.
	const autoShapes = arrows.map((a) => ({
		orig: a.orig as Key,
		// A shape with no destination is a circle on its origin. The graph overlay
		// needs it: "this square's occupancy changes an edge" is a fact about the
		// square, and an arrow would invent a direction the fact does not have.
		...(a.dest ? { dest: a.dest as Key } : {}),
		brush: a.brush,
		// Chessground draws this at the arrow head. Putting the number on the board
		// means the arrow's weight and its value are read in one place.
		...(a.label ? { label: { text: a.label } } : {}),
	}));

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
			movable: { free: editable, color: editable ? 'both' : undefined, showDests: !editable },
			draggable: { enabled: interactive || editable, deleteOnDropOff: editable },
			drawable: {
				enabled: false,
				brushes: {
					...QUALITY_BRUSHES,
					...GRAPH_BRUSHES,
				},
			},
			events: {
				select: (key) => onSelectRef.current?.(key as string),
				change: () => {
					const cg = api.current;
					if (cg && onEditRef.current) onEditRef.current(cg.getFen());
				},
			},
		});

		apiRefRef.current?.(api.current);

		// ------------------------------------------------------------------
		// Chessground caches the board's bounding rectangle and maps a click to
		// a square using it. Anything that changes the layout AFTER mount — a
		// panel appearing above the board, a font finishing loading — leaves
		// that cache stale, and every click then lands one square off. It looks
		// like a coordinate bug and is a measurement bug.
		// ------------------------------------------------------------------
		const observer = new ResizeObserver(() => api.current?.redrawAll());
		observer.observe(ref.current);
		observer.observe(document.body);

		// These refs cache what was last pushed to THIS instance, so they belong to
		// its lifetime. Leaving them set across a remount is what let the guard in
		// the position effect below skip the one write a fresh board needs.
		lastFen.current = fen;
		lastVersion.current = version;

		return () => {
			observer.disconnect();
			apiRefRef.current?.(null);
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

		const land = () =>
			cg.set({
				fen,
				turnColor: turnOf(fen),
				lastMove: lastMove as Key[] | undefined,
				// Back to the ordinary duration, whatever a walk may have set.
				animation: { duration: ANIM_MS },
			});

		// A walk this caller asked for, for THIS position — see `via`. A value
		// left over from an earlier transition names a different destination and
		// is ignored rather than replayed at the wrong moment.
		const through = via && via.to === fen ? via.through : [];
		if (!through.length || reducedMotion()) {
			land();
			return;
		}

		/*
		 * The steps are paced to fit a fixed budget rather than given a fixed
		 * interval each. Ten plies at a comfortable 180ms is nearly two seconds
		 * of watching, which stops being a cue and becomes a wait — and the
		 * thing being communicated ("we went back that way") is just as clear
		 * faster. Never below chessground's own 70ms floor, under which it
		 * disables animation and the pieces teleport anyway.
		 */
		const interval = Math.max(MIN_STEP_MS, Math.min(STEP_MS, WALK_BUDGET_MS / through.length));
		/*
		 * EACH MOVE HAS TO FINISH INSIDE ITS OWN SLOT.
		 *
		 * Will: "it would be more intuitive if they were animated one at a time so
		 * it is actually reversing the move sequence."
		 *
		 * One position per slot already means one piece moves at a time. But
		 * chessground's animation is a fixed 200ms, so on a long walk — where the
		 * budget squeezes the slots below that — every move is cut off partway and
		 * the next begins, and a dozen half-finished slides read as one smear. The
		 * duration follows the pacing instead, so each move lands before the next
		 * one starts and the sequence stays countable.
		 */
		const duration = Math.max(MIN_STEP_MS, interval - 20);
		let cancelled = false;
		let i = 0;
		const timers: number[] = [];
		const tick = () => {
			if (cancelled) return;
			if (i < through.length) {
				const at = through[i++];
				cg.set({ fen: at, turnColor: turnOf(at), animation: { duration } });
				timers.push(window.setTimeout(tick, interval));
			} else {
				land();
			}
		};
		tick();
		return () => {
			cancelled = true;
			for (const t of timers) window.clearTimeout(t);
			// Whatever interrupted this walk is about to set its own position, and
			// the board must not be left halfway along a path nobody is on.
			if (lastFen.current === fen) land();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fen, lastMoveKey, version, via]);

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

		// This effect re-applies the interaction config on every position change,
		// which is why edit mode has to be repeated here rather than only set at
		// construction: the first version configured `deleteOnDropOff` once and
		// this line quietly turned dragging back off a moment later. Dropping a
		// piece off the board did nothing, and pieces from the tray still worked,
		// because `dragNewPiece(..., force)` ignores `draggable.enabled` — which
		// is exactly the kind of half-working that hides the cause.
		cg.set({
			orientation,
			movable: {
				free: editable,
				color: editable ? 'both' : interactive ? (movableColor === 'both' ? 'both' : turn) : undefined,
				dests: interactive && !editable ? dests : new Map(),
				showDests: !editable,
				events: {
					after: (orig, dest) => {
						if (editable) return;
						const promo = isPromotion(fen, orig, dest) ? 'q' : '';
						onMoveRef.current?.(`${orig}${dest}${promo}`);
					},
				},
			},
			draggable: { enabled: interactive || editable, deleteOnDropOff: editable },
			// SELECTING A SQUARE IS INSPECTION, NOT A MOVE, so it is enabled whenever
			// anybody is listening for it — not only when the board is playable.
			//
			// It used to be `interactive || editable`, which meant the safe-moves
			// overlay could not be pointed at a man while the engine was thinking, or
			// on the opponent's turn, or at the end of a line. The wheel would say
			// "click a man on the board" and clicking did nothing.
			//
			// This cannot leak a move: `movable.dests` is an empty Map unless the
			// board is interactive, so a selection on a quiet board highlights and
			// goes no further.
			selectable: { enabled: interactive || editable || !!onSelectRef.current },
			drawable: {
				enabled: false,
				autoShapes,
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
	}, [fen, orientation, interactive, editable, movableColor, arrowsKey, version, size]);

	// Shapes, on their own, through the call chessground provides for them.
	//
	// They were riding along inside the `set()` above, which merges config and
	// redraws the board but leaves the drawable layer holding its first contents.
	// The symptom was an overlay frozen on whatever it drew first — including
	// refusing to clear when the layer was switched off.
	useEffect(() => {
		api.current?.setAutoShapes(autoShapes);
		// `arrowsKey` is the dependency rather than `autoShapes`, which is a fresh
		// array every render and would make this fire on every keystroke elsewhere.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [arrowsKey, version]);

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

/** Chessground's own default, restored whenever a walk ends. */
const ANIM_MS = 200;
/** One position per this many milliseconds while walking a `via` path. */
const STEP_MS = 170;
/**
 * …and the whole walk is squeezed to fit inside this, however many plies.
 *
 * Ten plies at a comfortable pace is nearly two seconds of watching, which
 * stops being a cue and becomes a wait. The thing being communicated — "we came
 * back that way" — survives being shown faster.
 */
const WALK_BUDGET_MS = 1100;
/**
 * The floor, and it is chessground's rather than a taste.
 *
 * Below 70ms it disables animation outright (`config.ts`), so a walk paced any
 * faster would teleport each step and lose the very thing it is for.
 */
const MIN_STEP_MS = 70;

/**
 * Someone who asked their system not to animate things means it.
 *
 * The CSS honours this for the working indicator already; a board that replays
 * six moves when the reader asked for stillness is the same promise broken
 * more visibly.
 */
function reducedMotion(): boolean {
	return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
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

/*
 * THE QUALITY RAMP — batlow, truncated, at full opacity.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG WITH THE OLD ONE, MEASURED.
 *
 * It was a single-hue green ramp that also faded out: `#b9d6c8` at 0.4 opacity
 * for the weakest move. Composited over this board's light square (`#f0d9b5`)
 * that is an effective contrast of **1.05:1** — not "faint", invisible. The
 * second-weakest managed 1.24:1. Two of the five arrows could not be seen at
 * all, which is a strange thing for a drawing to do.
 *
 * Three channels were encoding one quantity — hue, opacity and width — and the
 * opacity was quietly cancelling the other two out.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS.
 *
 * Fabio Crameri's `batlow`, sampled at five points over 0..0.45 of its range.
 * Perceptually uniform, so equal steps in move quality look like equal steps;
 * colour-vision-safe and greyscale-safe by construction.
 *
 * TRUNCATED AT 0.45 BECAUSE THE BOARD IS TAN. Batlow's upper half runs through
 * yellow to a pale pink (`#faccfa`), which on `#f0d9b5` is the old problem
 * again. The lower half — deep blue through teal to olive — is the part that
 * stays dark enough to read. Measured against both squares at full opacity:
 *
 *      q0 #011959   11.91 : 1 light   7.49 : 1 dark
 *      q1 #103f60    8.04            5.06
 *      q2 #1c5a62    5.69            3.58
 *      q3 #3e6e55    4.29            2.70
 *      q4 #6c7c3c    3.34            2.10
 *
 * The weakest arrow is now three times more legible than the STRONGEST one was
 * at the faded end of the old ramp.
 *
 * OPACITY IS GONE AS A CHANNEL, deliberately. It was the thing destroying
 * legibility, and the ordering is already carried twice over: batlow's lightness
 * ramp and the line width. The stock brushes are opaque too, so this also stops
 * the quality arrows looking like a different kind of object from the rest.
 *
 * AND IT IS NO LONGER GREEN, which turns out to be a gain rather than a cost.
 * Plain green is what this app draws THE ANSWER in — the book move, the
 * solution. A green ramp beside a green answer asked the reader to tell two
 * greens apart by saturation. Now the answer is green and the engine's ranking
 * is not, and neither is violet, which is the chrome.
 */
const QUALITY_BRUSHES = {
	...STOCK_BRUSHES,
	q0: { key: 'q0', color: '#011959', opacity: 1, lineWidth: 14 },
	q1: { key: 'q1', color: '#103f60', opacity: 1, lineWidth: 11.5 },
	q2: { key: 'q2', color: '#1c5a62', opacity: 1, lineWidth: 9 },
	q3: { key: 'q3', color: '#3e6e55', opacity: 1, lineWidth: 7 },
	q4: { key: 'q4', color: '#6c7c3c', opacity: 1, lineWidth: 5.5 },
	/**
	 * The move that was just played, drawn in grey rather than anywhere on the
	 * quality ramp.
	 *
	 * The ramp is one hue precisely so that position in it means quality; a past
	 * move has no quality being asserted about it, and borrowing `q4` for it
	 * would say "this was a poor move" to anyone reading the board the way the
	 * ramp teaches them to.
	 */
	past: { key: 'pa', color: '#7d7d7d', opacity: 0.55, lineWidth: 6 },
	/**
	 * A ring around a square: this move is in the book.
	 *
	 * -------------------------------------------------------------------------
	 * IT CANNOT GO ON THE LABEL, AND THAT IS ARITHMETIC RATHER THAN TASTE.
	 *
	 * Will: "with the ◆ denoting book moves the text becomes too small to read
	 * in the arrow labels. We need another way to denote book moves. Is it
	 * possible to change the style of the arrows somehow?"
	 *
	 * Chessground sizes a label's text as `0.4 * 0.75 ** text.length` — every
	 * extra character shrinks THE WHOLE LABEL, exponentially. "+0.3" renders at
	 * 0.127; "+0.3 ◆" renders at 0.071, which is 44% smaller. So a marker in the
	 * label does not cost a corner of the badge, it costs half the eval's
	 * legibility, and no choice of symbol avoids that.
	 *
	 * The arrow's own style is already fully spent: colour AND width both carry
	 * position on the quality ramp, which is deliberate — two channels so it
	 * survives colour-blindness and a small screen. Adding a dash would be a
	 * third visual variable on one object, and "dashed" reads as tentative,
	 * which is the opposite of what theory is.
	 *
	 * So the mark is a separate object on the destination square. Green, because
	 * this app already draws the book move and the solution in plain green (see
	 * the ramp's note above — the ramp is NOT green precisely so that green can
	 * keep meaning "this is the answer"). Thin, so it frames the square rather
	 * than competing with the arrow landing in it.
	 */
	book: { key: 'bk', color: '#15781B', opacity: 0.9, lineWidth: 6 },
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
