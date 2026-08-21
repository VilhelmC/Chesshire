// The contest at a square.
//
// These tests are the claim that the arithmetic in domain/contest.ts is the
// arithmetic EXPLOITABILITY.md describes. They are deliberately written as
// positions a person can set up on a board and check by hand — a graph
// computation nobody can verify by eye is exactly the kind of thing that ends
// up subtly wrong and confidently reported.

import { describe, it, expect } from 'vitest';
import { foldAt, bearingOn, arrivals, escapesFor, contest, VALUE } from '../src/domain/contest';
import { positionFromFen, parseSquare } from '../src/domain/chess';
import type { Square } from 'chessops/types';

const at = (fen: string, s: string) => {
	const pos = positionFromFen(fen);
	return { pos, sq: parseSquare(s) as Square };
};

describe('bearingOn', () => {
	it('counts a piece that attacks the square', () => {
		// White rook d1, black knight d5. Nothing between them.
		const { pos, sq } = at('3q2k1/8/4p3/3n4/8/8/4P3/3R2K1 w - - 0 1', 'd5');
		const w = bearingOn(pos.board, sq, 'white', pos.board.occupied);
		expect(w.length).toBe(1);
	});

	it('counts the piece BEHIND a blocker as bearing on the blocker itself', () => {
		// The queen on d8 does not see through the knight on d5 — but it does
		// see d5, because a slider attacks the first occupied square on its ray.
		// This is why an x-ray defender needs no special case: it is already in
		// the list, and recomputing after each capture keeps it there.
		const { pos, sq } = at('3q2k1/8/4p3/3n4/8/8/4P3/3R2K1 w - - 0 1', 'd5');
		const b = bearingOn(pos.board, sq, 'black', pos.board.occupied);
		const squares = b.map((s) => s);
		expect(squares.length).toBe(2); // pawn e6 and queen d8
	});
});

describe('foldAt', () => {
	it('wins a free piece', () => {
		// Black knight on d5 attacked by a rook, defended by nothing.
		const { pos, sq } = at('6k1/8/8/3n4/8/8/8/3R2K1 w - - 0 1', 'd5');
		expect(foldAt(pos.board, sq, 'white').value).toBe(VALUE.knight);
	});

	it('declines an exchange that loses', () => {
		// Same knight, now defended by a pawn on e6. Rook takes knight, pawn
		// takes rook: 320 - 500. The attacker simply does not start.
		const { pos, sq } = at('6k1/8/4p3/3n4/8/8/8/3R2K1 w - - 0 1', 'd5');
		expect(foldAt(pos.board, sq, 'white').value).toBeLessThanOrEqual(0);
	});

	it('takes with the cheapest attacker, not the first one found', () => {
		// Rook and pawn both attack d5; a black pawn defends. Taking with the
		// rook loses; taking with the pawn wins.
		//
		// The value is the whole knight, not knight-minus-pawn, and that is the
		// case worth understanding: after exd5 the defending pawn will NOT
		// recapture, because taking a pawn and losing a pawn to the rook leaves
		// Black a knight and a pawn down instead of a knight. The piece is
		// "defended" and the defence is unaffordable — which is the distinction
		// the whole exercise is about, appearing in the very first fold.
		const { pos, sq } = at('6k1/8/4p3/3n4/4P3/8/8/3R2K1 w - - 0 1', 'd5');
		const fold = foldAt(pos.board, sq, 'white');
		expect(fold.steps[0].role).toBe('pawn');
		expect(fold.value).toBe(VALUE.knight);
		// And the trace says where it stops, rather than only reporting a number.
		expect(fold.depth).toBe(1);
		expect(fold.steps[1].happens).toBe(false);
	});

	it('records every step, so the number can be checked', () => {
		const { pos, sq } = at('6k1/8/4p3/3n4/4P3/8/8/3R2K1 w - - 0 1', 'd5');
		const fold = foldAt(pos.board, sq, 'white');
		expect(fold.steps.length).toBeGreaterThan(1);
		expect(fold.steps[0].captured).toBe(VALUE.knight);
		expect(fold.steps[1].captured).toBe(VALUE.pawn);
	});

	it('is zero on an empty square', () => {
		const { pos, sq } = at('6k1/8/8/8/8/8/8/3R2K1 w - - 0 1', 'd5');
		expect(foldAt(pos.board, sq, 'white').value).toBe(0);
	});
});

