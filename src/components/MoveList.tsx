// The moves played, as a scoresheet.
//
// It used to be a wrapping strip of chips. That packs the most moves into the
// least space, and it is the wrong trade: every row started at a different move
// number, so finding "White's 7th" meant reading the whole strip instead of
// looking down a column. A table costs vertical space and gives back the thing
// a move list is for — the same number of moves on every row, in fixed columns,
// so position on the page carries information.
//
// Shading alternates by SIDE — White's moves light, Black's tinted — which is
// the distinction the eye actually needs while reading a game.
//
// Markers are reserved for things worth going back to. A branch marker was tried
// and removed: nearly every early node has alternatives, so it fired constantly
// and meant nothing. What earns a mark is a move you can act on — the mistake
// you were asked to punish, and your own second-best answers, which are the
// positions where sitting and looking again is the whole exercise.

import { Move } from './Move';
import { withGlyph } from '../domain/notation';
import { useMeasure } from './useViewport';

export type MoveChip = {
	san: string;
	/** Plies played after this move — the index to restore to. */
	ply: number;
	/** This move was a mistake we were asked to punish. */
	mistake: boolean;
	/** Our move was accepted but something was better — worth another look. */
	suboptimal: boolean;
	/** Centipawns behind the best move, when suboptimal. */
	cpLoss?: number;
	/** True when White played it (not "ours" — shading follows the side). */
	white: boolean;
};

/** One move number and the (up to) two moves played on it. */
export type MovePair = {
	no: number;
	white: MoveChip | null;
	black: MoveChip | null;
};

/**
 * Group chips into numbered pairs.
 *
 * The move number comes from `ply`, not from the chip's position in the array.
 * A list that starts at Black's move — which is every line resumed from an
 * even ply — would otherwise be numbered as though Black had opened the game,
 * and the empty White cell that makes the column line up would never appear.
 */
export function toPairs(chips: MoveChip[]): MovePair[] {
	const pairs: MovePair[] = [];
	for (const c of chips) {
		const no = Math.max(1, Math.ceil(c.ply / 2));
		let row = pairs[pairs.length - 1];
		if (!row || row.no !== no) {
			row = { no, white: null, black: null };
			pairs.push(row);
		}
		if (c.white) row.white = c;
		else row.black = c;
	}
	return pairs;
}

/** Width one numbered pair needs before the columns stop being readable. */
const PAIR_WIDTH = 132;
const NUM_COL = 26;
export const MAX_PAIRS_PER_ROW = 4;

/** How many move-pairs fit across, at least one. */
export function pairsPerRow(width: number): number {
	if (!width) return 1;
	return Math.max(1, Math.min(MAX_PAIRS_PER_ROW, Math.floor(width / PAIR_WIDTH)));
}

export function MoveList({
	chips,
	currentPly,
	onJump,
	onPlayFrom,
}: {
	chips: MoveChip[];
	currentPly: number;
	onJump?: (ply: number) => void;
	/** Double-click: resume the run from this position rather than just looking. */
	onPlayFrom?: (ply: number) => void;
}) {
	const [ref, width] = useMeasure<HTMLDivElement>();
	const per = pairsPerRow(width ?? 0);

	if (!chips.length) {
		return (
			<div ref={ref} style={{ fontSize: 13, opacity: 0.5, minHeight: 30 }}>
				Start of the game.
			</div>
		);
	}

	const pairs = toPairs(chips);

	return (
		<div
			ref={ref}
			style={{
				display: 'grid',
				// Every pair gets the same three tracks, so the columns line up
				// down the page regardless of how long any single move's text is.
				gridTemplateColumns: `repeat(${per}, ${NUM_COL}px 1fr 1fr)`,
				gap: '1px 2px',
				alignItems: 'stretch',
				minHeight: 30,
				// Long games scroll rather than pushing the board off the screen.
				maxHeight: 220,
				overflowY: 'auto',
			}}
		>
			{pairs.map((p) => (
				<Pair
					key={p.no}
					pair={p}
					currentPly={currentPly}
					onJump={onJump}
					onPlayFrom={onPlayFrom}
				/>
			))}
		</div>
	);
}

