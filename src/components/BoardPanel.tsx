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
//   0. WHERE YOU ARE                              <- this component
//   1. evaluation bar, board, captured material   <- this component
//   2. THE CONTROL STRIP                          <- this component
//   3. what just happened: the verdict on your move, their reply
//   4. analysis of the position in front of you: the move table, the
//      training wheels, commentary, the explainer
//   5. history: the move list
//   6. options and preferences
//
// Step 0 arrived last and for the same reason as the rest. Will: "perhaps that
// message should be part of the standard machinery everything consumes, so a
// board is always displayed with the line it belongs to if such a line exists."
// It is a `caption` PROP rather than a slot taking arbitrary JSX: a caller says
// what it knows about where it is and what else is worth saying, and cannot say
// where the line goes or how it reads. See `PositionCaption`.
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
import { PositionCaption, type CaptionProps } from './PositionCaption';
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
	movableColor = 'auto',
	lastMove,
	arrows = [],
	onSelectSquare,
	onMove,
	version,
	via,
	caption,
	actions = [],
	/** Optional words beside the indicator. */
	note,
	/** Everything below the controls — steps 3 to 6 of the order above. */
	children,
}: {
	fen: string;
	ourColour: Colour;
	evalCp?: number | null;
	interactive?: boolean;
	/**
	 * Which side the user may move — forwarded, not re-decided.
	 *
	 * `Board` has had this since the Lab's sandbox needed it and this wrapper
	 * did not pass it on, which is the SAME drift the `arrows` prop was already
	 * caught for: a wrapper that narrows what it forwards will always lose the
	 * case that matters. Here the case that matters is exploring a position,
	 * where you move both colours.
	 */
	movableColor?: 'auto' | 'both';
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
	/**
	 * Step 0: where this position is, and why you are looking at it.
	 *
	 * Omitting it reserves the space and says nothing, which is what a board
	 * with no path to speak of should do. Passing `{ path }` alone is enough for
	 * the opening and the move number.
	 */
	caption?: CaptionProps;
	actions?: ToolbarAction[];
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
			{/* Indented to the board's left edge, like everything below it. The
				line Train used to write sat above the evaluation bar instead, a
				bar's width further left than the board it described. */}
			<div style={{ marginLeft: vp.phone ? 0 : barWidth + GAP }}>
				<PositionCaption {...(caption ?? { path: [] })} />
			</div>

			<div style={{ display: 'flex', gap: GAP }}>
				<EvalBar cp={evalCp} ourColour={ourColour} height={size} width={barWidth} />
				<Board
					fen={fen}
					orientation={ourColour === 'b' ? 'black' : 'white'}
					interactive={interactive}
					movableColor={movableColor}
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
						{/*
							THE PULSE THAT WAS HERE HAS MOVED TO THE HEADER.

							Will: "we now show loading animation in two places right next
							to each other: above the 'Your move' text and in the 'your move
							text'. Let's keep only in 'Your move' text since that is what's
							being calculated."

							Right, and which to keep follows from what each could honestly
							mean. The one in the verdict block says WHAT is being worked out
							and sits where the answer will appear; this one said only that
							something, somewhere, was happening — which is a fact about the
							whole app, and now lives in the app's own chrome. See
							`data/working` and `ui/Mark`.

							The `busy` PROP went with it. Nothing else here read it — each
							control carries its own `disabled` — so what was left was a prop
							three views passed and this component ignored, which is a
							smaller lie than a duplicate spinner and still a lie.
						*/}
						<Toolbar actions={actions} labelled={vp.touch || vp.phone} />
						{note && <span style={{ fontSize: 12, opacity: 0.6 }}>{note}</span>}
					</div>
				)}

				{children}
			</div>
		</div>
	);
}
