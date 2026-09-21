// Captured material, beside the board.
//
// Shows the pieces themselves, not just a net number: `♟♟♞  +5` says both what
// is off the board and what it comes to, which is the redundancy §1.1 asks for.
// A learner who cannot yet convert "+5" into "a rook and a pawn" gets the answer
// for free; one who can, reads the number and ignores the rest.
//
// Two rows, one per side, always both present even when empty — a row that
// appears and disappears moves everything below it, and the strip sits directly
// under the board.

import { materialReport, VALUE, type Colour, type Role } from '../domain/material';
import { Piece } from '../ui/Piece';
import { color, space, text } from '../ui/theme';

/**
 * The pieces come from `ui/Piece`, which is where this problem was solved.
 *
 * Will: "taken pieces display as white for white player and black for black
 * player, but we capture the opponent's pieces so it should be the opposite."
 * The logic below was already right — `weTook` is passed `theirColour`. What
 * was wrong is that a glyph's colour is not in the glyph, and the fix for that
 * lived only here while the move lists and the mistake rows kept inverting.
 * It is now one component and this file is one of its readers.
 */

export function MaterialBar({ fen, ourColour }: { fen: string; ourColour: Colour }) {
	// Fills whatever it is given rather than taking a pixel width: the board's
	// size is decided by BoardPanel now, and having two places compute it was how
	// the old fixed 420 spread to four call sites.
	if (!fen) return <div style={{ width: '100%', height: 40 }} />;

	const r = materialReport(fen, ourColour);
	const theirColour: Colour = ourColour === 'w' ? 'b' : 'w';

	return (
		<div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
			<Row
				label="You have taken"
				pieces={r.weTook}
				colour={theirColour}
				extra={r.promotions.ours}
			/>
			<Row
				label="They have taken"
				pieces={r.theyTook}
				colour={ourColour}
				extra={r.promotions.theirs}
			/>
			<div style={{ fontSize: text.note, color: color.ink2 }}>
				{r.balance === 0 ? (
					'Material level'
				) : (
					<>
						<strong style={{ color: r.balance > 0 ? color.good : color.bad }}>
							{r.balance > 0 ? '+' : '−'}
							{Math.abs(r.balance)}
						</strong>{' '}
						in {r.balance > 0 ? 'your' : 'their'} favour
					</>
				)}
			</div>
		</div>
	);
}

function Row({
	label,
	pieces,
	colour,
	extra,
}: {
	label: string;
	pieces: Role[];
	colour: Colour;
	extra: number;
}) {
	const worth = pieces.reduce((n, r) => n + VALUE[r], 0);
	return (
		<div
			title={`${label}: ${pieces.length ? `${pieces.length} pieces worth ${worth}` : 'nothing yet'}`}
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 2,
				// Fixed so an empty row still holds its place.
				minHeight: 18,
				fontSize: 15,
				lineHeight: 1,
			}}
		>
			<span style={{ fontSize: text.note, color: color.ink2, width: 92, flexShrink: 0 }}>
				{label}
			</span>
			{pieces.length ? (
				pieces.map((role, i) => <Piece key={i} role={role} colour={colour} />)
			) : (
				<span style={{ fontSize: text.note, color: color.ink3 }}>nothing yet</span>
			)}
			{extra > 0 && (
				<span style={{ fontSize: text.note, color: color.ink2, marginLeft: space.tight }}>
					(+{extra} promoted)
				</span>
			)}
		</div>
	);
}