describe('arrivals', () => {
	const FEN = '3q2k1/8/4p3/3n4/8/8/4P3/3R2K1 w - - 0 1';

	it('reports a piece already bearing on the square at zero', () => {
		const pos = positionFromFen(FEN);
		const units = arrivals(pos, parseSquare('d5') as Square, 'white');
		const rook = units.find((u) => u.from === 'd1');
		expect(rook?.arrival).toBe(0);
	});

	it('finds the pawn that arrives in one move, and names the square', () => {
		// e2-e4 attacks d5. This is the move the whole Chessable position turns
		// on, and no motif detector produces it.
		const pos = positionFromFen(FEN);
		const units = arrivals(pos, parseSquare('d5') as Square, 'white');
		const pawn = units.find((u) => u.from === 'e2');
		expect(pawn?.arrival).toBe(1);
		expect(pawn?.via).toBe('e4');
	});

	it('marks a piece that cannot legally move', () => {
		// Knight d5 is pinned to the queen by the rook — it bears on nothing
		// it could act on, and its availability is false.
		const pinned = '3q2k1/8/8/3n4/8/8/8/3R2K1 b - - 0 1';
		const pos = positionFromFen(pinned);
		// The knight cannot move at all only when the piece behind is the king;
		// with a queen behind it the pin is relative, so it CAN move.
		const units = arrivals(pos, parseSquare('d1') as Square, 'black');
		const knight = units.find((u) => u.from === 'd5');
		expect(knight?.available).toBe(true);
	});

	it('reports an absolute pin as unavailable', () => {
		// Knight d5 pinned to the KING on d8 by the rook: illegal to move.
		const pos = positionFromFen('3k4/8/8/3n4/8/8/8/3R2K1 b - - 0 1');
		const units = arrivals(pos, parseSquare('d1') as Square, 'black');
		const knight = units.find((u) => u.from === 'd5');
		expect(knight?.available).toBe(false);
	});
});

describe('escapesFor', () => {
	it('prices a free retreat at zero', () => {
		const pos = positionFromFen('6k1/8/8/3n4/8/8/8/3R2K1 b - - 0 1');
		const escapes = escapesFor(pos, parseSquare('d5') as Square);
		expect(escapes[0].total).toBeLessThanOrEqual(0);
	});

	it('prices a retreat that abandons a queen behind it', () => {
		// The relative pin, as a number rather than as a name: leaving exposes
		// the queen on d8 to the rook on d1.
		const pos = positionFromFen('3q2k1/8/8/3n4/8/8/8/3R2K1 b - - 0 1');
		const escapes = escapesFor(pos, parseSquare('d5') as Square);
		expect(escapes[0].exposes).toBeGreaterThan(0);
		expect(escapes[0].total).toBeGreaterThan(0);
	});
});

describe('the Chessable pin, as a table', () => {
	// White Rd1 pins Nd5 to Qd8. The knight is defended by the pawn on e6.
	// White has a pawn on e2, one move from e4 where it attacks d5.
	//
	// The point of the example: the pin does not win the knight. It stops the
	// knight from leaving while the PAWN arrives. That is a claim about three
	// columns of a table, and it is checkable.
	const FEN = '3q2k1/8/4p3/3n4/8/8/4P3/3R2K1 w - - 0 1';

	it('is not winnable with the pieces already in contact', () => {
		const c = contest(FEN, 'd5');
		expect(c.rows[0].net).toBeLessThanOrEqual(0);
	});

	it('becomes winnable once the pawn arrives, one tempo later', () => {
		const c = contest(FEN, 'd5');
		expect(c.rows[1].net).toBeGreaterThan(0);
		expect(c.winnableAt).toBe(1);
	});

	it('names the pawn as the unit that changes the verdict', () => {
		const c = contest(FEN, 'd5');
		const joined = c.rows[1].attackers.filter((u) => u.arrival === 1);
		expect(joined.map((u) => u.from)).toContain('e2');
	});

	it('prices the knight’s escape above zero — which is what the pin buys', () => {
		const c = contest(FEN, 'd5');
		expect(c.escapeCost).toBeGreaterThan(0);
	});

	it('reverses when the piece behind is gone', () => {
		// Same rook, same pawn, same knight — no queen behind, so the knight
		// simply steps away and the whole plan is two wasted moves. Same
		// "motif", opposite verdict, and only the escape column changed.
		const noPin = '6k1/8/4p3/3n4/8/8/4P3/3R2K1 w - - 0 1';
		const c = contest(noPin, 'd5');
		expect(c.escapeCost).toBeLessThanOrEqual(0);
		expect(c.winnableAt).toBeNull();
	});

	it('carries its caveats with it', () => {
		// A table without them reads as a proof. It is not one.
		expect(contest(FEN, 'd5').caveats.length).toBeGreaterThan(3);
	});
});

describe('the prize is not its own defender', () => {
	// Found by the Lab on its first run, not by anything I thought to test: the
	// knight under attack was listed as arriving in one move to DEFEND the square
	// it stands on — via a square it can only reach by abandoning the contest.
	// The unit tables looked plausible; the row read `Nd5→c3` as a defender.
	it('leaves the piece standing on the target out of both sides', () => {
		const c = contest('3q2k1/8/4p3/3n4/8/8/4P3/3R2K1 w - - 0 1', 'd5');
		for (const r of c.rows) {
			expect(r.attackers.map((u) => u.from)).not.toContain('d5');
			expect(r.defenders.map((u) => u.from)).not.toContain('d5');
		}
	});
})
