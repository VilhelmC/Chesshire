// A chess piece, drawn once, for the whole app.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT JUST A CHARACTER.
//
// Unicode ships TWO piece sets. `♔♕♖♗♘♙` are OUTLINE shapes and `♚♛♜♝♞♟` are
// FILLED ones, and neither carries a colour: both are stroked and filled in
// whatever the current text colour happens to be. On a light page an outline
// glyph shows the page through its middle and reads white, and a filled one
// reads black — so "use the outline set for White" works, by accident, in
// exactly one theme. Flip to dark ink on a dark page and the meanings swap:
// the filled king renders solid pale and reads WHITE, the outline king reads
// as a dark hole. Which was the report.
//
// ---------------------------------------------------------------------------
// AND WHY THERE IS NO LONGER A LITTLE TAN SQUARE BEHIND IT.
//
// Will: "I'm not sure what I think about the tan chip behind piece glyphs.
// Accepted for now, but we should be able to dynamically pick correct glyph and
// colour for a piece glyph depending on background lightness."
//
// The chip existed to guarantee a known background, because a near-black man
// painted on a near-black panel is invisible and the component has no way to
// find out what is behind it. That is worth being precise about: a React
// component genuinely CANNOT read its own backdrop. It could only be TOLD, by
// every call site, correctly, forever — and "forever" is the part that fails.
// The move list, four mistake rows, the material bar and whatever gets built
// next would each have to know which surface they sit on and keep knowing it
// through every restyle. That is the same one-definition-two-readers trap this
// repo keeps falling into, with a dozen readers instead of two.
//
// So the glyph carries its own contrast instead. ONE FILLED SET, painted in the
// piece's literal colour, with a hairline HALO in the opposite one. Whatever is
// behind it, one of the two differs from it: a white man on a pale page is
// found by its dark edge, a black man on a dark page by its light edge, and on
// mid-tones both are visible at once. Nothing has to be told anything, and
// there is no second glyph set to get out of step.
//
// The halo is `text-shadow` rather than `-webkit-text-stroke`, which strokes
// centred on the outline and eats into a 15px glyph until the knight loses its
// ears.
// ---------------------------------------------------------------------------

import type { Role, Colour } from '../domain/material';

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
 * `color.ink` and `color.page` SWAP between themes and a piece's colour must
 * not. These two are the piece's own identity, so they are hard values — the
 * one place in the app where a hex is the correct answer rather than a
 * shortcut.
 */
const INK: Record<Colour, string> = { w: '#ffffff', b: '#111111' };

/** The opposite one, which is what draws the edge. */
const EDGE: Record<Colour, string> = { w: INK.b, b: INK.w };

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
	title,
}: {
	role: Role;
	colour: Colour;
	size?: number;
	title?: string;
}) {
	return (
		<span
			title={title}
			aria-hidden
			style={{
				display: 'inline-block',
				color: INK[colour],
				/*
				 * Four offsets rather than a blur. A blurred shadow spreads its ink
				 * over two pixels and reads as a smudge at this size; four hard
				 * half-pixel copies read as an outline, which is what it is.
				 */
				textShadow: `0.5px 0 0 ${EDGE[colour]}, -0.5px 0 0 ${EDGE[colour]}, 0 0.5px 0 ${EDGE[colour]}, 0 -0.5px 0 ${EDGE[colour]}`,
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
