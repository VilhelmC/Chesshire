// The moves played, as a clickable strip.
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
	if (!chips.length) {
		return <div style={{ fontSize: 13, opacity: 0.5, minHeight: 30 }}>Start of the game.</div>;
	}

	return (
		<div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', minHeight: 30 }}>
			{chips.map((c, i) => {
				const moveNo = Math.floor(i / 2) + 1;
				const current = c.ply === currentPly;
				return (
					<span key={c.ply} style={{ display: 'inline-flex', alignItems: 'center' }}>
						{i % 2 === 0 && (
							<span style={{ fontSize: 12, opacity: 0.45, margin: '0 3px 0 5px' }}>
								{moveNo}.
							</span>
						)}
						<button
							// Stable handle for the end-to-end check: the visible text now
							// carries a piece glyph, so matching on notation is brittle.
							data-ply={c.ply}
							onClick={() => onJump?.(c.ply)}
							onDoubleClick={() => onPlayFrom?.(c.ply)}
							disabled={!onJump}
							title={
								c.mistake
									? `${withGlyph(c.san, c.white ? 'w' : 'b')} — the mistake you were asked to punish`
									: c.suboptimal
										? `${withGlyph(c.san, c.white ? 'w' : 'b')} — accepted, but ${c.cpLoss}cp behind the best move. Go back and look again.`
										: `Go back to ${withGlyph(c.san, c.white ? 'w' : 'b')}`
							}
							style={{
								position: 'relative',
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
								borderBottomWidth: c.mistake || c.suboptimal ? 2 : 1,
								borderBottomColor: c.mistake
									? '#d03b3b'
									: c.suboptimal
										? '#eda100'
										: current
											? '#1565c0'
											: 'transparent',
								borderRadius: 4,
								background: current ? '#e3f2fd' : c.white ? '#fbfbfa' : '#ecebe7',
								fontFamily: 'ui-monospace, monospace',
								fontSize: 13,
								fontWeight: current ? 700 : 400,
								padding: '2px 5px',
								cursor: onJump ? 'pointer' : 'default',
								color: '#1a1a19',
							}}
						>
							<Move san={c.san} colour={c.white ? 'w' : 'b'} size={13} />
						</button>
					</span>
				);
			})}
		</div>
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
