// The contest at a square.
//
// Two kinds of test, and the split matters.
//
// The first kind is arithmetic on a tiny board — who bears on a square, what an
// exchange folds to — written so a person can set the position up and check it
// by hand.
//
// The second kind is a VERDICT about a position, and those are no longer written
// by me. They run on the fixtures in src/views/labPresets.ts, whose answers were
// set by Stockfish and are re-checked by test/adjudicate.test.ts. Every wrong
// answer this module has produced was one where my derivation and my code agreed
// with each other and both were wrong; the only way out of that is a referee.

import { describe, it, expect } from 'vitest';
import { foldAt, bearingOn, arrivals, escapesFor, contest, VALUE } from '../src/domain/contest';
import { PRESETS } from '../src/views/labPresets';
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

describe('the adjudicated fixtures', () => {
	// The answers here come from src/views/labPresets.ts, where they were set by
	// the engine. This asserts that the CONTEST TABLE agrees with them — which is
	// the actual claim of the whole module.

	// Referred to by number, which is stable when a fixture is renamed.
	const preset = (n: number) => {
		const p = PRESETS.find((x) => x.n === n);
		if (!p) throw new Error(`no preset #${n}`);
		return p;
	};

	it.each(PRESETS.filter((p) => p.claim))('#$n $name', (p) => {
		const c = contest(p.fen, p.target);
		expect(c.verdict.kind === 'winnable', `I say ${c.verdict.kind}: ${c.verdict.why}`).toBe(
			p.claim === 'wins',
		);
	});

	it('names the move that wins, and how many tempi it costs', () => {
		const c = contest(preset(1).fen, 'd5');
		expect(c.verdict.at).toBe(1);
		expect(c.race.line[0]).toBe('e2e4');
	});

	it('answers #2 by running the race rather than counting the knot', () => {
		// The rook is not on the file yet. A count says the exchange would pay;
		// the race says the knight leaves while the rook is committing.
		const c = contest(preset(2).fen, 'd5');
		expect(c.verdict.kind).toBe('not-winnable');
		expect(c.race.value).toBeLessThanOrEqual(0);
	});
});

describe('a defender with a prior job', () => {
	// The mechanism, checked directly. The verdict for this position is 'nothing'
	// (the engine says +37), and that is worth keeping as a fixture: the
	// entanglement is real and does not win, which is a distinction the app has
	// to be able to draw.
	const FEN = PRESETS.find((p) => p.n === 6)!.fen;

	it('prices what the knight is already doing, and where', () => {
		const c = contest(FEN, 'd5');
		const knight = c.rows[1].defenders.find((u) => u.from === 'g8');
		expect(knight?.arrival).toBe(1);
		expect(knight?.duty).toBe(330);
		expect(knight?.dutyAt).toBe('h6');
	});

	it('does not charge a duty to a defender that owes nothing', () => {
		const c = contest(FEN, 'd5');
		const bishop = c.rows[0].defenders.find((u) => u.from === 'b7');
		expect(bishop?.duty).toBe(0);
	});

	it('leaves the duty at zero when there is nothing to guard', () => {
		// Same position with the bishop on h6 removed.
		const free = FEN.replace('4p2b', '4p3');
		const c = contest(free, 'd5');
		const knight = c.rows[1].defenders.find((u) => u.from === 'g8');
		expect(knight?.duty).toBe(0);
	});
});

describe('the pin that is really a trade', () => {
	const FEN = PRESETS.find((p) => p.n === 7)!.fen;

	it('finds the knight jump the pin was supposed to prevent', () => {
		// Every static count says the knight cannot move, and it moves — with
		// check, so the exposure behind it is never collected.
		const c = contest(FEN, 'd5');
		const defence = c.rows[1].play?.defence;
		expect(defence?.from).toBe('d5');
		expect(defence?.check).toBe(true);
	});

	it('does not claim the pin wins anything', () => {
		const c = contest(FEN, 'd5');
		expect(c.verdict.kind).not.toBe('winnable');
	});
});

