// What every overlay needs and none of them owns.
//
// Split out when the second overlay file arrived, so that `pin.ts` can use
// `moves` without importing the file that re-exports it. Nothing here decides
// anything — it is the shared shape and the two helpers every primitive repeats.

import type { Chess } from 'chessops/chess';
import type { NormalMove, Role, Square } from 'chessops/types';

/** One thing worth drawing: some squares, maybe an arrow, and a line of words. */
export type Mark = {
	/** The move that produces it, when there is one. */
	move?: NormalMove;
	/** Squares to ring — the men involved. */
	squares: Square[];
	/** What it is, in a few words. Fixed text, never generated. */
	note: string;
};

export const after = (pos: Chess, m: NormalMove): Chess => {
	const n = pos.clone();
	n.play(m);
	return n;
};

/** Every legal move, promotions written out. */
export function moves(pos: Chess): NormalMove[] {
	const out: NormalMove[] = [];
	const promo: Role[] = ['queen', 'rook', 'bishop', 'knight'];
	for (const [from, dests] of pos.allDests()) {
		const piece = pos.board.get(from);
		if (!piece) continue;
		const last = piece.color === 'white' ? 7 : 0;
		for (const to of dests) {
			if (piece.role === 'pawn' && to >> 3 === last) for (const p of promo) out.push({ from, to, promotion: p });
			else out.push({ from, to });
		}
	}
	return out;
}
