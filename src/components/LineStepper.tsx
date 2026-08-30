// One stepper, used everywhere a line is walked.
//
// ---------------------------------------------------------------------------
// `LinePlayer` and `ExplainPanel` both walk a `Line` and both drive the board
// through `BoardOverride`. They shared the domain helpers — `stepAt`, `arrowFor`
// — and duplicated the layout, which is how they drifted: the line under the
// board grew Start/◀/▶ buttons and the explainer never got them.
//
// Will: *"Why are there no step through arrow buttons? Why does it look
// different from how the line is displayed under the board (shouldn't we be
// reusing the same layout components for consistency?)"*
//
// Both halves of that are right, and the second is the one that matters: two
// components that do the same thing will always drift, and the reader pays for
// it by having to learn the screen twice. So the chips, the buttons, the board
// driving and the truncation warning live here once, and the two callers differ
// only in what they hang off it — the explainer adds a `?` per ply, which is the
// one thing that genuinely is not the same.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Move } from './Move';
import { type Line, type LineStep, stepAt, arrowFor, describeLine } from '../domain/line';
import { color, space, radius, text, TOUCH } from '../ui/theme';
import { Note } from '../ui/primitives';

export type BoardOverride = {
	fen: string;
	lastMove?: [string, string];
	arrows: { orig: string; dest: string; brush: string }[];
} | null;

export type LineStepperProps = {
	line: Line;
	/** What the line is evidence FOR. Shown above it. */
	label: string;
	/** Hand the board what to display, or null to give it back. */
	onBoard: (o: BoardOverride) => void;
	onClose?: () => void;
	/** Wording for the close button — "Back to the game", "Close". */
	closeLabel?: string;
	/**
	 * Ask a further question about one ply.
	 *
	 * The explainer's recursion: Will's *"If user at some point in stepping
	 * through doesn't understand a move they can click the Explain button '?' and
	 * start a new explanation from there."* Absent here, the stepper is just a
	 * stepper, which is what the line under the board wants.
	 */
	onAsk?: (step: LineStep, index: number) => void;
	/**
	 * A per-ply annotation — a material swing, a forcing move.
	 *
	 * `tone` rather than a colour so the caller does not reach into the theme, and
	 * so the three meanings stay the three the ramp already has: good, bad, and
	 * worth-a-look.
	 */
	mark?: (index: number) => { text: string; tone?: 'good' | 'bad' | 'warn' } | undefined;
	/** Named so the region can be referred to. See `docs/REGIONS.md`. */
	region?: string;
};

export function LineStepper({
	line,
	label,
	onBoard,
	onClose,
	closeLabel = 'Back to the game',
	onAsk,
	mark,
	region = 'line-stepper',
}: LineStepperProps) {
	// -1 is "before the line starts", so the claim can be seen from both ends.
	const [at, setAt] = useState(-1);

	// A NEW LINE STARTS AT THE START. Without this the stepper keeps its position
	// across a change of subject — ask about a different move and you land four
	// plies into a line you have not seen. `ExplainPanel` used to do this reset
	// itself; a component that owns `at` owns resetting it.
	useEffect(() => {
		setAt(-1);
	}, [line]);

	useEffect(() => {
		const { fen, lastMove } = stepAt(line, at);
		onBoard({ fen, lastMove, arrows: arrowFor(line, at) });
		// Giving the board back on unmount matters more than it looks: leaving an
		// override behind would freeze the trainer on a position from an
		// explanation.
		return () => onBoard(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [at, line]);

	if (!line.steps.length) {
		return <Note>Nothing to show — the line does not replay from here.</Note>;
	}

	const step = (d: number) => setAt((v) => Math.max(-1, Math.min(line.steps.length - 1, v + d)));

	return (
		<div
			data-region={region}
			style={{
				border: `1px solid ${color.line}`,
				borderRadius: radius.panel,
				padding: space.snug,
				marginTop: space.snug,
				background: color.surface,
			}}
		>
			<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.tight }}>{label}</div>

			<div
				data-region={`${region}-plies`}
				style={{ display: 'flex', flexWrap: 'wrap', gap: space.tight, alignItems: 'center', marginBottom: space.snug }}
			>
				{line.steps.map((s, i) => {
					const m = mark?.(i);
					const tone = m?.tone === 'good' ? color.good : m?.tone === 'bad' ? color.bad : color.warn;
					return (
					<span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
						<button
							onClick={() => setAt(i)}
							title={`${s.moveNo}${s.colour === 'w' ? '.' : '…'}${s.san} — show this position`}
							style={{
								border: `1px solid ${i === at ? color.accent : 'transparent'}`,
								background: i === at ? color.accentSoft : 'transparent',
								borderRadius: radius.small,
								padding: '2px 5px',
								cursor: 'pointer',
								fontSize: 13,
							}}
						>
							{s.colour === 'w' && <span style={{ color: color.ink3, fontSize: 11 }}>{s.moveNo}.</span>}
							<Move san={s.san} colour={s.colour} size={13} />
							{m && <span style={{ color: tone, fontFamily: 'inherit', fontSize: 10, marginLeft: 3 }}>{m.text}</span>}
						</button>
						{onAsk && (
							<button
								onClick={() => onAsk(s, i)}
								title={`Why ${s.san}?`}
								style={{
									border: 'none',
									background: 'none',
									color: color.accent,
									cursor: 'pointer',
									fontSize: 12,
									padding: '0 2px',
								}}
							>
								?
							</button>
						)}
					</span>
					);
				})}
			</div>

			<div data-region={`${region}-controls`} style={{ display: 'flex', gap: space.tight, alignItems: 'center' }}>
				<Step label="Start" onClick={() => setAt(-1)} disabled={at === -1} />
				<Step label="◀" onClick={() => step(-1)} disabled={at === -1} />
				<Step label="▶" onClick={() => step(1)} disabled={at >= line.steps.length - 1} />
				{onClose && (
					<button
						onClick={onClose}
						style={{
							marginLeft: 'auto',
							border: 'none',
							background: 'none',
							color: color.ink2,
							fontSize: text.note,
							cursor: 'pointer',
							minHeight: TOUCH,
						}}
					>
						{closeLabel}
					</button>
				)}
			</div>

			{!line.complete && (
				// A line shown only as far as it replayed must say so. Otherwise the
				// truncation reads as the sequence ending there.
				<Note style={{ marginTop: space.tight, color: color.warn }}>
					Only the first {line.steps.length} move{line.steps.length === 1 ? '' : 's'} of this line replay from
					here; the rest could not be applied.
				</Note>
			)}

			<Note style={{ marginTop: space.tight }}>{describeLine(line)}</Note>
		</div>
	);
}

function Step({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			style={{
				minWidth: 44,
				minHeight: TOUCH,
				border: `1px solid ${color.line}`,
				background: color.page,
				color: color.ink,
				borderRadius: radius.small,
				cursor: disabled ? 'default' : 'pointer',
				opacity: disabled ? 0.4 : 1,
				fontSize: text.body,
				touchAction: 'manipulation',
			}}
		>
			{label}
		</button>
	);
}
