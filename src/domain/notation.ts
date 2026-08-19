// Move notation, with the piece shown as a symbol.
//
// ---------------------------------------------------------------------------
// Every translation step between a symbol and its meaning is one the learner
// pays for. "Nf6" requires reading N, recalling that N is the knight (because K
// was taken), and only then locating the piece. The board in front of you shows
// a knight. So the notation shows a knight.
//
// The glyph is placed BEFORE the full SAN rather than replacing the letter:
// `♞ Nf6`, not `♞f6`. It is redundant by design — the text stays standard SAN,
// so it can still be copied into an engine, searched for, pasted into a forum
// post, or read aloud, and the symbol is a shortcut rather than a substitute.
//
// The glyph is coloured by the side that moved. Published figurine notation
// uses outline symbols throughout, because a book's move numbers already say
// whose move it is. Here you play both colours and positions are shown out of
// context, so who moved is worth carrying in the symbol itself.
// ---------------------------------------------------------------------------

export type Colour = 'w' | 'b';

const WHITE: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const BLACK: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };

/**
 * The piece symbol for a SAN move.
 *
 * Castling is a king move; anything without a leading piece letter is a pawn.
 */
export function glyphForSan(san: string, colour: Colour): string {
	const table = colour === 'w' ? WHITE : BLACK;
	if (san.startsWith('O-O')) return table.K;
	return table[san[0]] ?? (colour === 'w' ? '♙' : '♟');
}

/**
 * `♞ Nf6` — for strings, where a component cannot go: tooltips, status lines,
 * clipboard text, feedback sentences.
 */
export function withGlyph(san: string, colour: Colour): string {
	return `${glyphForSan(san, colour)} ${san}`;
}

/** Whose move a SAN at this ply was, counting from White's first move. */
export function colourAtPly(ply: number): Colour {
	return ply % 2 === 0 ? 'w' : 'b';
}

/** The side to move in a FEN, for when that is the mover we want to describe. */
export function colourOfFen(fen: string, fallback: Colour = 'w'): Colour {
	const field = fen.split(' ')[1];
	return field === 'w' ? 'w' : field === 'b' ? 'b' : fallback;
}

export function other(colour: Colour): Colour {
	return colour === 'w' ? 'b' : 'w';
}