describe('the race is the verdict', () => {
	it('reports the sequence, not only the number', () => {
		const c = contest(PRESETS[0].fen, 'd5');
		expect(c.race.line.length).toBeGreaterThan(0);
		expect(c.verdict.why).toContain(c.race.line[0]);
	});

	it('runs no race when it is not the attacker to move', () => {
		const theirTurn = PRESETS[0].fen.replace(' w ', ' b ');
		expect(contest(theirTurn, 'd5').race.line).toEqual([]);
	});
});

describe('whose move it is', () => {
	it('declines to answer when it is not the attacker to move', () => {
		// Will's point: the side to move is part of the question, and a table
		// that ignores it is answering a different position.
		const p = PRESETS[0];
		const theirTurn = p.fen.replace(' w ', ' b ');
		expect(contest(theirTurn, p.target).verdict.kind).toBe('unresolved');
		expect(contest(theirTurn, p.target).verdict.why).toContain('side to move');
	});
});

describe('the prize is not its own defender', () => {
	// Found by the Lab on its first run, not by anything I thought to test: the
	// knight under attack was listed as arriving in one move to DEFEND the square
	// it stands on — via a square it can only reach by abandoning the contest.
	it('leaves the piece standing on the target out of both sides', () => {
		const c = contest(PRESETS[0].fen, 'd5');
		for (const r of c.rows) {
			expect(r.attackers.map((u) => u.from)).not.toContain('d5');
			expect(r.defenders.map((u) => u.from)).not.toContain('d5');
		}
	});
});

describe('the fold, at its edges', () => {
	// Will: "go back to basics and consider the whole algorithm — I sense you're
	// getting even the basics wrong." He was right. These four cases are what a
	// real static exchange evaluation has to handle beyond alternating captures,
	// and two of them were silently wrong.

	const value = (fen: string, sq: string, side: 'white' | 'black' = 'white') =>
		foldAt(positionFromFen(fen).board, parseSquare(sq) as Square, side).value;

	it('lets a piece behind another join the chain', () => {
		// Doubled rooks: the second one is not "bearing on" d5 until the first
		// has gone, and it joins because the attacker list is recomputed after
		// every capture rather than fixed at the start.
		const fen = '6k1/8/4p3/3n4/8/8/3R4/3R2K1 w - - 0 1';
		expect(value(fen, 'd5')).toBe(0); // R, pxR, R — still not enough
		expect(foldAt(positionFromFen(fen).board, parseSquare('d5') as Square, 'white').steps.length)
			.toBeGreaterThan(2);
	});

	it('does not let a pinned defender recapture', () => {
		// Black king e8, pawn e6 pinned to it by Re1. The knight on d5 LOOKS
		// defended and is free: the pawn cannot legally take.
		expect(value('4k3/8/4p3/3n4/8/8/8/3RR1K1 w - - 0 1', 'd5')).toBe(VALUE.knight);
	});

	it('still lets a pinned piece capture ALONG the pin', () => {
		// Black's rook on e6 is pinned to the king on e8 by the rook on e1 — and
		// may still take that rook, because doing so never leaves the line. A pin
		// restricts a piece; it does not freeze it, and excluding pinned pieces
		// outright would report this square as safe.
		expect(value('4k3/8/4r3/8/8/8/8/4R1K1 b - - 0 1', 'e1', 'black')).toBe(VALUE.rook);
	});

	it('prices a promotion, because the pawn arrives as a queen', () => {
		// bxa8=Q wins the rook AND eight pawns of pawn-to-queen. Counting it as
		// an ordinary capture is wrong by more than the rook.
		expect(value('r5k1/1P6/8/8/8/8/8/6K1 w - - 0 1', 'a8')).toBe(
			VALUE.rook + VALUE.queen - VALUE.pawn,
		);
	});

	it('will not let a king capture into a defended square', () => {
		// Two rooks against a knight the king defends: Kxd5 loses the king, so
		// the fold treats it as unaffordable and White simply wins the piece.
		// (The king's value is the mechanism — it makes any recapture that hangs
		// it astronomically bad, which is exactly what the rules say.)
		expect(value('8/8/2k5/3n4/8/8/3R4/3R2K1 w - - 0 1', 'd5')).toBe(VALUE.knight);
		// With only one attacker the king DOES recapture, and White declines.
		expect(value('8/8/2k5/3n4/8/8/8/3R2K1 w - - 0 1', 'd5')).toBe(0);
	});
});
