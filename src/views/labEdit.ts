// Editing the position from the Lab.
//
// Small, boring, and separate from the view because FEN surgery done inline in
// a component is where off-by-one bugs go to hide. Everything here is a pure
// string→string function with a test.

import { positionFromFen, fenOf, parseSquare, makeSquare } from '../domain/chess';
import type { Square, Role, Color } from 'chessops/types';

/** The side to move, flipped. The rest of the FEN is left exactly as it was. */
export function flipTurn(fen: string): string {
	const parts = fen.split(' ');
	if (parts.length < 2) return fen;
	parts[1] = parts[1] === 'w' ? 'b' : 'w';
	// En passant is stated from the mover's side; keeping it across a flip
	// describes a capture that cannot exist.
	if (parts.length > 3) parts[3] = '-';
	return parts.join(' ');
}

export function turnOf(fen: string): Color {
	return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

/**
 * Put a piece on a square, or clear it when `piece` is null.
 *
 * Castling rights are dropped on any edit: a hand-made position that still
 * claims the right to castle with a rook that is no longer there is illegal,
 * and chessops will refuse to read it back.
 */
export function place(
	fen: string,
	square: string,
	piece: { role: Role; color: Color } | null,
): string {
	const pos = positionFromFen(fen);
	const sq = parseSquare(square);
	if (sq === undefined) return fen;

	pos.board.take(sq as Square);
	if (piece) pos.board.set(sq as Square, piece);

	// Castling rights are dropped rather than tracked: a hand-made position that
	// still claims a right belonging to a rook that has been moved or removed is
	// illegal, and chessops refuses to read it back.
	const out = fenOf(pos).split(' ');
	out[2] = '-';
	out[3] = '-';
	return out.join(' ');
}

/** Everything on the board, for a tray that shows what is in play. */
export function pieceAt(fen: string, square: string): { role: Role; color: Color } | null {
	const pos = positionFromFen(fen);
	const sq = parseSquare(square);
	if (sq === undefined) return null;
	const p = pos.board.get(sq as Square);
	return p ? { role: p.role, color: p.color } : null;
}

/** Legal enough to analyse? A position with no king is not. */
export function readable(fen: string): string | null {
	// The king check happens BEFORE parsing: chessops rejects a kingless
	// position with `ERR_KINGS`, which is accurate and tells a person editing a
	// board nothing at all.
	const board = fen.split(' ')[0] ?? '';
	if (!board.includes('K')) return 'White has no king — add one to analyse this.';
	if (!board.includes('k')) return 'Black has no king — add one to analyse this.';
	try {
		positionFromFen(fen);
		return null;
	} catch (e) {
		return (e as Error).message;
	}
}

export { makeSquare };
