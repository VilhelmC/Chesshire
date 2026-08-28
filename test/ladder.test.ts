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
	quiesce,
	settled,
	materialFor,
	holds,
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

// ---------------------------------------------------------------------------
// THE LEAF, AND THE SIGN.
//
// Two defects found on the same afternoon, both by a REFEREE rather than by a
// test — `scripts/guarantee-depth.mjs` had to reproduce `guarantees` exactly at
// depth 2 before it could be trusted to judge depth 4, and the pairs where it
// refused were the bug. Neither would have been caught by asking the corpus
// whether the answer was right: the first makes a losing move look like the best
// on the board, and the corpus has no opinion about moves it does not list.
//
// Every position below was CHECKED before it was written down. Two earlier
// batches of hand-typed FENs in this file were illegal or did not contain the
// thing they claimed to, which is its own small lesson.
// ---------------------------------------------------------------------------
describe('what a guarantee is worth', () => {
	// White ♖a1 ♔g1 + f2 g2 h2; Black ♜d8 ♚g8 + f7 g7 h7. Material level, and the
	// rook on a1 is the only thing covering the back rank.
	const BACK_RANK = '3r2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';

	it('scores walking into mate as the WORST outcome, not the best', () => {
		// THE SIGN BUG. `guarantees` reads a checkmate at two different plies:
		// after OUR move, where it means we delivered it, and after THEIR reply,
		// where it means we walked into it. Both branches read `Infinity`, one ply
		// apart, opposite meaning, same spelling.
		//
		// ♖a1–a4 steps off the back rank and allows ♜d1#. It scored +∞ — better
		// than every other move, and `Infinity >= want` clears every material rung,
		// so it was reported as a FORCED win of the largest piece on the board.
		const pos = positionFromFen(BACK_RANK);
		const a4 = allMoves(pos).find((m) => name(m) === 'a1a4')!;
		expect(a4).toBeDefined();
		expect(guarantees(pos, a4, 'white')).toBe(-Infinity);
		// And so the rungs do not choose it. Every move they DO choose survives —
		// asserted over the whole set rather than by naming one, because the point
		// is that nothing scoring −∞ can win a maximum.
		const chosen = materialChoose(pos).moves;
		expect(chosen.map(name)).not.toContain('a1a4');
		for (const m of chosen) expect(guarantees(pos, m, 'white')).toBeGreaterThan(-Infinity);
	});

	it('still scores mate we DELIVER as the best outcome', () => {
		// The other side of the same coin, so the fix cannot be "flip the sign".
		// Same position without the black rook: ♖a1–a8 is mate.
		const pos = positionFromFen('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
		const a8 = allMoves(pos).find((m) => name(m) === 'a1a8')!;
		expect(guarantees(pos, a8, 'white')).toBe(Infinity);
		expect(materialChoose(pos).moves.map(name)).toEqual(['a1a8']);
	});
});

describe('quiescence at the leaf', () => {
	// TWO HANGING MEN, ONLY ONE OF WHICH CAN BE SAVED — `settled`'s own comment
	// naming its own limit. Black ♜b8 ♝a7 ♚e8; White ♖a1 ♘b5 ♔e1. Black is +10.
	// ♜xb5 wins the knight; ♖xa7 wins the bishop straight back.
	const TWO_HANGING = '1r2k3/b7/8/1N6/8/8/8/R3K3 b - - 0 1';

	it('does not report a position as settled mid-exchange', () => {
		const pos = positionFromFen(TWO_HANGING);
		const material = materialFor(pos.board, 'black');
		// The one-exchange leaf credits Black with the whole knight and never sees
		// the bishop go. That gap is the horizon effect, and over the corpus it was
		// 15.8% of every claim the ladder called forced.
		expect(settled(pos.board, 'black', 'black')).toBe(material + 320);
		// Quiescence plays both captures out and lands back where it started.
		expect(quiesce(pos, 'black')).toBe(material);
	});

	it('lets a side DECLINE a capture — stand-pat is what makes it sound', () => {
		// Black ♛a4 can take the pawn on d4, which is defended by e3, and lose the
		// queen for it. Without stand-pat a quiescence forces that capture and
		// invents a loss no player would accept. Declining is not an approximation;
		// it is the rule of chess.
		const pos = positionFromFen('4k3/8/8/8/q2P4/4P3/8/4K3 b - - 0 1');
		expect(quiesce(pos, 'black')).toBe(materialFor(pos.board, 'black'));
	});

	it('is bounded by the material on the board, so it needs no depth limit', () => {
		// Every move it considers removes a man or promotes a pawn, so the
		// recursion terminates on its own. A cap here would be a guess, and this
		// project has spent three corrections on guesses that looked like limits.
		const pos = positionFromFen('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
		expect(Number.isFinite(quiesce(pos, 'white'))).toBe(true);
	});

	it('orders captures without changing the answer', () => {
		// Most-valuable-victim ordering cut this from 1.7ms mean and 52ms worst to
		// 0.4ms and 4ms. It decides which capture is tried FIRST and nothing else:
		// asserted against a full window, which cannot cut at all, so if the
		// ordering were filtering these would differ.
		for (const fen of [
			'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
			TWO_HANGING,
			'6k1/5ppp/8/q7/8/8/3R4/3R3K w - - 0 1',
		]) {
			const pos = positionFromFen(fen);
			expect(quiesce(pos, pos.turn, -Infinity, Infinity)).toBe(quiesce(pos, pos.turn));
		}
	});
});

describe('depth in the material rungs', () => {
	it('holds(2) IS guarantees — the generalisation changes nothing at the default', () => {
		// The control that licenses `holds` being called a deeper `guarantees`
		// rather than a different function. `scripts/rung-depth.mjs` runs it over
		// 630 (position, move) pairs; this pins the property where it can be read.
		//
		// It matters because `ladderReport`'s `materialPlies` defaults to 2, so the
		// whole corpus baseline rests on these two being the same expression.
		const fens = [
			'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
			'1r2k3/b7/8/1N6/8/8/8/R3K3 b - - 0 1',
			'3r2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
			'8/6P1/3k4/8/8/8/8/7K w - - 0 1',
		];
		for (const fen of fens) {
			const pos = positionFromFen(fen);
			for (const m of allMoves(pos)) expect(holds(pos, m, pos.turn, 2)).toBe(guarantees(pos, m, pos.turn));
		}
	});

	it('reads mate at every ply, not only at the leaf', () => {
		// A line that wins a rook and gets mated on the way is not a line that wins
		// a rook. ♖a1–a4 steps off the back rank; at two plies that is already −∞,
		// and it must stay −∞ however much deeper the search goes.
		const pos = positionFromFen('3r2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
		const a4 = allMoves(pos).find((m) => name(m) === 'a1a4')!;
		expect(holds(pos, a4, 'white', 2)).toBe(-Infinity);
		expect(holds(pos, a4, 'white', 4)).toBe(-Infinity);
	});

	it('deepening never lowers a value that was already exact', () => {
		// Not a general property of search — it is a property of THIS position
		// class, and it is the one the referee measures over the corpus. Asserted
		// here on a quiet position where two plies already see everything, so a
		// deeper search must agree rather than discover a refutation.
		const pos = positionFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		for (const m of allMoves(pos).slice(0, 6))
			expect(holds(pos, m, 'white', 4)).toBe(holds(pos, m, 'white', 2));
	});
});
