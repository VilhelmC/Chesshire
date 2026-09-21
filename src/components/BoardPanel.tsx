// The board and everything that belongs to it, in one place.
//
// Every screen that shows a position shows the same thing in the same geometry.
// A control that means one thing in the trainer means the same thing here and
// sits where the hand already expects it (§1.1, "one interface, learned once").
//
// ---------------------------------------------------------------------------
// THE ORDER OF A PAGE, DECIDED ONCE.
//
// Will: "we are being inconsistent about component ordering / page layout. For
// example: on Train 'show moves' table is displayed beneath buttons array and
// session statistics. In Mistakes tab the 'show moves' table is displayed above
// the buttons array and the past move list. In Train training wheels are
// displayed below past move list, in Mistakes above."
//
// Every one of those is a call site having improvised, so the rule is written
// down here and the geometry enforces the first half of it:
//
//   1. evaluation bar, board, captured material   <- this component
//   2. THE CONTROL STRIP                          <- this component
//   3. what just happened: the verdict on your move, their reply
//   4. analysis of the position in front of you: the move table, the
//      training wheels, commentary, the explainer
//   5. history: the move list
//   6. options and preferences
//
// The strip MOVED UP to get here. It used to render after `children`, so
// everything a view had to say stood between the board and the buttons that
// act on it — and how far between depended on how much the view had to say
// that second, which is why the two tabs disagreed. The controls belong to the
// board, so they go next to it.
//
// 3–6 are the caller's, because only the caller knows what it has; the reason
// they are listed here rather than in each view is that the LAST time each
// view decided for itself, they came out different. Will, on the ordering:
// "the past move list (history) is not really important — it should be after
// analytical content (but before options and preferences)." Which is what 4 and
// 5 say: the thing in front of you outranks the record of how you got here.
//
// The board sizes itself from the CONTAINER rather than from the window. The
// two differ constantly — a sidebar appears, panels stack, an on-screen
// keyboard opens — and measuring the thing the board actually lives in means
// the arithmetic is done once, here, instead of guessed at every call site. The
// old fixed 420 was hardcoded in four places and made the app unusable at any
// width below about 900.

import { Board, type BoardProps, type Shape } from './Board';
import { EvalBar } from './EvalBar';
import { MaterialBar } from './MaterialBar';
import { Toolbar, type ToolbarAction } from './Toolbar';
import { Thinking } from './Thinking';
import { useMeasure, useViewport, clamp } from './useViewport';
import type { Colour } from '../domain/material';

/** Below this the board is too small to play on; scroll instead of shrinking further. */
const MIN_BOARD = 240;
/** Above this it stops helping and starts wasting the screen. */
const MAX_BOARD = 520;

const GAP = 10;

/**
 * How big the board should be here.
 *
 * Extracted so that every board in the app is the same size in the same space.
 * The Lab hardcoded 420 and sat visibly smaller than Train beside it, which is
 * the kind of difference that reads as a bug in the app rather than a choice.
 *
 * `reserved` is horizontal space the caller has already spent — the evaluation
 * bar, in BoardPanel's case, and nothing in the Lab's.
 */
export function useBoardSize(reserved = 0): [React.RefObject<HTMLDivElement>, number] {
	const [ref, available] = useMeasure<HTMLDivElement>();
	const vp = useViewport();
	// Height binds only in landscape: a phone turned sideways has 393px of it,
	// and a board sized purely from the width puts its own controls off-screen.
	const chrome = vp.phone ? 250 : 200;
	const byHeight = Math.max(MIN_BOARD, vp.height - chrome);
	// `available === 0` means "not measured yet", not "no room". Rendering a
	// zero-width board for a frame makes chessground animate up from nothing.
	const size = available
		? clamp(Math.min(available - reserved, byHeight), MIN_BOARD, MAX_BOARD)
		: vp.phone
			? MIN_BOARD
			: 420;
	return [ref, size];
}

export function BoardPanel({
	fen,
	ourColour,
	evalCp = null,
	interactive = false,
	lastMove,
	arrows = [],
	onSelectSquare,
	onMove,
	version,
	via,
	actions = [],
	/** True while the engine is working: shows the pulsing indicator. */
	busy = false,
	/** Optional words beside the indicator. */
	note,
	/** Everything below the controls — steps 3 to 6 of the order above. */
	children,
}: {
	fen: string;
	ourColour: Colour;
	evalCp?: number | null;
	interactive?: boolean;
	lastMove?: [string, string];
	/**
	 * THE SAME `Shape` THE BOARD TAKES, not a hand-written copy of it.
	 *
	 * This was declared as `{ orig; dest; brush; label? }` with `dest` REQUIRED,
	 * which is a narrower type than the board it forwards to — and the difference
	 * is exactly the shapes that matter: a `Shape` with no `dest` is a CIRCLE, and
	 * circles are how the pin and deficiency overlays mark a square. They could be
	 * drawn in the Lab, which uses `Board` directly, and not in Train or Mistakes,
	 * which go through here.
	 *
	 * A wrapper that retypes what it forwards will always drift from it.
	 */
	arrows?: Shape[];
	/**
	 * A square was clicked.
	 *
	 * Forwarded because the safe-moves overlay needs a focused man — it draws for
	 * ONE piece, since a position has 27 legal moves on average and drawing them
	 * all is a scribble. Without this the wheel says "click a man on the board"
	 * and clicking a man does nothing, which is a worse state than not offering
	 * the wheel at all.
	 */
	onSelectSquare?: (square: string) => void;
	onMove?: (uci: string) => void;
	version?: number;
	/** Forwarded to the board — see `Board`'s `via`. */
	via?: BoardProps['via'];
	actions?: ToolbarAction[];
	busy?: boolean;
	note?: string;
	children?: React.ReactNode;
}) {
	const vp = useViewport();
	// Narrower on a phone, but not so narrow that the number clips: "+0.3" at the
	// smallest legible weight needs about 20px, and a bar showing "+0.." is worse
	// than one 6px wider.
	const barWidth = vp.phone ? 24 : 30;
	const [ref, size] = useBoardSize(barWidth + GAP);

	return (
		<div ref={ref} style={{ width: '100%', maxWidth: MAX_BOARD + barWidth + GAP }}>
			<div style={{ display: 'flex', gap: GAP }}>
				<EvalBar cp={evalCp} ourColour={ourColour} height={size} width={barWidth} />
				<Board
					fen={fen}
					orientation={ourColour === 'b' ? 'black' : 'white'}
					interactive={interactive}
					lastMove={lastMove}
					arrows={arrows}
					onMove={onMove}
					onSelectSquare={onSelectSquare}
					size={size}
					version={version}
					via={via}
				/>
			</div>

			{/* Indented past the evaluation bar so everything below lines up with
				the board — except on a phone, where that indent is 8% of the screen
				and buys nothing. */}
			<div style={{ marginLeft: vp.phone ? 0 : barWidth + GAP, width: vp.phone ? '100%' : size }}>
				<div style={{ marginTop: 8 }}>
					<MaterialBar fen={fen} ourColour={ourColour} />
				</div>

				{actions.length > 0 && (
					<div
						style={{
							marginTop: 12,
							display: 'flex',
							gap: 12,
							alignItems: 'center',
							flexWrap: 'wrap',
						}}
					>
						<Toolbar actions={actions} labelled={vp.touch || vp.phone} />
						<Thinking show={busy} />
						{note && <span style={{ fontSize: 12, opacity: 0.6 }}>{note}</span>}
					</div>
				)}

				{children}
			</div>
		</div>
	);
}
