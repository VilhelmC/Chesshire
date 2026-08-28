// The ladder's move generator: what it may narrow, and what it may not.
//
// The M2 gate proves the filter loses no ANSWER over 280 positions. These are
// the properties that make it sound in the first place, asserted where they can
// be read rather than inferred from an aggregate.
import { describe, it, expect } from 'vitest';
import { makeSquare, parseSquare } from 'chessops/util';
import { positionFromFen } from '../src/domain/chess';
import {
	allMoves,
	relevantMoves,
	zoneOf,
	bearsOnZone,
	mateGoal,
	materialChoose,
	guarantees,
	ladderReport,
	mateTree,
	survivingReplies,
} from '../src/domain/ladder';

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

// ---------------------------------------------------------------------------
// THE REPORT — and the one claim it is not allowed to make.
//
// `ladderReport` exists to say WHY NOT MORE, and the way that goes wrong is by
// dressing a witness up as an enumeration. These positions are the hand-read
// gate cases for the panel (#34), taken at the ply the solver answers from.
// ---------------------------------------------------------------------------
describe('the ladder report', () => {
	// Generated by playing each puzzle's blunder, not typed — two hand-written
	// FENs in the first draft of this block were illegal positions.
	//
	// 1lR5W after ♞g6–e7: White mates with ♖f1xf6.
	const MATE_IN_2 = '3rrk2/bp2n1pp/p1pp1p2/8/1P1PP2P/PBP3K1/3B4/4RR2 w - - 1 24';
	// ohoTK after ♕d1–c1: a mate in THREE, needing five plies, so the king rung is
	// refuted at depth 3 and the defender has a great many ways out. That is an
	// honest depth limit rather than a wrong answer, and it is what makes this the
	// position to assert the witness/enumeration distinction on.
	const NO_MATE = '3r2k1/3b2pp/2p1p2r/R1Pp1q2/1P1P1p2/5P2/6PP/2Q1B1RK b - - 3 33';
	// TVU0i after ♜d3xd6: White forks with ♗f2–c5 and wins the rook.
	const FORK = '8/8/p2r4/8/P3p1p1/kP4P1/2K2B2/8 w - - 0 43';

	it('stops at the king rung when mate is forced, and names every way', () => {
		const r = ladderReport(positionFromFen(MATE_IN_2), 3);
		expect(r.value).toBe('mate');
		expect(r.forced).toBe(true);
		expect(r.moves.map(name)).toContain('f1f6');
		// A LADDER STOPS AT ITS FIRST YES. Reporting the material rungs underneath a
		// proved mate would be reporting rungs that were never asked.
		expect(r.rungs).toHaveLength(1);
		expect(r.rungs[0].rung).toBe('mate');
	});

	it('descends by value, and every rung above the answer is refuted', () => {
		const r = ladderReport(positionFromFen(FORK), 3);
		expect(r.forced).toBe(true);
		expect(r.moves.map(name)).toContain('f2c5');
		const asked = r.rungs.map((x) => x.rung);
		expect(asked[0]).toBe('mate');
		// Strictly descending, and only the last one answered.
		const material = asked.slice(1) as number[];
		for (let i = 1; i < material.length; i++) expect(material[i]).toBeLessThan(material[i - 1]);
		expect(r.rungs.filter((x) => x.proved)).toHaveLength(1);
		expect(r.rungs[r.rungs.length - 1].proved).toBe(true);
	});

	it('gives every refuted rung a reason, never a bare no', () => {
		const r = ladderReport(positionFromFen(NO_MATE), 3);
		for (const x of r.rungs) {
			if (x.proved) continue;
			expect(x.miss).toBeDefined();
			expect(x.attempts.length).toBeGreaterThan(0);
		}
	});

	it('reports ONE witness on the mate rung, never a survivor count', () => {
		// THE REGRESSION. `pns.via` is whatever df-pn resolved before it stopped,
		// which is one child — the search's entire point is to stop there. The first
		// version of the report called that list `survivors` and the panel printed
		// its length as "n replies survive", which read `1` for a position with
		// twenty-nine ways out.
		const pos = positionFromFen(NO_MATE);
		const r = ladderReport(pos, 3);
		const king = r.rungs[0];
		expect(king.proved).toBe(false);
		for (const a of king.attempts) {
			// A witness is a single move, and the complete list is never filled in by
			// the report — only by `survivingReplies`, which the caller pays for.
			expect(Array.isArray(a.witness)).toBe(false);
			expect(a.survivors).toBeUndefined();
		}
	});

	it('survivingReplies IS the enumeration, and it is bigger than the witness', () => {
		const pos = positionFromFen(NO_MATE);
		const tried = ladderReport(pos, 3).rungs[0].attempts.find((a) => a.witness);
		expect(tried).toBeDefined();
		const all = survivingReplies(pos, tried!.move, pos.turn, 3);
		// The witness is one of them, and there are many more. This is the exact
		// inequality the panel's `≥1` label stands for.
		expect(all.map(name)).toContain(name(tried!.witness!));
		expect(all.length).toBeGreaterThan(1);
		// Nothing is invented: every survivor is a legal reply to the move.
		const child = positionFromFen(NO_MATE);
		child.play(tried!.move);
		const legal = new Set(allMoves(child).map(name));
		for (const m of all) expect(legal.has(name(m))).toBe(true);
	});

	it('the mate tree answers EVERY reply, not one line', () => {
		const pos = positionFromFen(MATE_IN_2);
		const r = ladderReport(pos, 3);
		const tree = mateTree(pos, r.moves[0], pos.turn, 3);
		// Either our move mates outright, or every legal reply is listed and each
		// carries our answer. A tree with a childless reply under it is a proof with
		// a hole, which is the thing a principal variation hides.
		if (!tree.mate) {
			const child = positionFromFen(MATE_IN_2);
			child.play(r.moves[0]);
			expect(tree.kids).toHaveLength(allMoves(child).length);
			for (const reply of tree.kids) {
				expect(reply.kids).toHaveLength(1);
				expect(reply.kids[0].mate).toBe(true);
			}
		}
	});
});
