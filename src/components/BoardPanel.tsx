// The board and everything that belongs to it, in one place.
//
// Every screen that shows a position shows the same thing in the same geometry:
// evaluation bar on the left, board, captured material beneath, then whatever
// the view has to say, then the control strip. A control that means one thing in
// the trainer means the same thing here and sits where the hand already expects
// it (§1.1, "one interface, learned once").
//
// The board sizes itself from the CONTAINER rather than from the window. The
// two differ constantly — a sidebar appears, panels stack, an on-screen
// keyboard opens — and measuring the thing the board actually lives in means
// the arithmetic is done once, here, instead of guessed at every call site. The
// old fixed 420 was hardcoded in four places and made the app unusable at any
// width below about 900.

import { Board } from './Board';
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
	onMove,
	version,
	actions = [],
	/** True while the engine is working: shows the pulsing indicator. */
	busy = false,
	/** Optional words beside the indicator. */
	note,
	/** Between the material strip and the controls. */
	children,
}: {
	fen: string;
	ourColour: Colour;
	evalCp?: number | null;
	interactive?: boolean;
	lastMove?: [string, string];
	arrows?: { orig: string; dest: string; brush: string; label?: string }[];
	onMove?: (uci: string) => void;
	version?: number;
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
					size={size}
					version={version}
				/>
			</div>

			{/* Indented past the evaluation bar so everything below lines up with
				the board — except on a phone, where that indent is 8% of the screen
				and buys nothing. */}
			<div style={{ marginLeft: vp.phone ? 0 : barWidth + GAP, width: vp.phone ? '100%' : size }}>
				<div style={{ marginTop: 8 }}>
					<MaterialBar fen={fen} ourColour={ourColour} />
				</div>

				{children}

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
			</div>
		</div>
	);
}
