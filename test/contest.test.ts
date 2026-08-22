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
		const p = preset(2);
		const c = contest(p.fen, p.target);
		expect(c.verdict.at).toBe(1);
		const rung = c.knot.rungs.find((r) => r.holds);
		expect(rung?.move?.from).toBe('e2');
		expect(rung?.move?.to).toBe('e4');
		// And it reads as a move, not as four characters.
		expect(rung?.move?.text).toBe('♙e2–e4');
	});

	it('lists which of the three spoiled it, rather than only a number', () => {
		// A count says the exchange would pay. The knot says it does not form,
		// and says WHICH of the three failure modes did it — which is the whole
		// output shape SEE.md §4 asks for.
		for (const key of ['escape', 'defender', 'forcing']) {
			const p = PRESETS.find((x) => x.key === key);
			if (!p) continue;
			const c = contest(p.fen, p.target);
			expect(c.knot.at, `${key}: ${c.verdict.why}`).toBeNull();
			const rung = c.knot.rungs.find((r) => r.count >= 100 && r.spoilers.length);
			expect(rung?.spoilers[0]?.kind, `${key}: ${c.verdict.why}`).toBe(key);
		}
	});

	it('carries a piece glyph on every move it names', () => {
		// Will: "we agreed all moves are accompanied by piece glyph." A move
		// printed as four characters is a coordinate pair, not a move.
		const bare = /(^|[\s—])[a-h][1-8][–x×-][a-h][1-8]/;
		for (const p of PRESETS) {
			const why = contest(p.fen, p.target).verdict.why;
			expect(bare.test(why), `#${p.n}: ${why}`).toBe(false);
		}
	});
});

describe('a defender with a prior job', () => {
	// The mechanism, checked on the position the GENERATOR produced for it
	// rather than on one built to show it. The verdict is 'entangled': nothing
	// wins outright and the defence is still not sound, which is the
	// distinction the app has to be able to draw.
	const P = PRESETS.find((p) => p.key === 'entangled')!;

	it('prices what the defender is already doing, and where', () => {
		const c = contest(P.fen, P.target);
		const loaded = c.rows
			.flatMap((r) => r.critical)
			.find((x) => x.unit.duty > 0);
		expect(loaded, `verdict: ${c.verdict.why}`).toBeTruthy();
		expect(loaded!.unit.dutyAt).toBeTruthy();
		expect(loaded!.foldWithout).toBeGreaterThan(0);
	});

	it('says so in the verdict, with the square it is on loan from', () => {
		const c = contest(P.fen, P.target);
		expect(c.verdict.kind).toBe('entangled');
		expect(c.verdict.why).toContain('the only thing holding');
	});

	it('charges no duty when there is nothing on the other square to guard', () => {
		// Same position, the second square emptied: THAT defender owes nothing
		// any more. Asserted about the unit rather than about the verdict — a
		// position can be entangled twice over, and the earlier version of this
		// test could not tell the two apart.
		const c = contest(P.fen, P.target);
		const loaded = c.rows.flatMap((r) => r.critical).find((x) => x.unit.duty > 0);
		expect(loaded).toBeTruthy();
		const emptied = stripPiece(P.fen, loaded!.unit.dutyAt!);
		const after = contest(emptied, P.target);
		const same = after.rows
			.flatMap((r) => r.defenders)
			.find((u) => u.from === loaded!.unit.from);
		expect(same?.dutyAt).not.toBe(loaded!.unit.dutyAt);
	});
});

/** Remove whatever stands on `square`, so a fixture can be varied by hand. */
function stripPiece(fen: string, square: string): string {
	const pos = positionFromFen(fen);
	pos.board.take(parseSquare(square) as Square);
	const rows: string[] = [];
	for (let r = 7; r >= 0; r--) {
		let row = '';
		let gap = 0;
		for (let f = 0; f < 8; f++) {
			const piece = pos.board.get((r * 8 + f) as Square);
			if (!piece) {
				gap++;
				continue;
			}
			if (gap) row += gap;
			gap = 0;
			const ch = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' }[
				piece.role
			];
			row += piece.color === 'white' ? ch.toUpperCase() : ch;
		}
		if (gap) row += gap;
		rows.push(row);
	}
	return `${rows.join('/')} ${fen.split(' ').slice(1).join(' ')}`;
}