function Pair({
	pair,
	currentPly,
	onJump,
	onPlayFrom,
}: {
	pair: MovePair;
	currentPly: number;
	onJump?: (ply: number) => void;
	onPlayFrom?: (ply: number) => void;
}) {
	return (
		<>
			<span
				style={{
					fontSize: 12,
					opacity: 0.45,
					fontFamily: 'ui-monospace, monospace',
					textAlign: 'right',
					paddingRight: 3,
					alignSelf: 'center',
				}}
			>
				{pair.no}.
			</span>
			<Cell chip={pair.white} currentPly={currentPly} onJump={onJump} onPlayFrom={onPlayFrom} />
			<Cell chip={pair.black} currentPly={currentPly} onJump={onJump} onPlayFrom={onPlayFrom} />
		</>
	);
}

function Cell({
	chip,
	currentPly,
	onJump,
	onPlayFrom,
}: {
	chip: MoveChip | null;
	currentPly: number;
	onJump?: (ply: number) => void;
	onPlayFrom?: (ply: number) => void;
}) {
	// An empty cell, not a missing one: the ellipsis is what keeps Black's column
	// under Black's column when a line starts mid-move.
	if (!chip) {
		return (
			<span
				style={{
					fontSize: 13,
					opacity: 0.25,
					fontFamily: 'ui-monospace, monospace',
					padding: '2px 5px',
				}}
			>
				…
			</span>
		);
	}

	const current = chip.ply === currentPly;
	const glyphed = withGlyph(chip.san, chip.white ? 'w' : 'b');

	return (
		<button
			// Stable handle for the end-to-end check: the visible text now
			// carries a piece glyph, so matching on notation is brittle.
			data-ply={chip.ply}
			onClick={() => onJump?.(chip.ply)}
			onDoubleClick={() => onPlayFrom?.(chip.ply)}
			disabled={!onJump}
			title={
				chip.mistake
					? `${glyphed} — the mistake you were asked to punish`
					: chip.suboptimal
						? `${glyphed} — accepted, but ${chip.cpLoss}cp behind the best move. Go back and look again.`
						: `Go back to ${glyphed}`
			}
			style={{
				borderTopWidth: 1,
				borderRightWidth: 1,
				borderLeftWidth: 1,
				borderTopStyle: 'solid',
				borderRightStyle: 'solid',
				borderLeftStyle: 'solid',
				borderTopColor: current ? '#1565c0' : 'transparent',
				borderRightColor: current ? '#1565c0' : 'transparent',
				borderLeftColor: current ? '#1565c0' : 'transparent',
				borderBottomStyle: 'solid',
				borderBottomWidth: chip.mistake || chip.suboptimal ? 2 : 1,
				borderBottomColor: chip.mistake
					? '#d03b3b'
					: chip.suboptimal
						? '#eda100'
						: current
							? '#1565c0'
							: 'transparent',
				borderRadius: 4,
				background: current ? '#e3f2fd' : chip.white ? '#fbfbfa' : '#ecebe7',
				fontFamily: 'ui-monospace, monospace',
				fontSize: 13,
				fontWeight: current ? 700 : 400,
				padding: '2px 5px',
				cursor: onJump ? 'pointer' : 'default',
				color: '#1a1a19',
				// Left-aligned so the notation starts at the same x on every row —
				// centring would undo the alignment the table exists for.
				textAlign: 'left',
				touchAction: 'manipulation',
			}}
		>
			<Move san={chip.san} colour={chip.white ? 'w' : 'b'} size={13} />
		</button>
	);
}

export function MoveListLegend() {
	return (
		<div style={{ fontSize: 11, opacity: 0.65, marginTop: 2, display: 'flex', gap: 14 }}>
			<span>
				<span
					style={{
						borderBottomStyle: 'solid',
						borderBottomWidth: 2,
						borderBottomColor: '#d03b3b',
						paddingBottom: 1,
					}}
				>
					their mistake
				</span>
			</span>
			<span>
				<span
					style={{
						borderBottomStyle: 'solid',
						borderBottomWidth: 2,
						borderBottomColor: '#eda100',
						paddingBottom: 1,
					}}
				>
					your move, but not the best
				</span>
			</span>
		</div>
	);
}
