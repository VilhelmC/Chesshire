// Walk through a line the app has just claimed something about.
//
// The claim and the evidence belong in the same place. When the app says "you
// are a piece up once the exchange finishes", the exchange is the evidence, and
// leaving it as five tokens of notation means the reader has to reconstruct the
// position to check the claim — which is the work they are here to learn.
//
// This drives the board rather than drawing its own: the same squares, the same
// pieces, the same orientation. A second miniature board would be a second
// thing to learn to read.

import { useEffect, useState } from 'react';
import { Move } from './Move';
import { type Line, stepAt, arrowFor, describeLine } from '../domain/line';
import { color, space, radius, text, TOUCH } from '../ui/theme';
import { Note } from '../ui/primitives';

export type BoardOverride = {
	fen: string;
	lastMove?: [string, string];
	arrows: { orig: string; dest: string; brush: string }[];
} | null;

export function LinePlayer({
	line,
	label,
	onBoard,
	onClose,
}: {
	line: Line;
	/** What the line is evidence FOR. Shown above it. */
	label: string;
	/** Hand the board what to display, or null to give it back. */
	onBoard: (o: BoardOverride) => void;
	onClose: () => void;
}) {
	// -1 is "before the line starts", so the claim can be seen from both ends.
	const [at, setAt] = useState(-1);

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
			style={{
				border: `1px solid ${color.line}`,
				borderRadius: radius.panel,
				padding: space.snug,
				marginTop: space.snug,
				background: color.surface,
			}}
		>
			<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.tight }}>
				{label}
			</div>

			<div
				style={{
					display: 'flex',
					flexWrap: 'wrap',
					gap: space.tight,
					alignItems: 'center',
					marginBottom: space.snug,
				}}
			>
				{line.steps.map((s, i) => (
					<button
						key={i}
						onClick={() => setAt(i)}
						title={`${s.moveNo}${s.colour === 'w' ? '.' : '…'}${s.san}`}
						style={{
							border: `1px solid ${i === at ? color.accent : 'transparent'}`,
							background: i === at ? color.accentSoft : 'transparent',
							borderRadius: radius.small,
							padding: '2px 5px',
							cursor: 'pointer',
							fontSize: 13,
						}}
					>
						{s.colour === 'w' && (
							<span style={{ color: color.ink3, fontSize: 11 }}>{s.moveNo}.</span>
						)}
						<Move san={s.san} colour={s.colour} size={13} />
					</button>
				))}
			</div>

			<div style={{ display: 'flex', gap: space.tight, alignItems: 'center' }}>
				<Step label="Start" onClick={() => setAt(-1)} disabled={at === -1} />
				<Step label="◀" onClick={() => step(-1)} disabled={at === -1} />
				<Step label="▶" onClick={() => step(1)} disabled={at >= line.steps.length - 1} />
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
					Back to the game
				</button>
			</div>

			{!line.complete && (
				// A line shown only as far as it replayed must say so. Otherwise the
				// truncation reads as the sequence ending there.
				<Note style={{ marginTop: space.tight, color: color.warn }}>
					Only the first {line.steps.length} move{line.steps.length === 1 ? '' : 's'} of this
					line replay from here; the rest could not be applied.
				</Note>
			)}

			<Note style={{ marginTop: space.tight }} >{describeLine(line)}</Note>
		</div>
	);
}

function Step({
	label,
	onClick,
	disabled,
}: {
	label: string;
	onClick: () => void;
	disabled: boolean;
}) {
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