describe('the knot is the verdict', () => {
	it('reports the move and the resistance, not only the number', () => {
		const p = PRESETS.find((x) => x.key === 'build')!;
		const c = contest(p.fen, p.target);
		const rung = c.knot.rungs.find((r) => r.holds && r.move);
		expect(rung).toBeTruthy();
		expect(c.verdict.why).toContain(rung!.move!.text);
	});

	it('makes no claim when it is not the attacker to move', () => {
		const p = PRESETS.find((x) => x.key === 'build')!;
		const theirTurn = p.fen.replace(' w ', ' b ');
		const c = contest(theirTurn, p.target);
		expect(c.knot.at).toBeNull();
		expect(c.verdict.kind).toBe('unresolved');
	});

	it('answers about the target square and not about the board', () => {
		// The failure that killed race.ts: a rook hanging on e3, nothing at all
		// bearing on c5, and the verdict said "take it now, 500" — at c5. The
		// claim has to be about the square it names.
		const fen = '6k1/5ppp/4R2R/2r5/1b6/2Bpr3/4PPPP/6K1 w - - 0 1';
		const c = contest(fen, 'c5');
		expect(c.knot.rungs[0].participants.attackers).toEqual([]);
		expect(c.verdict.kind).not.toBe('winnable');
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

describe('the fold stops at the king', () => {
	// Found by the generator, not by me. The fold priced the king at 100000 and
	// then happily captured it, so the Lab printed exchanges worth "100100" and
	// "99680" — not a rounding error but a sequence that plays on past the end
	// of the game.
	it('never takes a king off the board', () => {
		const fen = '6k1/5ppp/1N1n4/5N1R/1r1r2Rn/8/5PPP/6K1 w - - 0 1';
		const pos = positionFromFen(fen);
		const fold = foldAt(pos.board, parseSquare('g7') as Square, 'white');
		expect(fold.steps.some((s) => s.captured >= VALUE.king)).toBe(false);
		expect(fold.value).toBeLessThan(VALUE.king);
	});

	it('does not let the king capture into a defended square', () => {
		// Nf5xg7 is answered by Kxg7 only if nothing else guards g7. The rook on
		// g4 does, so the king may not recapture and the knight stands.
		const fen = '6k1/5ppp/1N1n4/5N1R/1r1r2Rn/8/5PPP/6K1 w - - 0 1';
		const pos = positionFromFen(fen);
		const fold = foldAt(pos.board, parseSquare('g7') as Square, 'white');
		expect(fold.steps.filter((s) => s.happens).map((s) => s.role)).toEqual(['knight']);
		expect(fold.value).toBe(VALUE.pawn);
	});

	it('does let the king capture when the square is genuinely loose', () => {
		const fen = '6k1/5ppp/2p2P2/5B2/1Pb5/6p1/5PPP/6K1 w - - 0 1';
		const pos = positionFromFen(fen);
		const fold = foldAt(pos.board, parseSquare('h7') as Square, 'white');
		expect(fold.steps.map((s) => s.role)).toEqual(['bishop', 'king']);
		// Bishop for a pawn is not an exchange anyone is forced into.
		expect(fold.value).toBe(0);
	});
});

describe('a claim about a square is a claim about that square', () => {
	// Every one of these came out of scripts/agree.mjs. None of them would have
	// occurred to me, which is the point of generating them.

	it('does not fund the claim with material won on the way there', () => {
		// A build-up move that grabs a pawn en route has a negative route cost.
		// Letting that count made a square with nothing at stake read as
		// winnable — the material was real and it was somewhere else.
		const fen = '6k1/2R3rR/b2Bp3/6P1/1B4B1/2bb4/5PPP/6K1 w - - 0 1';
		const c = contest(fen, 'g7');
		const rung = c.knot.rungs.find((r) => r.holds);
		if (rung) expect(rung.fold.value - rung.spent).toBeGreaterThan(0);
	});

	it('will not call a square winnable when its own exchange pays nothing', () => {
		const fen = '6k1/5ppp/b2Bp3/6P1/1B4B1/2bb4/5PPP/6K1 w - - 0 1';
		const c = contest(fen, 'g7');
		for (const r of c.knot.rungs) {
			if (r.holds) expect(r.fold.value - r.spent).toBeGreaterThan(0);
		}
	});

	it('charges only the counter-threat the capture created', () => {
		// White has a bishop hanging on c6 whether or not Bxe5 is played, so
		// charging it to Bxe5 turned a free bishop into "nothing". Measured
		// against doing nothing, which is the only baseline that means anything.
		const fen = '6k1/1p3ppp/1pB5/1p2b3/P3P1b1/2B4P/5PPP/6K1 w - - 0 1';
		const c = contest(fen, 'e5');
		expect(c.verdict.kind).toBe('winnable');
		expect(c.knot.value).toBeGreaterThanOrEqual(300);
	});
});
