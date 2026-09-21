// A chess piece, drawn once, for the whole app.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT JUST A CHARACTER.
//
// Will: "Progress: 'where it breaks' and 'does it carry into your games' —
// glyphs are inverted when app is in dark mode. White pieces use hollow glyphs
// so appear black and black pieces use white solid pieces... Same with
// Mistakes: 'Hardest' array."
//
// Unicode ships TWO piece sets. `♔♕♖♗♘♙` are OUTLINE shapes and `♚♛♜♝♞♟` are
// FILLED ones, and neither carries a colour: both are stroked and filled in
// whatever the current text colour happens to be. On a light page an outline
// glyph shows the page through its middle and reads white, and a filled one
// reads black — so "use the outline set for White" works, by accident, in
// exactly one theme. Flip to dark ink on a dark page and the meanings swap:
// the filled king renders solid pale and reads WHITE, the outline king reads
// as a dark hole. Which is the report, exactly.
//
// The fix cannot be "swap the sets in dark mode", because that leaves two
// definitions of which shape means which side and a third theme away from
// being wrong again. So:
//
//   ONE SET — the filled one, always. Colour is applied LITERALLY, and the
//   glyph stands on a fixed board-coloured chip so neither ink can land on a
//   surface its own value.
//
// Nothing in the palette can reach these three values, which is the point:
// `color.ink` and `color.page` SWAP between themes and a piece's colour must
// not. This was already solved correctly inside MaterialBar and nowhere else;
// this file is that solution, extracted, so the move list and the mistake rows
// cannot drift away from it again.
// ---------------------------------------------------------------------------

import type { Role, Colour } from '../domain/material';
import { radius } from './theme';

/** The filled set. There is no second set — see the header. */
export const PIECE_GLYPH: Record<Role, string> = {
	pawn: '♟',
	knight: '♞',
	bishop: '♝',
	rook: '♜',
	queen: '♛',
	king: '♚',
};

/**
 * Literal, not tokens.
 *
 * Measured against the chip rather than guessed: white reads 3.1:1 on it and
 * black 6.1:1, which clears the 3:1 that WCAG asks of a graphical object in
 * both directions. A lighter chip pushed white below 3:1 and a darker one did
 * the same to black — there is less room here than it looks.
 */
const INK: Record<Colour, string> = { w: '#ffffff', b: '#101010' };

/** Board tan, fixed. A near-black man must never stand on a near-black panel. */
const SQUARE = '#a09176';

/** SAN's piece letters. Anything else — including castling's O-O — is handled below. */
const ROLE_OF_LETTER: Record<string, Role> = {
	K: 'king',
	Q: 'queen',
	R: 'rook',
	B: 'bishop',
	N: 'knight',
};

/** Which piece a SAN move moved. Castling is a king move; a bare square is a pawn. */
export function roleOfSan(san: string): Role {
	if (san.startsWith('O-O')) return 'king';
	return ROLE_OF_LETTER[san[0]] ?? 'pawn';
}

export function Piece({
	role,
	colour,
	size = 15,
	/**
	 * The chip can be dropped where the glyph already sits on a known surface —
	 * but only where that surface is fixed by something other than the theme.
	 */
	plain = false,
	title,
}: {
	role: Role;
	colour: Colour;
	size?: number;
	plain?: boolean;
	title?: string;
}) {
	return (
		<span
			title={title}
			aria-hidden
			style={{
				display: 'inline-block',
				color: INK[colour],
				background: plain ? undefined : SQUARE,
				borderRadius: plain ? undefined : radius.small - 2,
				padding: plain ? undefined : '0 1px',
				fontSize: size,
				lineHeight: 1,
				// A column of moves should align on the notation, not on whichever
				// piece happens to be widest.
				minWidth: size,
				textAlign: 'center',
				flexShrink: 0,
			}}
		>
			{PIECE_GLYPH[role]}
		</span>
	);
}
