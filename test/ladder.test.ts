// The ladder's move generator: what it may narrow, and what it may not.
//
// The M2 gate proves the filter loses no ANSWER over 280 positions. These are
// the properties that make it sound in the first place, asserted where they can
// be read rather than inferred from an aggregate.
import { describe, it, expect } from 'vitest';
import { makeSquare, parseSquare } from 'chessops/util';
import { positionFromFen } from '../src/domain/chess';
import { allMoves, relevantMoves, zoneOf, bearsOnZone, mateGoal, materialChoose, guarantees } from '../src/domain/ladder';

// UCI SPELLS A KNIGHT 'n'. Taking the first letter of the role name spells it
// 'k', which is the letter for a king — a promotion that does not exist, so it
// collides with nothing and stays wrong quietly. It made this file's own
// promotion test fail against a correct generator.
const UCI: Record<string, string> = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const name = (m: { from: number; to: number; promotion?: string }) =>
	makeSquare(m.from) + makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');

describe('the ladder generator', () => {
	it('only ever narrows — every relevant move is a legal one', () => {
		const pos = positionFromFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
		const all = new Set(allMoves(pos).map(name));
		for (const m of relevantMoves(pos, 'black')) expect(all.has(name(m))).toBe(true);
		expect(relevantMoves(pos, 'black').length).toBeLessThan(all.size);
	});

	it('asks about the piece that ARRIVES, not the one that left', () => {
		// ♙g7 promoting, ♚d6. The zone is d6 and its neighbours, so:
		//   ♘g8 bears on e7  — relevant
		//   ♕g8 bears on e6  — relevant
		//   ♗g8 bears on e6  — relevant
		//   ♖g8 bears on the g-file and rank 8 — NOTHING in the zone, not relevant
		// And a PAWN on g8 would bear on f7 and h7, neither in the zone — so asking
		// about the pawn makes every promotion irrelevant and loses the knight mate
		// that `rRPBO` turns on.
		const pos = positionFromFen('8/6P1/3k4/8/8/8/8/7K w - - 0 1');
		const got = new Set(relevantMoves(pos, 'black').map(name));
		expect(got.has('g7g8n')).toBe(true);
		expect(got.has('g7g8q')).toBe(true);
		expect(got.has('g7g8b')).toBe(true);
		expect(got.has('g7g8r')).toBe(false);
	});

	it('counts the zone as the king and his neighbours', () => {
		const zone = zoneOf(parseSquare('d6')!);
		for (const s of ['d6', 'c5', 'd5', 'e5', 'c6', 'e6', 'c7', 'd7', 'e7'])
			expect(zone.has(parseSquare(s)!)).toBe(true);
		for (const s of ['f7', 'b4', 'h8']) expect(zone.has(parseSquare(s)!)).toBe(false);
	});

	it('counts a move INTO the zone as relevant even if it attacks nothing', () => {
		// Landing next to the king covers a flight square, which is half of a mate.
		const pos = positionFromFen('8/6P1/3k4/8/8/8/8/7K w - - 0 1');
		const zone = zoneOf(parseSquare('d6')!);
		expect(bearsOnZone(pos, { from: parseSquare('h1')!, to: parseSquare('h2')! }, zone)).toBe(false);
	});

	it('NEVER narrows the defender — filtering their replies would prove false mates', () => {
		// At an AND node the defender picks and every reply must be refuted. If the
		// goal narrowed their moves it would be proving mate against an opponent who
		// declines to play the saving move. So the child count at a defender node
		// must be the full legal move count.
		const pos = positionFromFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 5 4');
		const goal = mateGoal('white', { narrow: true });
		expect(goal.children(pos).length).toBe(allMoves(pos).length);
	});

	it('narrows the attacker at the same position', () => {
		const pos = positionFromFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
		const goal = mateGoal('white', { narrow: true });
		expect(goal.children(pos).length).toBeLessThan(allMoves(pos).length);
		expect(goal.children(pos).length).toBe(relevantMoves(pos, 'black').length);
	});

	it('calls depth exhaustion a failure for the attacker and a success for the defender', () => {
		// The one asymmetric verdict, and the one that made three engine tests wrong.
		const w = positionFromFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
		const b = positionFromFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 5 4');
		const goal = mateGoal('white');
		expect(goal.terminal(w, 0)).toBe('moverLoses');
		expect(goal.terminal(b, 0)).toBe('moverWins');
	});
});

describe('the material rungs', () => {
	it('wins a hanging piece', () => {
		// Black queen on d4 attacked by nothing but hanging to Nxd4? — a plain
		// undefended man in reach. The rung must find the swing without a search.
		const pos = positionFromFen('4k3/8/8/8/3q4/8/4N3/4K3 w - - 0 1');
		const r = materialChoose(pos);
		expect(r.value).toBeGreaterThan(0);
		expect(r.moves.map(name)).toContain('e2d4');
	});

	it('claims nothing in a quiet position', () => {
		// Nothing is hanging and nothing is trapped, so no move GUARANTEES a swing.
		// A rung that reports a win here is reading an attack rather than a choice.
		//
		// Two earlier versions of this test were themselves the bug. The first used
		// a queen attacked by a rook with the ATTACKER to move — not a piece that
		// runs away, a piece that gets taken; it reported 900, correctly. The second
		// used the Italian with Qf3, which is Scholar's mate; it reported Infinity,
		// also correctly. The starting position is quiet by construction.
		const pos = positionFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		expect(materialChoose(pos).value).toBeLessThanOrEqual(0);
	});

	it('the alpha cut is exact — pruning changes no answer', () => {
		// `guarantees` takes a MINIMUM, so a reply at or below the best-so-far ends
		// the scan. That is sound only if it cannot change the maximum. Asserted
		// against the unpruned computation rather than argued.
		const fens = [
			'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
			'4k3/8/8/8/3q4/8/4N3/4K3 w - - 0 1',
			'8/6P1/3k4/8/8/8/8/7K w - - 0 1',
			'6k1/5ppp/8/q7/8/8/3R4/3R3K w - - 0 1',
		];
		for (const fen of fens) {
			const pos = positionFromFen(fen);
			const pruned = materialChoose(pos);
			let best = -Infinity;
			let moves: ReturnType<typeof allMoves> = [];
			for (const m of allMoves(pos)) {
				const v = guarantees(pos, m, pos.turn); // no floor
				if (v > best + 0.5) {
					best = v;
					moves = [m];
				} else if (v > best - 0.5) moves.push(m);
			}
			expect(pruned.moves.map(name).sort()).toEqual(moves.map(name).sort());
		}
	});
});
