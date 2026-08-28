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

/**
 * ONE glyph set, coloured — never two sets distinguished by which glyph.
 *
 * Will: "taken pieces display as white for white player and black for black
 * player, but we capture the opponent's pieces so it should be the opposite."
 *
 * The logic below was already right — `weTook` is passed `theirColour`. What was
 * wrong is that a glyph's colour is not in the glyph. `♙`–`♕` are OUTLINE shapes:
 * they are stroked in the current text colour with a transparent interior. On a
 * light page that reads as "white". In DARK MODE the stroke is light ink and the
 * interior is the dark page, so an outline pawn reads as BLACK — while the filled
 * `♟` renders solid light and reads as WHITE. The two sets swap meaning with the
 * theme, which is exactly the inversion being reported.
 *
 * So swapping the colours would fix dark mode and break light mode. Instead this
 * uses the fix already proven in `ComplexPanel`'s `Man`: one FILLED set, coloured
 * literally, standing on a fixed board-coloured square. Nothing in the theme can
 * reach it, and there is no second glyph set to get out of step.
 */
const GLYPH: Record<Role, string> = {
	pawn: '♟',
	knight: '♞',
	bishop: '♝',
	rook: '♜',
	queen: '♛',
	king: '♚',
};

/** Literal, not tokens: `color.page` and `color.ink` SWAP between themes. */
const INK: Record<Colour, string> = { w: '#ffffff', b: '#101010' };
/** A fixed board colour, so a near-black man is never on a near-black panel. */
const SQUARE = '#b6a98f';

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
			<div style={{ fontSize: 12, color: '#52514e' }}>
				{r.balance === 0 ? (
					'Material level'
				) : (
					<>
						<strong style={{ color: r.balance > 0 ? '#2e7d32' : '#c62828' }}>
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
			<span style={{ fontSize: 11, color: '#8a8a86', width: 92, flexShrink: 0 }}>{label}</span>
			{pieces.length ? (
				pieces.map((role, i) => (
					<span
						key={i}
						aria-hidden
						style={{
							color: INK[colour],
							background: SQUARE,
							borderRadius: 2,
							padding: '0 1px',
							lineHeight: 1,
						}}
					>
						{GLYPH[role]}
					</span>
				))
			) : (
				<span style={{ fontSize: 11, color: '#b5b4b0' }}>nothing yet</span>
			)}
			{extra > 0 && (
				<span style={{ fontSize: 11, color: '#8a8a86', marginLeft: 4 }}>
					(+{extra} promoted)
				</span>
			)}
		</div>
	);
}
